import { planReconstruction } from './reconstruction.mjs';

// Internal law-aware quotient. Original evidence sessions and their semantics
// are never mutated. See docs/EVIDENCE-PRESENTATIONS.md for image/transport proofs.
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function array(x, max, label) {
  if (!Array.isArray(x)) throw new TypeError(`${label} must be an array`);
  if (x.length > max) throw new RangeError(`${label} limit is ${max}`);
  return x;
}
function freeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    for (const value of Object.values(x)) freeze(value);
    Object.freeze(x);
  }
  return x;
}
function facts(input, names) {
  const yes = new Set(), indices = new Map(names.map((name, i) => [name, i]));
  for (const name of array(input, names.length, 'Evidence facts')) {
    const i = indices.get(name);
    if (i === undefined || yes.has(i)) throw new TypeError('Facts must be distinct known atom names');
    yes.add(i);
  }
  return yes;
}
const arena = maxNodes => ({ nodes: [null, null], unique: new Map(), maxNodes });
function rollback(a, start) {
  for (let id = a.nodes.length - 1; id >= start; id--) {
    const n = a.nodes[id]; a.unique.delete(`${n.variable}:${n.low}:${n.high}`);
  }
  a.nodes.length = start;
}
// Caches belong to one operation, not to the lifetime of an arena.
function operations(a, tick) {
  const { nodes, unique, maxNodes } = a;
  const applications = new Map(), negations = new Map(), closures = new Map();
  function mk(variable, low, high) {
    tick();
    if (low === high) return low;
    const key = `${variable}:${low}:${high}`;
    if (unique.has(key)) return unique.get(key);
    if (nodes.length >= maxNodes) throw new RangeError('Evidence presentation node limit exceeded');
    const id = nodes.length; nodes.push({ variable, low, high }); unique.set(key, id); return id;
  }
  function apply(op, x, y) {
    tick();
    if (x > y) [x, y] = [y, x];
    if (x === y) return x;
    if (op === 'and') { if (x === 0) return 0; if (x === 1) return y; }
    else { if (x === 0) return y; if (x === 1) return 1; }
    const key = `${op}:${x}:${y}`;
    if (applications.has(key)) return applications.get(key);
    const xn = nodes[x], yn = nodes[y], v = Math.min(xn.variable, yn.variable);
    const r = mk(v,
      apply(op, xn.variable === v ? xn.low : x, yn.variable === v ? yn.low : y),
      apply(op, xn.variable === v ? xn.high : x, yn.variable === v ? yn.high : y));
    applications.set(key, r); return r;
  }
  const and = (x, y) => apply('and', x, y), or = (x, y) => apply('or', x, y);
  function not(id) {
    tick();
    if (id < 2) return 1 - id;
    if (negations.has(id)) return negations.get(id);
    const n = nodes[id], r = mk(n.variable, not(n.low), not(n.high));
    negations.set(id, r); negations.set(r, id); return r;
  }
  function closure(id, upward) {
    tick();
    if (id < 2) return id;
    const key = `${+upward}:${id}`;
    if (closures.has(key)) return closures.get(key);
    const n = nodes[id], low = closure(n.low, upward), high = closure(n.high, upward);
    const r = upward ? mk(n.variable, low, or(low, high)) : mk(n.variable, and(low, high), high);
    closures.set(key, r); return r;
  }
  function copier(sourceNodes, rename = i => i) {
    const memo = new Map();
    function copy(id) {
      tick();
      if (id < 2) return id;
      if (memo.has(id)) return memo.get(id);
      const n = sourceNodes[id], r = mk(rename(n.variable), copy(n.low), copy(n.high));
      memo.set(id, r); return r;
    }
    return copy;
  }
  function exists(root, eliminate) {
    const memo = new Map();
    function visit(id) {
      tick();
      if (id < 2) return id;
      if (memo.has(id)) return memo.get(id);
      const n = nodes[id], low = visit(n.low), high = visit(n.high);
      const r = eliminate(n.variable) ? or(low, high) : mk(n.variable, low, high);
      memo.set(id, r); return r;
    }
    return visit(root);
  }
  function evaluate(root, yes) {
    let id = root;
    while (id > 1) { tick(); const n = nodes[id]; id = yes.has(n.variable) ? n.high : n.low; }
    return id === 1;
  }
  function witness(root) {
    if (!root) throw new Error('Evidence presentation bug: no witness');
    const yes = new Set();
    while (root > 1) {
      tick(); const n = nodes[root];
      if (n.low) root = n.low;
      else { yes.add(n.variable); root = n.high; }
    }
    return yes;
  }
  function reachable(roots) {
    const seen = new Set(), stack = [...roots];
    while (stack.length) {
      tick(); const id = stack.pop();
      if (id < 2 || seen.has(id)) continue;
      seen.add(id); const n = nodes[id]; stack.push(n.low, n.high);
    }
    return [...seen].sort((a, b) => a - b);
  }
  function snapshot(root, names) {
    const ids = reachable([root]), remap = new Map([[0, 0], [1, 1]]), used = new Set();
    ids.forEach((id, i) => { remap.set(id, i + 2); used.add(nodes[id].variable); });
    return { atoms: names, root: remap.get(root), decisionNodes: ids.length,
      support: names.filter((_, i) => used.has(i)), nodes: ids.map(id => {
        const n = nodes[id]; return { atom: names[n.variable], low: remap.get(n.low), high: remap.get(n.high) };
      }) };
  }
  function minimum(root, prices) {
    const memo = new Map([[0, null], [1, { cost: 0, facts: [] }]]);
    function visit(id) {
      tick();
      if (memo.has(id)) return memo.get(id);
      const n = nodes[id], low = visit(n.low), high = visit(n.high);
      const take = high && { cost: high.cost + prices[n.variable], facts: [n.variable, ...high.facts] };
      const best = !low ? take : !take ? low : low.cost < take.cost ||
        (low.cost === take.cost && low.facts.length <= take.facts.length) ? low : take;
      memo.set(id, best); return best;
    }
    return visit(root);
  }
  return { nodes, mk, and, or, not, up: id => closure(id, true), interior: id => closure(id, false),
    atom: i => mk(i, 0, 1), copier, exists, evaluate, witness, reachable, snapshot, minimum };
}

// Exact image, not pairwise implications. Quantify variables only after their
// last use by a future public summary, preserving all still-relevant constraints.
function image(privateOps, publicOps, meanings, privateCount, tick) {
  const last = new Int16Array(privateCount).fill(-1);
  meanings.forEach((r, i) => {
    for (const id of privateOps.reachable([r])) last[privateOps.nodes[id].variable] = i;
  });
  const memo = new Map(), forgotten = new Map();
  function visit(position, condition) {
    tick();
    const fk = `${position}:${condition}`;
    if (!forgotten.has(fk)) forgotten.set(fk, privateOps.exists(condition, v => last[v] < position));
    condition = forgotten.get(fk);
    if (!condition) return 0;
    if (position === meanings.length) return 1;
    const key = `${position}:${condition}`;
    if (memo.has(key)) return memo.get(key);
    const low = visit(position + 1, privateOps.and(condition, privateOps.not(meanings[position])));
    const high = visit(position + 1, privateOps.and(condition, meanings[position]));
    const r = publicOps.mk(position, low, high); memo.set(key, r); return r;
  }
  return visit(0, 1);
}

// This works on arbitrary image laws, including nonmonotone Boolean schemas.
function emit(name, names, w, root, schema) {
  const ids = w.reachable([schema, root]);
  if (ids.length > 512) throw new RangeError('Evidence presentation source limit is 512 decision nodes');
  const used = new Set(ids.map(id => w.nodes[id].variable));
  const labels = new Map(ids.map((id, i) => [id, `n${i}`]));
  const ref = id => id === 0 ? 'false' : id === 1 ? 'true' : labels.get(id);
  const test = v => `a${v}`;
  function expression(id) {
    const n = w.nodes[id], x = test(n.variable), l = w.nodes[n.low], h = w.nodes[n.high];
    // x ? (y ? K : 0) : (y ? 0 : K), and analogous pairs, share K.
    // Factoring evaluates x, then y, then K in precisely the original order.
    if (l && h && l.variable === h.variable) {
      const nonzero = new Set([l.low, l.high, h.low, h.high].filter(i => i !== 0));
      if (nonzero.size === 1) {
        const k = [...nonzero][0], y = test(l.variable);
        const gate = node => node.low === 0 ? y : `(!${y})`;
        const condition = `(if ${x} then ${gate(h)} else ${gate(l)})`;
        return k === 1 ? condition : `${condition} && ${ref(k)}`;
      }
    }
    let low = n.low;
    const tests = [x];
    while (low > 1 && w.nodes[low].high === n.high) {
      tests.push(test(w.nodes[low].variable)); low = w.nodes[low].low;
    }
    const condition = tests.length === 1 ? x : `(${tests.join(' || ')})`;
    if (low === 0) return n.high === 1 ? condition : `${condition} && ${ref(n.high)}`;
    if (n.high === 1) return `${condition} || ${ref(low)}`;
    if (n.high === 0) return `(!${condition}) && ${ref(low)}`;
    if (low === 1) return `(!${condition}) || ${ref(n.high)}`;
    return `if ${condition} then ${ref(n.high)} else ${ref(low)}`;
  }
  const source = [
    '// Generated presentation predicate. Schema validity is not authentication.',
    `fn ${name} = facts -> do {`,
    ...names.flatMap((atom, i) => used.has(i) ? [`  let a${i} = ((v:Bool) -> v) facts.${atom};`] : []),
    ...ids.map(id => `  let ${ref(id)} = ${expression(id)};`),
    `  ${schema === 1 ? ref(root) : `require (${ref(schema)}) (${ref(root)})`}`, '};', '',
  ].join('\n');
  return { name: `${name}.presentation.ass`, source,
    support: names.filter((_, i) => used.has(i)), decisionNodes: ids.length };
}

export function createEvidencePresentation(source, bindings, limits) {
  const names = Object.freeze(bindings.map(b => b.atom)), privateNames = source.atoms;
  const priv = arena(limits.maxNodes), pub = arena(limits.maxNodes);
  function transaction(fn) {
    const start = [priv.nodes.length, pub.nodes.length];
    let used = 0;
    const tick = () => { if (++used > limits.maxWork) throw new RangeError('Evidence presentation work limit exceeded'); };
    try { return fn(operations(priv, tick), operations(pub, tick), tick); }
    catch (error) { rollback(priv, start[0]); rollback(pub, start[1]); throw error; }
  }
  const initial = transaction((p, q, tick) => {
    const copy = p.copier(source.nodes), meanings = bindings.map(b => copy(b.root));
    const schema = image(p, q, meanings, privateNames.length, tick);
    if (!schema) throw new Error('Evidence presentation bug: image must be nonempty');
    return { meanings, schema, top: q.up(schema) };
  });
  const { meanings, schema } = initial;
  const handles = new Map(), roots = new WeakMap();
  function handle(root) {
    if (!handles.has(root)) {
      const h = Object.freeze({ kind: 'presented-evidence-contract' }); handles.set(root, h); roots.set(h, root);
    }
    return handles.get(root);
  }
  function own(h) {
    if (!roots.has(h)) throw new TypeError('Expected a contract owned by this evidence presentation');
    return roots.get(h);
  }
  const canonical = (q, root) => q.up(q.and(schema, root));
  function combine(input, and) {
    const rs = Array.from(array(input, 4096, 'Presentation contracts'), own);
    return handle(transaction((p, q) => canonical(q, rs.reduce(and ? q.and : q.or, and ? 1 : 0))));
  }
  function pullback(qroot, p, q, tick) {
    const memo = new Map();
    function visit(id) {
      tick();
      if (id < 2) return id;
      if (memo.has(id)) return memo.get(id);
      const n = q.nodes[id], r = p.or(visit(n.low), p.and(meanings[n.variable], visit(n.high)));
      memo.set(id, r); return r;
    }
    return visit(qroot);
  }
  const api = {
    atoms: names, always: handle(initial.top), never: handle(0),
    atom(name) {
      const i = names.indexOf(name);
      if (i < 0) throw new TypeError('Unknown presentation atom');
      return handle(transaction((p, q) => canonical(q, q.atom(i))));
    },
    all(input) { return combine(input, true); },
    any(input) { return combine(input, false); },
    fromFrontier(input) {
      const terms = Array.from(array(input, 4096, 'Presentation frontier'), t => facts(t, names));
      return handle(transaction((p, q) => {
        let result = 0;
        for (const term of terms) {
          let r = 1; for (const i of term) r = q.and(r, q.atom(i));
          result = q.or(result, r);
        }
        return canonical(q, result);
      }));
    },
    equivalent(a, b) { return own(a) === own(b); },
    entails(a, b) {
      const ar = own(a), br = own(b);
      return transaction((p, q) => q.and(ar, q.not(br)) === 0);
    },
    counterexample(a, b) {
      const ar = own(a), br = own(b);
      return transaction((p, q) => {
        const bad = q.and(schema, q.and(ar, q.not(br)));
        if (!bad) return null;
        const yes = q.witness(bad); return freeze(names.filter((_, i) => yes.has(i)));
      });
    },
    residual(a, b) {
      const ar = own(a), br = own(b);
      return handle(transaction((p, q) => canonical(q, q.interior(q.or(q.not(schema), q.or(q.not(ar), br))))));
    },
    isRealizable(input) {
      const yes = facts(input, names); return transaction((p, q) => q.evaluate(schema, yes));
    },
    view(input) {
      const yes = facts(input, privateNames);
      return transaction(p => freeze(names.filter((_, i) => p.evaluate(meanings[i], yes))));
    },
    evaluate(h, input) {
      const root = own(h), yes = facts(input, names);
      return transaction((p, q) => {
        if (!q.evaluate(schema, yes)) throw new TypeError('Unrealizable public evidence view');
        return q.evaluate(root, yes);
      });
    },
    minimum(h, overrides = []) {
      const root = own(h), prices = names.map(() => 1), seen = new Set();
      for (const entry of array(overrides, names.length, 'Presentation prices')) {
        if (!object(entry)) throw new TypeError('Presentation prices must be objects');
        const { atom, cost } = entry, i = names.indexOf(atom);
        if (i < 0 || seen.has(i)) throw new TypeError('Unknown or duplicate priced atom');
        if (!Number.isSafeInteger(cost) || cost < 0 || cost > 1000000000)
          throw new RangeError('Presentation price must be an integer in [0,1000000000]');
        seen.add(i); prices[i] = cost;
      }
      return transaction((p, q) => {
        const best = q.minimum(q.and(schema, root), prices);
        return best && freeze({ cost: best.cost, facts: best.facts.map(i => names[i]) });
      });
    },
    inspect(h) { const root = own(h); return transaction((p, q) => freeze(q.snapshot(root, names))); },
    inspectLaws() { return transaction((p, q) => freeze(q.snapshot(schema, names))); },
    source(name, h) {
      const root = own(h); planReconstruction({ nodes: [name], edges: [] });
      return transaction((p, q) => freeze(emit(name, names, q, root, schema)));
    },
    sourcePrivate(name, h) {
      const root = own(h); planReconstruction({ nodes: [name], edges: [] });
      return transaction((p, q, tick) => freeze(emit(name, privateNames, p, pullback(root, p, q, tick), 1)));
    },
    auditTransport() {
      return transaction((p, q, tick) => auditImageTransport(p, meanings, privateNames, names, limits, tick));
    },
    get stats() { return Object.freeze({ privateNodes: priv.nodes.length, publicNodes: pub.nodes.length, ...limits }); },
  };
  return Object.freeze(api);
}

function auditImageTransport(p, meanings, privateNames, names, limits, tick) {
  const support = meanings.map(r => p.reachable([r]).reduce((s, id) => s | (1n << BigInt(p.nodes[id].variable)), 0n));
  const remaining = new Set(meanings.flatMap((r, i) => r > 1 ? [i] : []));
  let symbolicComponents = 0, independentComponents = 0;
  const constantSummaries = meanings.length - remaining.size;
  while (remaining.size) {
    const first = remaining.values().next().value, group = [first]; remaining.delete(first);
    let used = support[first];
    for (let head = 0; head < group.length; head++) for (const i of remaining) {
      tick(); if (support[group[head]] & support[i]) { remaining.delete(i); group.push(i); used |= support[i]; }
    }
    if (group.length === 1) { independentComponents++; continue; }
    symbolicComponents++;
    const w = operations(arena(limits.maxNodes), tick);
    const copyS = w.copier(p.nodes, i => 3 * i), copyV = w.copier(p.nodes, i => 3 * i + 1), copyU = w.copier(p.nodes, i => 3 * i + 2);
    const ss = group.map(i => copyS(meanings[i])), vs = group.map(i => copyV(meanings[i])), us = group.map(i => copyU(meanings[i]));
    let relation = 1, order = 1;
    const last = new Int16Array(privateNames.length).fill(-1);
    group.forEach((g, j) => {
      for (let i = 0; i < privateNames.length; i++) { tick(); if (support[g] & (1n << BigInt(i))) last[i] = j; }
    });
    for (let i = privateNames.length - 1; i >= 0; i--) if (used & (1n << BigInt(i)))
      relation = w.mk(3 * i, relation, w.mk(3 * i + 2, 0, relation));
    for (let j = 0; j < group.length; j++) {
      const equal = w.and(w.or(w.not(us[j]), vs[j]), w.or(w.not(vs[j]), us[j]));
      relation = w.exists(w.and(relation, equal), v => v % 3 === 2 && last[(v - 2) / 3] <= j);
      order = w.and(order, w.or(w.not(ss[j]), vs[j]));
    }
    const bad = w.and(order, w.not(relation));
    if (!bad) continue;
    const assignment = w.witness(bad), current = new Set(), elsewhere = new Set();
    for (const v of assignment) {
      if (v % 3 === 2) throw new Error('Evidence presentation bug: unquantified future variable');
      (v % 3 === 0 ? current : elsewhere).add(Math.floor(v / 3));
    }
    const view = names.filter((_, i) => p.evaluate(meanings[i], current));
    const requested = names.filter((_, i) => p.evaluate(meanings[i], elsewhere));
    // Recheck an ordinary exact fiber, independently of triple-state quantification.
    let fiber = 1;
    for (const i of [...current].sort((a, b) => b - a)) fiber = p.mk(i, 0, fiber);
    for (let i = 0; i < meanings.length; i++) fiber = p.and(fiber, requested.includes(names[i]) ? meanings[i] : p.not(meanings[i]));
    if (fiber !== 0 || !view.every(n => requested.includes(n))) throw new Error('Evidence presentation bug: invalid image obstruction');
    const target = names.filter(n => !requested.includes(n)).map(extra => names.filter(n => n === extra || requested.includes(n)));
    return freeze({ schemaVersion: 1, preservesImplication: false, symbolicComponents, independentComponents, constantSummaries,
      obstruction: { current: privateNames.filter((_, i) => current.has(i)), view, requested,
        realizableWitness: privateNames.filter((_, i) => elsewhere.has(i)), guarantee: [requested], target } });
  }
  return freeze({ schemaVersion: 1, preservesImplication: true, obstruction: null, symbolicComponents, independentComponents, constantSummaries });
}
