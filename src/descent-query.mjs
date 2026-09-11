import { planDescent } from './descent.mjs';
import { planReconstruction } from './reconstruction.mjs';
import { descentCountermodel } from './descent-extension.mjs';

// Single-goal evidence, not global gluing or a new notion of value equality.
// See docs/DESCENT-QUERIES.md for the metric and support-local guard proofs.
const MAX_TESTS = 4096, MAX_COST = 1_000_000_000;
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function normalize(graph, patches, options) {
  if (!record(graph) || !record(options)) throw new TypeError('Query graph and options must be objects');
  const { nodes, edges } = graph;
  const base = planDescent({ nodes, edges }, patches);
  const domains = new Map(base.patches.map(p => [p.name, new Set(p.nodes)]));
  function pair(value, reflexive = false) {
    if (!record(value)) throw new TypeError('Query comparisons must be objects');
    const { node, left, right } = value;
    if ((!reflexive && left === right) || !domains.get(left)?.has(node) || !domains.get(right)?.has(node))
      throw new TypeError('Query requires known patches sharing its coordinate');
    return { node, left, right };
  }
  function tests(value, weighted) {
    if (!Array.isArray(value)) throw new TypeError('Query evidence must be arrays');
    if (value.length > MAX_TESTS) throw new RangeError(`Query limit is ${MAX_TESTS} evidence items`);
    const result = [];
    for (const item of value) {
      const p = pair(item);
      if (weighted) {
        const supplied = item.cost, cost = supplied === undefined ? 1 : supplied;
        if (!Number.isSafeInteger(cost) || cost < 0 || cost > MAX_COST)
          throw new TypeError(`Query cost must be an integer between 0 and ${MAX_COST}`);
        result.push({ ...p, cost });
      } else result.push(p);
    }
    return result;
  }
  const { query: q, retained: r, candidates: c } = options;
  const query = pair(q, true), retained = tests(r === undefined ? [] : r, false), candidates = tests(c, true);
  if (retained.length + candidates.length > MAX_TESTS) throw new RangeError(`Query limit is ${MAX_TESTS} total evidence items`);
  return { nodes: base.nodes, edges: base.edges, patches: base.patches, query, retained, candidates };
}

// Deliberately independent of the optimizer: walk only the supplied evidence and
// original arrow indices. Costs/optimality metadata play no part in acceptance.
function verify(base, proof) {
  if (!Array.isArray(proof) || proof.length >= base.patches.length) return false;
  let current = base.query.left;
  const seen = new Set([current]);
  for (const step of proof) {
    if (!record(step)) return false;
    const { kind, index, from, to, transport } = step;
    const evidence = kind === 'retained' ? base.retained : kind === 'candidate' ? base.candidates : null;
    if (!evidence || !Number.isSafeInteger(index) || index < 0 || index >= evidence.length) return false;
    const e = evidence[index];
    if (from !== current || seen.has(to) || !((from === e.left && to === e.right) || (from === e.right && to === e.left))) return false;
    if (!Array.isArray(transport) || transport.length >= base.nodes.length) return false;
    let node = e.node;
    const visited = new Set([node]);
    for (const id of transport) {
      if (!Number.isSafeInteger(id) || id < 0 || id >= base.edges.length) return false;
      const edge = base.edges[id];
      if (edge.from !== node || visited.has(edge.to)) return false;
      node = edge.to; visited.add(node);
    }
    if (node !== base.query.node) return false;
    current = to; seen.add(to);
  }
  return current === base.query.right;
}

/** Check a simple transport proof of one equality; never trusts optimization metadata.
 * Valid input graphs/options are required. Malformed proof data returns false.
 * This certifies logical sufficiency, not runtime truth or cheapest cost.
 * @param {Parameters<typeof planDescent>[0]} graph
 * @param {Parameters<typeof planDescent>[1]} patches
 * @param {{query:{node:string,left:string,right:string},retained?:{node:string,left:string,right:string}[],candidates:{node:string,left:string,right:string,cost?:number}[]}} options
 * @param {{kind:'retained'|'candidate',index:number,from:string,to:string,transport:number[]}[]} proof
 */
export function verifyDescentQuery(graph, patches, options, proof) {
  return verify(normalize(graph, patches, options), proof);
}
// A dual witness proves the primary cost optimum by local inequalities alone.
function verifyCost(base, proof, potentials) {
  if (!verify(base, proof) || !Array.isArray(potentials)) return false;
  const members = base.patches.filter(p => p.nodes.includes(base.query.node)).map(p => p.name);
  if (potentials.length !== members.length) return false;
  const values = new Map();
  for (const entry of potentials) {
    if (!record(entry)) return false;
    const { patch, value } = entry;
    if (!members.includes(patch) || values.has(patch) || !Number.isSafeInteger(value) || value < 0 || value > MAX_TESTS * MAX_COST) return false;
    values.set(patch, value);
  }
  // Fixed-point predecessor closure, independent of the optimizer's BFS tree.
  const ancestors = new Set([base.query.node]);
  for (let changed = true; changed;) {
    changed = false;
    for (const e of base.edges) if (ancestors.has(e.to) && !ancestors.has(e.from)) { ancestors.add(e.from); changed = true; }
  }
  for (const [list, retained] of [[base.retained, true], [base.candidates, false]]) for (const e of list) {
    if (ancestors.has(e.node) && Math.abs(values.get(e.left) - values.get(e.right)) > (retained ? 0 : e.cost)) return false;
  }
  const cost = proof.reduce((sum, step) => sum + (step.kind === 'candidate' ? base.candidates[step.index].cost : 0), 0);
  return values.get(base.query.right) - values.get(base.query.left) === cost;
}

/** Verify primary cost optimality from a transport proof and finite dual potentials.
 * Checks generator inequalities, not a shortest-path computation. Does not certify
 * secondary tie-breaking or truth of data. Bad proof/potential data returns false.
 * @param {Parameters<typeof planDescent>[0]} graph
 * @param {Parameters<typeof planDescent>[1]} patches
 * @param {Parameters<typeof verifyDescentQuery>[2]} options
 * @param {Parameters<typeof verifyDescentQuery>[3]} proof
 * @param {{patch:string,value:number}[]} potentials
 */
export function verifyDescentQueryCost(graph, patches, options, proof, potentials) {
  return verifyCost(normalize(graph, patches, options), proof, potentials);
}
const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));

/** Find minimum-cost candidate evidence proving one requested equality, relative
 * to retained facts. Secondary tie breaks minimize new checks, then path length.
 * Costs measure evidence acquisition, not numerical error or emitted loop units.
 * @param {Parameters<typeof planDescent>[0]} graph
 * @param {Parameters<typeof planDescent>[1]} patches
 * @param {Parameters<typeof verifyDescentQuery>[2]} options
 */
export function planDescentQuery(graph, patches, options) {
  const base = normalize(graph, patches, options);
  const { nodes, edges, query, retained, candidates } = base;
  const ni = new Map(nodes.map((node, i) => [node, i]));
  const pi = new Map(base.patches.map((p, i) => [p.name, i]));
  // Reverse BFS chooses one shortest transport to the query for each ancestor.
  const reverse = nodes.map(() => []);
  edges.forEach((e, i) => reverse[ni.get(e.to)].push(i));
  const distance = new Int32Array(nodes.length).fill(-1), nextEdge = new Int32Array(nodes.length).fill(-1);
  const goal = ni.get(query.node), queue = [goal]; distance[goal] = 0;
  for (let head = 0; head < queue.length; head++) for (const id of reverse[queue[head]]) {
    const v = ni.get(edges[id].from);
    if (distance[v] !== -1) continue;
    distance[v] = distance[queue[head]] + 1; nextEdge[v] = id; queue.push(v);
  }
  const adjacency = base.patches.map(() => []);
  for (const [kind, list] of [['retained', retained], ['candidate', candidates]]) list.forEach((e, index) => {
    if (distance[ni.get(e.node)] < 0) return;
    const a = pi.get(e.left), b = pi.get(e.right);
    adjacency[a].push({ kind, index, to: b }); adjacency[b].push({ kind, index, to: a });
  });
  const start = pi.get(query.left), end = pi.get(query.right);
  const best = base.patches.map(() => [Infinity, Infinity, Infinity]), done = new Uint8Array(best.length), previous = best.map(() => null);
  best[start] = [0, 0, 0];
  for (let iteration = 0; iteration < best.length; iteration++) {
    let v = -1;
    for (let i = 0; i < best.length; i++) if (!done[i] && (v === -1 || less(best[i], best[v]))) v = i;
    if (v < 0 || best[v][0] === Infinity) break;
    done[v] = 1; if (v === end) break;
    for (const e of adjacency[v]) {
      const added = e.kind === 'candidate' ? 1 : 0;
      const cost = added ? candidates[e.index].cost : 0;
      const score = [best[v][0] + cost, best[v][1] + added, best[v][2] + 1];
      if (!done[e.to] && less(score, best[e.to])) { best[e.to] = score; previous[e.to] = { ...e, from: v }; }
    }
  }
  const complete = best[end][0] !== Infinity, proof = [];
  let obstruction = null;
  if (complete) {
    for (let v = end; v !== start;) {
      const step = previous[v], e = (step.kind === 'retained' ? retained : candidates)[step.index];
      const transport = [];
      for (let u = ni.get(e.node); u !== goal;) { const id = nextEdge[u]; transport.push(id); u = ni.get(edges[id].to); }
      proof.push({ kind: step.kind, index: step.index, from: base.patches[step.from].name, to: base.patches[v].name, transport });
      v = step.from;
    }
    proof.reverse();
    if (!verify(base, proof)) throw new Error('Descent query bug: generated transport proof is invalid');
  } else {
    const model = descentCountermodel(base, base.patches, [...retained, ...candidates]);
    const classes = model?.nodes.find(n => n.node === query.node)?.classes;
    const leftValue = classes?.findIndex(group => group.includes(query.left));
    const rightValue = classes?.findIndex(group => group.includes(query.right));
    if (!classes || leftValue < 0 || rightValue < 0 || leftValue === rightValue)
      throw new Error('Descent query bug: missing goal-specific countermodel');
    obstruction = { ...model, witness: { ...query, leftValue, rightValue } };
  }
  const potentials = complete ? base.patches.flatMap((p, i) => p.nodes.includes(query.node)
    ? [{ patch: p.name, value: Math.min(best[i][0], best[end][0]) }] : []) : null;
  if (complete && !verifyCost(base, proof, potentials)) throw new Error('Descent query bug: invalid cost certificate');
  const support = new Map(), equations = new Map(), selected = [], usedRetained = [];
  function field(patch, node) { if (!support.has(patch)) support.set(patch, new Set()); support.get(patch).add(node); }
  if (complete) field(query.left, query.node);
  for (const step of proof) {
    const e = (step.kind === 'retained' ? retained : candidates)[step.index];
    (step.kind === 'retained' ? usedRetained : selected).push(step.index);
    for (const patch of [step.from, step.to]) {
      field(patch, e.node);
      for (const id of step.transport) {
        field(patch, edges[id].to);
        equations.set(`${pi.get(patch)}:${id}`, { patch, edge: id });
      }
    }
  }
  return freeze({ ...base, complete, minimumCost: complete ? best[end][0] : null,
    additionalCount: complete ? best[end][1] : null, proof, potentials, selected, usedRetained,
    localEquations: [...equations.values()],
    support: base.patches.filter(p => support.has(p.name)).map(p => ({ patch: p.name, nodes: nodes.filter(node => support.get(p.name).has(node)) })),
    obstruction,
  });
}
function conjunction(xs, a = 0, b = xs.length) {
  if (a === b) return 'true';
  if (b - a === 1) return xs[a];
  const m = a + Math.floor((b - a) / 2);
  return `(${conjunction(xs, a, m)} && ${conjunction(xs, m, b)})`;
}

/** Generate a support-local sufficient guard and guarded selection, not a global
 * join or an exact decision procedure for the runtime equality. checkEvidence
 * rechecks selected retained facts but assumes local coherence; check validates
 * precisely the transport equations. select requires check before returning.
 * @param {string} name
 * @param {Parameters<typeof planDescent>[0]} graph
 * @param {Parameters<typeof planDescent>[1]} patches
 * @param {Parameters<typeof verifyDescentQuery>[2]} options
 */
export function descentQuerySource(name, graph, patches, options) {
  planReconstruction({ nodes: [name], edges: [] });
  const plan = planDescentQuery(graph, patches, options);
  if (!plan.complete) throw new TypeError(`Query not implied: '${plan.query.left}' and '${plan.query.right}' can disagree at '${plan.query.node}'`);
  const ni = new Map(plan.nodes.map((n, i) => [n, i])), pi = new Map(plan.patches.map((p, i) => [p.name, i]));
  const val = (p, n) => `v${pi.get(p)}_${ni.get(n)}`, eq = n => `eq${ni.get(n)}`;
  const bindings = plan.support.flatMap(p => [
    `    let p${pi.get(p.patch)} = pieces.${p.patch};`,
    ...p.nodes.map(n => `    let ${val(p.patch, n)} = p${pi.get(p.patch)}.${n};`),
  ]);
  const evidence = plan.proof.map(s => (s.kind === 'retained' ? plan.retained : plan.candidates)[s.index]);
  const usedEq = new Set(evidence.map(e => e.node));
  const maps = [...new Set(plan.localEquations.map(e => plan.edges[e.edge].map))], mi = new Map(maps.map((m, i) => [m, i]));
  const checks = plan.localEquations.map(({ patch, edge }) => {
    const e = plan.edges[edge]; usedEq.add(e.to);
    return `(${eq(e.to)} (m${mi.get(e.map)} ${val(patch, e.from)}) ${val(patch, e.to)})`;
  });
  const eqBindings = wanted => plan.nodes.filter(n => wanted.has(n)).map(n => `    let ${eq(n)} = same.${n};`);
  const source = [
    '// Generated single-goal proof. This is a sufficient guard, not global gluing.',
    '// checkEvidence assumes coherence; check validates only its transport support.',
    `fn ${name} = maps -> do {`,
    '  let checkEvidence = same -> pieces -> do {', ...bindings,
    ...eqBindings(new Set(evidence.map(e => e.node))),
    `    ((result:Bool) -> result) (${conjunction(evidence.map(e => `(${eq(e.node)} ${val(e.left, e.node)} ${val(e.right, e.node)})`))})`,
    '  };',
    '  let check = same -> pieces -> do {', ...bindings, ...eqBindings(usedEq),
    ...maps.map((m, i) => `    let m${i} = maps.${m};`),
    `    ${conjunction(checks)} && (checkEvidence same pieces)`, '  };',
    `  {checkEvidence, check, select:same -> pieces -> require (check same pieces) pieces.${plan.query.left}.${plan.query.node}}`,
    '};', '',
  ].join('\n');
  return Object.freeze({ name: `${name}.descent-query.ass`, source, plan });
}
