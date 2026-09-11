import { planDescent } from './descent.mjs';
import { planReconstruction } from './reconstruction.mjs';
import { planDescentQuery, verifyDescentQuery } from './descent-query.mjs';

// Exact bounded sharing, not independent shortest paths or runtime proof search.
// docs/DESCENT-BATCHES.md states the quantale, frontier and guard contracts.
const MAX_CANDIDATES = 16, MAX_GOALS = 8, MAX_TESTS = 4096, MAX_COST = 1_000_000_000;
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function freeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    for (const child of Object.values(x)) freeze(child);
    Object.freeze(x);
  }
  return x;
}
function normalize(graph, patches, options) {
  if (!record(graph) || !record(options)) throw new TypeError('Batch graph and options must be objects');
  const { nodes, edges } = graph;
  const base = planDescent({ nodes, edges }, patches);
  const { queries: qs, retained: rs, candidates: cs } = options;
  if (!Array.isArray(qs)) throw new TypeError('Batch queries must be an array');
  if (qs.length > MAX_GOALS) throw new RangeError(`Batch limit is ${MAX_GOALS} goals`);
  if (!Array.isArray(cs)) throw new TypeError('Batch candidates must be an array');
  if (cs.length > MAX_CANDIDATES) throw new RangeError(`Exact batch limit is ${MAX_CANDIDATES} candidates`);
  const r = rs === undefined ? [] : rs;
  if (!Array.isArray(r)) throw new TypeError('Batch retained evidence must be an array');
  if (r.length + cs.length > MAX_TESTS) throw new RangeError(`Batch limit is ${MAX_TESTS} total evidence items`);
  const domains = new Map(base.patches.map(p => [p.name, new Set(p.nodes)]));
  function pair(value, reflexive) {
    if (!record(value)) throw new TypeError('Batch queries and evidence must be objects');
    const { node, left, right } = value;
    if ((!reflexive && left === right) || !domains.get(left)?.has(node) || !domains.get(right)?.has(node))
      throw new TypeError('Batch comparison requires known patches sharing its coordinate');
    return { node, left, right };
  }
  const queries = [];
  for (const q of qs) {
    const p = pair(q, true), name = q.name;
    queries.push({ name, ...p });
  }
  planReconstruction({ nodes: queries.map(q => q.name), edges: [] });
  const retained = [];
  for (const e of r) retained.push(pair(e, false));
  const candidates = [];
  for (const e of cs) {
    const p = pair(e, false), supplied = e.cost, cost = supplied === undefined ? 1 : supplied;
    if (!Number.isSafeInteger(cost) || cost < 0 || cost > MAX_COST)
      throw new TypeError(`Batch cost must be an integer between 0 and ${MAX_COST}`);
    candidates.push({ ...p, cost });
  }
  return { nodes: base.nodes, edges: base.edges, patches: base.patches, queries, retained, candidates };
}
function indices(mask, size) {
  const result = [];
  for (let i = 0; i < size; i++) if (mask & (1 << i)) result.push(i);
  return result;
}
function decode(list, size) {
  if (!Array.isArray(list) || list.length > size) return -1;
  let mask = 0, previous = -1;
  for (const i of list) {
    if (!Number.isSafeInteger(i) || i <= previous || i >= size) return -1;
    mask |= 1 << i; previous = i;
  }
  return mask;
}
function cost(base, mask) {
  let total = 0, count = 0;
  for (let i = 0; i < base.candidates.length; i++) if (mask & (1 << i)) { total += base.candidates[i].cost; count++; }
  return [total, count];
}
function cheapest(base, masks) {
  let best = -1, price = Infinity, count = Infinity;
  for (const mask of masks) {
    const [c, n] = cost(base, mask);
    if (c < price || (c === price && (n < count || (n === count && mask < best)))) {
      best = mask; price = c; count = n;
    }
  }
  return { mask: best, cost: best < 0 ? null : price, count: best < 0 ? null : count };
}
function root(parent, i) {
  while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
  return i;
}
function join(parent, a, b) {
  a = root(parent, a); b = root(parent, b);
  if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
}
function models(base) {
  const ni = new Map(base.nodes.map((n, i) => [n, i]));
  const pi = new Map(base.patches.map((p, i) => [p.name, i]));
  const reverse = base.nodes.map(() => []);
  for (const e of base.edges) reverse[ni.get(e.to)].push(ni.get(e.from));
  const cached = new Map();
  return base.queries.map(q => {
    let seen = cached.get(q.node);
    if (!seen) {
      seen = new Uint8Array(base.nodes.length);
      const queue = [ni.get(q.node)]; seen[queue[0]] = 1;
      for (let head = 0; head < queue.length; head++) for (const v of reverse[queue[head]])
        if (!seen[v]) { seen[v] = 1; queue.push(v); }
      cached.set(q.node, seen);
    }
    const seed = Int16Array.from(base.patches, (_, i) => i);
    for (const e of base.retained) if (seen[ni.get(e.node)]) join(seed, pi.get(e.left), pi.get(e.right));
    const edges = base.candidates.map(e => seen[ni.get(e.node)] ? [pi.get(e.left), pi.get(e.right)] : null);
    return { q, seed, edges, left: pi.get(q.left), right: pi.get(q.right),
      members: base.patches.flatMap((p, i) => p.nodes.includes(q.node) ? [i] : []) };
  });
}
function forest(model, mask) {
  const parent = model.seed.slice();
  for (let i = 0; i < model.edges.length; i++) if ((mask & (1 << i)) && model.edges[i])
    join(parent, ...model.edges[i]);
  return parent;
}
function failure(ms, mask) {
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i], p = forest(m, mask);
    if (root(p, m.left) !== root(p, m.right)) return i;
  }
  return -1;
}
function negative(base, model, mask) {
  const parent = forest(model, mask), left = root(parent, model.left);
  return { allowed: indices(mask, base.candidates.length), query: model.q.name,
    cut: model.members.filter(i => root(parent, i) === left).map(i => base.patches[i].name) };
}
function enumerate(base) {
  const ms = models(base), m = base.candidates.length, size = 1 << m;
  const fullFailure = failure(ms, size - 1);
  if (fullFailure >= 0) return { masks: [],
    frontier: { minimal: [], maximalFailures: [negative(base, ms[fullFailure], size - 1)] } };
  // Zero means success, otherwise the index of a failing goal plus one.
  const states = new Uint8Array(size), minimal = [];
  for (let mask = 0; mask < size; mask++) {
    let inherited = false;
    for (let i = 0; i < m; i++) if ((mask & (1 << i)) && states[mask ^ (1 << i)] === 0) { inherited = true; break; }
    if (inherited) continue;
    const failed = failure(ms, mask);
    states[mask] = failed + 1;
    if (failed < 0) minimal.push(mask);
  }
  const maximalFailures = [];
  for (let mask = 0; mask < size; mask++) if (states[mask]) {
    let maximal = true;
    for (let i = 0; i < m; i++) if (!(mask & (1 << i)) && states[mask | (1 << i)]) { maximal = false; break; }
    if (maximal) maximalFailures.push(negative(base, ms[states[mask] - 1], mask));
  }
  return { masks: minimal, frontier: { minimal: minimal.map(mask => indices(mask, m)), maximalFailures } };
}

// Independent certificate checker: fixed-point ancestors and Boolean adjacency,
// not the optimizer's reverse BFS or disjoint sets. Only boundary sets are tested.
function verifierModels(base) {
  const pi = new Map(base.patches.map((p, i) => [p.name, i]));
  return base.queries.map(q => {
    const ancestors = new Set([q.node]);
    for (let changed = true; changed;) {
      changed = false;
      for (const e of base.edges) if (ancestors.has(e.to) && !ancestors.has(e.from)) { ancestors.add(e.from); changed = true; }
    }
    const rows = Uint32Array.from(base.patches, (_, i) => (1 << i) >>> 0);
    for (const e of base.retained) if (ancestors.has(e.node)) {
      const a = pi.get(e.left), b = pi.get(e.right); rows[a] |= 1 << b; rows[b] |= 1 << a;
    }
    close(rows);
    const edges = base.candidates.map(e => ancestors.has(e.node) ? [pi.get(e.left), pi.get(e.right)] : null);
    return { q, rows, edges, pi,
      members: new Set(base.patches.filter(p => p.nodes.includes(q.node)).map(p => p.name)) };
  });
}
function close(rows) {
  for (let k = 0; k < rows.length; k++) for (let i = 0; i < rows.length; i++)
    if (rows[i] & (1 << k)) rows[i] |= rows[k];
}
function implies(model, mask) {
  const rows = model.rows.slice();
  for (let i = 0; i < model.edges.length; i++) if ((mask & (1 << i)) && model.edges[i]) {
    const [a, b] = model.edges[i]; rows[a] |= 1 << b; rows[b] |= 1 << a;
  }
  close(rows);
  return !!(rows[model.pi.get(model.q.left)] & (1 << model.pi.get(model.q.right)));
}
function cutValid(model, mask, cut) {
  if (!Array.isArray(cut) || cut.length > model.members.size) return false;
  let bits = 0;
  for (const patch of cut) {
    if (!model.members.has(patch)) return false;
    const bit = 1 << model.pi.get(patch);
    if (bits & bit) return false;
    bits |= bit;
  }
  if (!(bits & (1 << model.pi.get(model.q.left))) || (bits & (1 << model.pi.get(model.q.right)))) return false;
  for (let i = 0; i < model.rows.length; i++) if ((bits & (1 << i)) && (model.rows[i] & ~bits)) return false;
  for (let i = 0; i < model.edges.length; i++) if ((mask & (1 << i)) && model.edges[i]) {
    const [a, b] = model.edges[i];
    if (!!(bits & (1 << a)) !== !!(bits & (1 << b))) return false;
  }
  return true;
}
function verify(base, plan) {
  if (!record(plan) || !record(plan.frontier)) return false;
  const { minimal, maximalFailures } = plan.frontier;
  const m = base.candidates.length, size = 1 << m;
  if (!Array.isArray(minimal) || !Array.isArray(maximalFailures) || minimal.length + maximalFailures.length > size) return false;
  const ms = verifierModels(base), byName = new Map(ms.map(model => [model.q.name, model]));
  const positive = new Uint8Array(size), negative = new Uint8Array(size), masks = [], badMasks = [];
  for (const entry of minimal) {
    const mask = decode(entry, m);
    if (mask < 0 || positive[mask] || !ms.every(model => implies(model, mask))) return false;
    positive[mask] = 1; masks.push(mask);
  }
  for (const entry of maximalFailures) {
    if (!record(entry)) return false;
    const { allowed, query, cut } = entry;
    const mask = decode(allowed, m), model = byName.get(query);
    if (mask < 0 || negative[mask] || !model || !cutValid(model, mask, cut)) return false;
    negative[mask] = 1; badMasks.push(mask);
  }
  // Upward/downward closure must partition every subset, with no gap or overlap.
  for (let bit = 1; bit < size; bit <<= 1) for (let mask = 0; mask < size; mask++) {
    if (mask & bit) positive[mask] |= positive[mask ^ bit];
    else negative[mask] |= negative[mask | bit];
  }
  for (let mask = 0; mask < size; mask++) if (positive[mask] + negative[mask] !== 1) return false;
  for (const mask of masks) for (let i = 0; i < m; i++)
    if ((mask & (1 << i)) && positive[mask ^ (1 << i)]) return false;
  for (const mask of badMasks) for (let i = 0; i < m; i++)
    if (!(mask & (1 << i)) && negative[mask | (1 << i)]) return false;
  const best = cheapest(base, masks);
  if (plan.complete !== (best.mask >= 0) || plan.minimumCost !== best.cost || plan.additionalCount !== best.count) return false;
  if (!Array.isArray(plan.proofs)) return false;
  const selected = decode(plan.selected, m);
  if (best.mask < 0) return selected === 0 && plan.proofs.length === 0;
  if (selected !== best.mask || plan.proofs.length !== base.queries.length) return false;
  let used = 0;
  for (let i = 0; i < base.queries.length; i++) {
    const entry = plan.proofs[i], query = base.queries[i];
    if (!record(entry) || entry.name !== query.name ||
        !verifyDescentQuery(base, base.patches, { query, retained: base.retained, candidates: base.candidates }, entry.proof)) return false;
    for (const step of entry.proof) if (step.kind === 'candidate') {
      if (!(selected & (1 << step.index))) return false;
      used |= 1 << step.index;
    }
  }
  return used === selected;
}

/** Verify an exact two-sided frontier, cheapest selected support and named goal
 * proofs. Does not check display/support metadata or runtime truth. The batch
 * subset search is not called. Malformed certificate data returns false; bad graph/options throw.
 * @param {Parameters<typeof planDescent>[0]} graph
 * @param {Parameters<typeof planDescent>[1]} patches
 * @param {Parameters<typeof planDescentBatch>[2]} options
 * @param {ReturnType<typeof planDescentBatch>} plan
 */
export function verifyDescentBatch(graph, patches, options, plan) {
  return verify(normalize(graph, patches, options), plan);
}

/** Exact shared evidence for up to eight named goals and sixteen candidates.
 * Keeps all inclusion-minimal supports; charges each candidate once across goals.
 * Nonnegative acquisition costs are not Wasm fuel or transport-evaluation costs.
 * @param {Parameters<typeof planDescent>[0]} graph
 * @param {Parameters<typeof planDescent>[1]} patches
 * @param {{queries:{name:string,node:string,left:string,right:string}[],retained?:{node:string,left:string,right:string}[],candidates:{node:string,left:string,right:string,cost?:number}[]}} options
 */
export function planDescentBatch(graph, patches, options) {
  const base = normalize(graph, patches, options);
  const { masks, frontier } = enumerate(base), best = cheapest(base, masks);
  const complete = best.mask >= 0, selected = complete ? indices(best.mask, base.candidates.length) : [];
  const proofs = [], support = new Map(), equations = new Map(), usedRetained = new Set();
  const ni = new Map(base.nodes.map((n, i) => [n, i])), pi = new Map(base.patches.map((p, i) => [p.name, i]));
  function field(p, n) { if (!support.has(p)) support.set(p, new Set()); support.get(p).add(n); }
  let obstruction = null;
  if (complete) {
    for (const query of base.queries) {
      const local = planDescentQuery(base, base.patches, { query, retained: base.retained,
        candidates: selected.map(i => base.candidates[i]) });
      if (!local.complete) throw new Error('Batch bug: selected support does not prove a goal');
      const proof = local.proof.map(s => ({ ...s, index: s.kind === 'candidate' ? selected[s.index] : s.index }));
      proofs.push({ name: query.name, proof }); field(query.left, query.node);
      for (const step of proof) {
        const e = (step.kind === 'retained' ? base.retained : base.candidates)[step.index];
        if (step.kind === 'retained') usedRetained.add(step.index);
        for (const patch of [step.from, step.to]) {
          field(patch, e.node);
          for (const id of step.transport) {
            field(patch, base.edges[id].to);
            equations.set(`${pi.get(patch)}:${id}`, { patch, edge: id });
          }
        }
      }
    }
  } else {
    const query = base.queries.find(q => q.name === frontier.maximalFailures[0].query);
    obstruction = planDescentQuery(base, base.patches, { query, retained: base.retained, candidates: base.candidates }).obstruction;
  }
  const plan = { ...base, complete, minimumCost: best.cost, additionalCount: best.count,
    selected, frontier, proofs, usedRetained: [...usedRetained].sort((a, b) => a - b),
    localEquations: [...equations.values()],
    support: base.patches.filter(p => support.has(p.name)).map(p => ({ patch: p.name,
      nodes: [...support.get(p.name)].sort((a, b) => ni.get(a) - ni.get(b)) })), obstruction };
  if (!verify(base, plan)) throw new Error('Batch bug: frontier or proof certificate failed independent verification');
  return freeze(plan);
}
function conjunction(xs, a = 0, b = xs.length) {
  if (a === b) return 'true';
  if (b - a === 1) return xs[a];
  const mid = a + Math.floor((b - a) / 2);
  return `(${conjunction(xs, a, mid)} && ${conjunction(xs, mid, b)})`;
}

/** Generate one atomic support-local batch guard. Evidence labels and transport
 * equations shared between goals are checked once. Used retained facts are always
 * rechecked. select is sufficient for the named goals, not a global join or an
 * exact runtime equality decision. Existing lawful-equality requirements apply.
 * @param {string} name
 * @param {Parameters<typeof planDescent>[0]} graph
 * @param {Parameters<typeof planDescent>[1]} patches
 * @param {Parameters<typeof planDescentBatch>[2]} options
 */
export function descentBatchSource(name, graph, patches, options) {
  planReconstruction({ nodes: [name], edges: [] });
  const plan = planDescentBatch(graph, patches, options);
  if (!plan.complete) {
    const { node, left, right } = plan.obstruction.witness;
    throw new TypeError(`Batch not implied: '${left}' and '${right}' can disagree at '${node}'`);
  }
  const ni = new Map(plan.nodes.map((n, i) => [n, i])), pi = new Map(plan.patches.map((p, i) => [p.name, i]));
  const val = (p, n) => `v${pi.get(p)}_${ni.get(n)}`, eq = n => `eq${ni.get(n)}`;
  const bindings = plan.support.flatMap(p => [`    let p${pi.get(p.patch)} = pieces.${p.patch};`,
    ...p.nodes.map(n => `    let ${val(p.patch, n)} = p${pi.get(p.patch)}.${n};`)]);
  const evidence = [...plan.usedRetained.map(i => plan.retained[i]), ...plan.selected.map(i => plan.candidates[i])];
  const maps = [...new Set(plan.localEquations.map(e => plan.edges[e.edge].map))], mi = new Map(maps.map((m, i) => [m, i]));
  const eqBindings = wanted => plan.nodes.filter(n => wanted.has(n)).map(n => `    let ${eq(n)} = same.${n};`);
  const local = plan.localEquations.map(({ patch, edge }) => {
    const e = plan.edges[edge]; return `(${eq(e.to)} (m${mi.get(e.map)} ${val(patch, e.from)}) ${val(patch, e.to)})`;
  });
  const values = `{${plan.queries.map(q => `${q.name}: pieces.${q.left}.${q.node}`).join(', ')}}`;
  const source = [
    '// Generated shared proof guard. select validates the whole named batch.',
    '// Evidence and local equations are deduplicated; retained facts are rechecked.',
    `fn ${name} = maps -> do {`,
    '  let checkEvidence = same -> pieces -> do {', ...bindings,
    ...eqBindings(new Set(evidence.map(e => e.node))),
    `    ((result:Bool) -> result) (${conjunction(evidence.map(e => `(${eq(e.node)} ${val(e.left, e.node)} ${val(e.right, e.node)})`))})`,
    '  };',
    '  let check = same -> pieces -> do {', ...bindings,
    ...eqBindings(new Set(plan.localEquations.map(e => plan.edges[e.edge].to))),
    ...maps.map((m, i) => `    let m${i} = maps.${m};`),
    `    ${conjunction(local)} && (checkEvidence same pieces)`, '  };',
    `  {checkEvidence, check, select:same -> pieces -> require (check same pieces) ${values}}`,
    '};', '',
  ].join('\n');
  return Object.freeze({ name: `${name}.descent-batch.ass`, source, plan });
}
