import { planReconstruction } from './reconstruction.mjs';
import { inferEvidenceInterface } from './evidence-interface.mjs';
import { planEvidenceRefinement, verifyEvidenceRefinement } from './evidence-refinement.mjs';

// Explicit, bounded ROBDD sessions. No global strong intern table or guest data.
// Only monotone contracts escape; Boolean negation stays inside entailment/residual.
const contracts = new WeakMap();
const MAX_LIST = 4096;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function integer(x, low, high, label) {
  if (!Number.isSafeInteger(x) || x < low || x > high)
    throw new RangeError(`${label} must be an integer between ${low} and ${high}`);
  return x;
}
function array(x, max, label) {
  if (!Array.isArray(x)) throw new TypeError(`${label} must be an array`);
  if (x.length > max) throw new RangeError(`${label} limit is ${max}`);
  return x;
}
function freeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    for (const child of Object.values(x)) freeze(child);
    Object.freeze(x);
  }
  return x;
}
function metadata(handle) {
  const data = contracts.get(handle);
  if (!data) throw new TypeError('Expected an authentic evidence contract');
  return data;
}
function nodesFor(state, root) {
  const found = new Set(), stack = [root];
  while (stack.length) {
    const id = stack.pop();
    if (id < 2 || found.has(id)) continue;
    found.add(id); stack.push(state.nodes[id].low, state.nodes[id].high);
  }
  // Interning always creates children before parents. Ascending order is postorder.
  return [...found].sort((a, b) => a - b);
}
function supportFor(state, root) {
  const used = new Set(nodesFor(state, root).map(i => state.nodes[i].variable));
  return state.atoms.filter((_, i) => used.has(i));
}

/** A compositional algebra of monotone evidence contracts, not type inference or
 * a runtime authority system. Declaration order fixes the BDD's decision order.
 * substitute and abstract explicitly cross session boundaries; other methods
 * require local handles. See
 * docs/EVIDENCE-ALGEBRA.md for exact semantics, partial-fact demand, and limits.
 * @param {string[]} atoms Distinct ordinary Asslang identifiers, at most 128.
 * @param {{maxNodes?:number,maxWork?:number}} options
 */
export function createEvidenceAlgebra(atoms, options = {}) {
  if (!object(options)) throw new TypeError('Evidence algebra options must be an object');
  array(atoms, 128, 'Evidence atoms');
  const { maxNodes: nodeLimit = 8192, maxWork: workLimit = 200000 } = options;
  const maxNodes = integer(nodeLimit, 2, 65536, 'Evidence node limit');
  const maxWork = integer(workLimit, 1, 2000000, 'Evidence work limit');
  const names = planReconstruction({ nodes: atoms, edges: [] }).nodes;
  const state = { atoms: names, indices: new Map(names.map((n, i) => [n, i])), nodes: [null, null] };
  const unique = new Map(), handles = new Map();
  function handle(root) {
    if (!handles.has(root)) {
      const h = Object.freeze({ kind: 'evidence-contract' });
      contracts.set(h, { state, root }); handles.set(root, h);
    }
    return handles.get(root);
  }
  function own(h) {
    const data = metadata(h);
    if (data.state !== state) throw new TypeError('Contract belongs to another evidence algebra; use substitute');
    return data.root;
  }
  function atomIndex(name) {
    const i = state.indices.get(name);
    if (i === undefined) throw new TypeError('Unknown evidence atom');
    return i;
  }
  function trueSet(list) {
    array(list, names.length, 'True atoms');
    const set = new Set();
    for (const name of list) {
      const i = atomIndex(name);
      if (set.has(i)) throw new TypeError('Duplicate true atom');
      set.add(i);
    }
    return set;
  }
  function transaction(fn) {
    const start = state.nodes.length;
    let work = 0;
    const tick = () => { if (++work > maxWork) throw new RangeError('Evidence operation work limit exceeded'); };
    const memo = new Map(), notMemo = new Map(), interiorMemo = new Map();
    function mk(variable, low, high) {
      tick();
      if (low === high) return low;
      const key = `${variable}:${low}:${high}`;
      if (unique.has(key)) return unique.get(key);
      if (state.nodes.length >= maxNodes) throw new RangeError('Evidence node limit exceeded');
      const id = state.nodes.length;
      state.nodes.push({ variable, low, high }); unique.set(key, id);
      return id;
    }
    function apply(op, a, b) {
      tick();
      if (a > b) [a, b] = [b, a];
      if (a === b) return a;
      if (op === 'and') {
        if (a === 0) return 0;
        if (a === 1) return b;
      } else {
        if (a === 0) return b;
        if (a === 1) return 1;
      }
      const key = `${op}:${a}:${b}`;
      if (memo.has(key)) return memo.get(key);
      const an = state.nodes[a], bn = state.nodes[b];
      const v = Math.min(an.variable, bn.variable);
      const al = an.variable === v ? an.low : a, ah = an.variable === v ? an.high : a;
      const bl = bn.variable === v ? bn.low : b, bh = bn.variable === v ? bn.high : b;
      const id = mk(v, apply(op, al, bl), apply(op, ah, bh));
      memo.set(key, id); return id;
    }
    function negate(id) {
      tick();
      if (id < 2) return 1 - id;
      if (notMemo.has(id)) return notMemo.get(id);
      const n = state.nodes[id], result = mk(n.variable, negate(n.low), negate(n.high));
      notMemo.set(id, result); return result;
    }
    function interior(id) {
      tick();
      if (id < 2) return id;
      if (interiorMemo.has(id)) return interiorMemo.get(id);
      const n = state.nodes[id], lo = interior(n.low), hi = interior(n.high);
      const result = mk(n.variable, apply('and', lo, hi), hi);
      interiorMemo.set(id, result); return result;
    }
    try { return fn({ tick, mk, apply, negate, interior }); }
    catch (error) {
      // No handle is published until a transaction succeeds. Reclaim every newly
      // interned node, including intermediate Boolean nodes, on any failed call.
      for (let id = state.nodes.length - 1; id >= start; id--) {
        const n = state.nodes[id]; unique.delete(`${n.variable}:${n.low}:${n.high}`);
      }
      state.nodes.length = start;
      throw error;
    }
  }
  function combine(op, input) {
    const roots = [];
    for (const h of array(input, MAX_LIST, 'Contract list')) roots.push(own(h));
    return handle(transaction(({ apply }) => roots.reduce((r, id) => apply(op, r, id), op === 'and' ? 1 : 0)));
  }
  function difference(a, b) {
    const ar = own(a), br = own(b);
    return transaction(({ apply, negate }) => apply('and', ar, negate(br)));
  }
  const api = {
    atoms: names,
    always: handle(1), never: handle(0),
    atom(name) { const i = atomIndex(name); return handle(transaction(({ mk }) => mk(i, 0, 1))); },
    all(input) { return combine('and', input); },
    any(input) { return combine('or', input); },
    fromFrontier(input) {
      const supports = [];
      for (const term of array(input, MAX_LIST, 'Frontier')) {
        const indices = trueSet(term); supports.push([...indices]);
      }
      return handle(transaction(({ apply, mk }) => {
        let r = 0;
        for (const term of supports) {
          let s = 1;
          for (const i of term) s = apply('and', s, mk(i, 0, 1));
          r = apply('or', r, s);
        }
        return r;
      }));
    },
    substitute(template, bindings) {
      const source = metadata(template), needed = supportFor(source.state, source.root);
      array(bindings, needed.length, 'Substitution');
      const replacement = new Map();
      for (const binding of bindings) {
        if (!object(binding)) throw new TypeError('Substitution bindings must be objects');
        const { atom, value } = binding;
        if (!needed.includes(atom) || replacement.has(atom)) throw new TypeError('Unknown, unused or duplicate template atom');
        replacement.set(atom, own(value));
      }
      if (replacement.size !== needed.length) throw new TypeError('Substitution must bind every used template atom');
      return handle(transaction(({ apply, tick }) => {
        const memo = new Map();
        function visit(id) {
          tick();
          if (id < 2) return id;
          if (memo.has(id)) return memo.get(id);
          const n = source.state.nodes[id], lo = visit(n.low), hi = visit(n.high);
          const r = apply('or', lo, apply('and', replacement.get(source.state.atoms[n.variable]), hi));
          memo.set(id, r); return r;
        }
        return visit(source.root);
      }));
    },
    /** Infer strongest necessary and weakest sufficient PUBLIC contracts for a
     * private target. Every public atom is bound to a meaning in the target's
     * private session. Necessary is NOT a safe acceptance guard. See
     * docs/EVIDENCE-INTERFACES.md for adjunctions, exactness and witnesses.
     */
    abstract(privateContract, bindings) {
      const source = metadata(privateContract);
      array(bindings, names.length, 'Interface bindings');
      const meanings = new Map();
      for (const binding of bindings) {
        if (!object(binding)) throw new TypeError('Interface bindings must be objects');
        const { atom, value } = binding, index = atomIndex(atom), data = metadata(value);
        if (meanings.has(index)) throw new TypeError('Duplicate interface atom');
        if (data.state !== source.state) throw new TypeError('Interface meanings must belong to the private contract session');
        meanings.set(index, data.root);
      }
      if (meanings.size !== names.length) throw new TypeError('Interface must bind every public atom');
      const result = transaction(({ tick, mk }) => inferEvidenceInterface(source.state, source.root,
        names.map((_, i) => meanings.get(i)), { tick, mk, maxNodes, nodes: state.nodes, atoms: names }));
      // Publish neither handle until workspace, bounds and witness checks succeed.
      return freeze({ ...result, necessary: handle(result.necessary), sufficient: handle(result.sufficient) });
    },
    /** Choose cheapest additional public summaries making every named private
     * target exactly expressible. Pure build-time selection; no authenticated facts.
     * @param {{name:string,value:object}[]} targets Private-owned contract handles.
     * @param {{retained?:{atom:string,value:object}[],candidates:{atom:string,value:object,cost?:number}[],maxRounds?:number,maxVerificationWork?:number}} options
     */
    refine(targets, options) {
      return planEvidenceRefinement(api, createEvidenceAlgebra, targets, options);
    },
    /** Check exactness and the price/cardinality certificate without the planner's
     * hitting-set optimizer. Shares the existing semantic abstraction oracle.
     * Malformed data returns false; invalid inputs or exhausted budgets throw.
     */
    verifyRefinement(targets, options, certificate) {
      return verifyEvidenceRefinement(api, createEvidenceAlgebra, targets, options, certificate);
    },
    equivalent(a, b) { return own(a) === own(b); },
    entails(a, b) { return difference(a, b) === 0; },
    counterexample(a, b) {
      let id = difference(a, b);
      if (!id) return null;
      const facts = [];
      while (id > 1) {
        const n = state.nodes[id];
        if (n.low !== 0) id = n.low;
        else { facts.push(names[n.variable]); id = n.high; }
      }
      return Object.freeze(facts);
    },
    evaluate(f, trueAtoms) {
      let id = own(f);
      const yes = trueSet(trueAtoms);
      while (id > 1) { const n = state.nodes[id]; id = yes.has(n.variable) ? n.high : n.low; }
      return id === 1;
    },
    residual(guarantee, target) {
      const g = own(guarantee), t = own(target);
      return handle(transaction(({ apply, negate, interior }) => interior(apply('or', negate(g), t))));
    },
    minimum(f, overrides = []) {
      const r = own(f), prices = names.map(() => 1), seen = new Set();
      for (const item of array(overrides, names.length, 'Evidence prices')) {
        if (!object(item)) throw new TypeError('Evidence price must be an object');
        const { atom, cost } = item, i = atomIndex(atom);
        if (seen.has(i)) throw new TypeError('Duplicate evidence price');
        seen.add(i); prices[i] = integer(cost, 0, 1000000000, 'Evidence price');
      }
      const best = new Map([[0, null], [1, { cost: 0, facts: [] }]]);
      for (const id of nodesFor(state, r)) {
        const n = state.nodes[id], low = best.get(n.low), high = best.get(n.high);
        const take = high && { cost: high.cost + prices[n.variable], facts: [names[n.variable], ...high.facts] };
        best.set(id, !low ? take : !take ? low : low.cost < take.cost ||
          (low.cost === take.cost && low.facts.length <= take.facts.length) ? low : take);
      }
      return freeze(best.get(r));
    },
    inspect(f) {
      const root = own(f), ids = nodesFor(state, root), renumber = new Map([[0, 0], [1, 1]]);
      ids.forEach((id, i) => renumber.set(id, i + 2));
      return freeze({ atoms: names, support: supportFor(state, root), root: renumber.get(root), decisionNodes: ids.length,
        nodes: ids.map(id => { const n = state.nodes[id]; return { atom: names[n.variable], low: renumber.get(n.low), high: renumber.get(n.high) }; }) });
    },
    source(name, f) {
      planReconstruction({ nodes: [name], edges: [] });
      const root = own(f), ids = nodesFor(state, root);
      if (ids.length > 512) throw new RangeError('Evidence source limit is 512 decision nodes');
      const support = supportFor(state, root), local = new Map(ids.map((id, i) => [id, `n${i}`]));
      const ref = id => id === 0 ? 'false' : id === 1 ? 'true' : local.get(id);
      const lines = [
        '// Generated monotone evidence contract; facts must describe CURRENT data.',
        '// Decision order is declaration order. The caller must explicitly require validity.',
        `fn ${name} = facts -> do {`,
        ...support.map(atom => `  let a${atomIndex(atom)} = ((value:Bool) -> value) facts.${atom};`),
        ...ids.map(id => {
          const n = state.nodes[id], tests = [`a${n.variable}`];
          let low = n.low;
          // Preserve decision order while factoring a shared successful branch:
          // x ? H : (y ? H : L) == (x || y) ? H : L.
          while (low > 1 && state.nodes[low].high === n.high) {
            tests.push(`a${state.nodes[low].variable}`); low = state.nodes[low].low;
          }
          const condition = tests.length === 1 ? tests[0] : `(${tests.join(' || ')})`;
          const expression = low === 0 ? (n.high === 1 ? condition : `${condition} && ${ref(n.high)}`)
            : n.high === 1 ? `${condition} || ${ref(low)}`
            : `if ${condition} then ${ref(n.high)} else ${ref(low)}`;
          return `  let ${ref(id)} = ${expression};`;
        }),
        `  ${ref(root)}`, '};', '',
      ];
      return freeze({ name: `${name}.evidence.ass`, source: lines.join('\n'), support, decisionNodes: ids.length });
    },
    get stats() { return Object.freeze({ nodes: state.nodes.length, maxNodes, maxWork }); },
  };
  return Object.freeze(api);
}
