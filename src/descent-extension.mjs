import { planDescent, verifyDescent } from './descent.mjs';
import { planReconstruction } from './reconstruction.mjs';
import { emitDescentSource } from './descent-codegen.mjs';

// Static certificate extension, not a cache of facts about runtime values.
// See docs/DESCENT-EXTENSIONS.md for the spanning/closure distinction.
const MAX_TESTS = 4096, MAX_COST = 1_000_000_000;
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
}
function basePlan(graph, patches) {
  object(graph, 'Descent graph');
  const { nodes, edges } = graph;
  return planDescent({ nodes, edges }, patches);
}
function partition(size) {
  const parent = Array.from({ length: size }, (_, i) => i);
  function root(i) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  return {
    root,
    join(a, b) {
      a = root(a); b = root(b);
      if (a === b) return false;
      parent[Math.max(a, b)] = Math.min(a, b); return true;
    },
    groups(ids) {
      const groups = new Map();
      for (const i of ids) { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
      return [...groups.values()];
    },
  };
}
function comparisons(base, input, weighted, label) {
  if (!Array.isArray(input)) throw new TypeError(`${label} must be an array`);
  if (input.length > MAX_TESTS) throw new RangeError(`Descent extension limit is ${MAX_TESTS} total tests`);
  const domains = new Map(base.patches.map(p => [p.name, new Set(p.nodes)]));
  const result = [];
  for (const entry of input) {
    object(entry, 'Comparison');
    // Capture each caller field once, before validation or source generation.
    const { node, left, right } = entry;
    if (left === right || !domains.get(left)?.has(node) || !domains.get(right)?.has(node))
      throw new TypeError('Comparison requires a known coordinate shared by two distinct patches');
    if (weighted) {
      const supplied = entry.cost, cost = supplied === undefined ? 1 : supplied;
      if (!Number.isSafeInteger(cost) || cost < 0 || cost > MAX_COST)
        throw new TypeError(`Comparison cost must be an integer between 0 and ${MAX_COST}`);
      result.push({ node, left, right, cost });
    } else result.push({ node, left, right });
  }
  return result;
}
function propagate(base, tests) {
  const indices = new Map(base.nodes.map((node, v) => [node, v]));
  const ids = new Map(base.patches.map((p, i) => [p.name, i]));
  const members = base.nodes.map(() => []), forward = base.nodes.map(() => []);
  for (const [i, p] of base.patches.entries()) for (const node of p.nodes) members[indices.get(node)].push(i);
  for (const edge of base.edges) forward[indices.get(edge.from)].push(indices.get(edge.to));
  const connected = base.nodes.map(() => partition(base.patches.length));
  for (const { node, left, right } of tests) {
    const start = indices.get(node), a = ids.get(left), b = ids.get(right);
    const seen = new Uint8Array(base.nodes.length), queue = [start]; seen[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const v = queue[head]; connected[v].join(a, b);
      for (const w of forward[v]) if (!seen[w]) { seen[w] = 1; queue.push(w); }
    }
  }
  const groups = members.map((is, v) => connected[v].groups(is));
  const classOf = groups.map(gs => {
    const values = new Map(); gs.forEach((group, k) => group.forEach(i => values.set(i, k))); return values;
  });
  let witness = null;
  for (let v = 0; v < groups.length; v++) if (groups[v].length > 1) {
    witness = { node: base.nodes[v], left: base.patches[groups[v][0][0]].name,
      right: base.patches[groups[v][1][0]].name, leftValue: 0, rightValue: 1 }; break;
  }
  if (!witness) return null;
  return freeze({
    nodes: base.nodes.map((node, v) => ({ node, classes: groups[v].map(is => is.map(i => base.patches[i].name)) })),
    arrows: base.edges.map(({ from, to, map }, edge) => ({
      edge, from, to, map,
      table: groups[indices.get(from)].map(group => classOf[indices.get(to)].get(group[0])),
    })),
    sections: base.patches.map((p, i) => ({ patch: p.name,
      values: p.nodes.map(node => ({ node, value: classOf[indices.get(node)].get(i) })) })),
    witness,
  });
}

/** Return a finite diagram with coherent local sections satisfying every supplied
 * test but disagreeing at a reported coordinate, or null if tests suffice.
 * This is an abstract countermodel, NOT execution of the application's maps.
 * @param {Parameters<typeof planDescent>[0]} graph
 * @param {Parameters<typeof planDescent>[1]} patches
 * @param {{node:string,left:string,right:string}[]} tests
 */
export function descentCountermodel(graph, patches, tests) {
  const base = basePlan(graph, patches);
  return propagate(base, comparisons(base, tests, false, 'Comparisons'));
}

/** Choose the cheapest allowed comparisons completing explicitly retained facts.
 * Retained facts are assumptions about the CURRENT coherent pieces, not tokens.
 * Full generated check/join will recheck them. Costs are static estimates.
 * @param {Parameters<typeof planDescent>[0]} graph
 * @param {Parameters<typeof planDescent>[1]} patches
 * @param {{retained?:{node:string,left:string,right:string}[], candidates:{node:string,left:string,right:string,cost?:number}[]}} options
 */
export function planDescentExtension(graph, patches, options) {
  object(options, 'Descent extension options');
  const base = basePlan(graph, patches);
  const r = options.retained, c = options.candidates;
  const retained = comparisons(base, r === undefined ? [] : r, false, 'Retained comparisons');
  const candidates = comparisons(base, c, true, 'Candidate comparisons');
  if (retained.length + candidates.length > MAX_TESTS)
    throw new RangeError(`Descent extension limit is ${MAX_TESTS} total tests`);
  const component = new Map(), vertex = [];
  const forests = base.components.map((a, k) => {
    for (const node of a.nodes) component.set(node, k);
    const blocks = new Map();
    a.inheritedGroups.forEach((group, i) => group.forEach(p => blocks.set(p, i)));
    vertex.push(blocks); return partition(a.inheritedGroups.length);
  });
  const insert = ({ node, left, right }) => {
    const k = component.get(node);
    return forests[k].join(vertex[k].get(left), vertex[k].get(right));
  };
  const rank = base.minimumComparisons;
  let retainedRank = 0;
  for (const t of retained) if (insert(t)) retainedRank++;
  const retainedGroups = base.components.map((a, k) => forests[k]
    .groups(a.inheritedGroups.map((_, i) => i)).map(ids => ids.flatMap(i => a.inheritedGroups[i])));
  const order = candidates.map((_, i) => i).sort((a, b) => candidates[a].cost - candidates[b].cost || a - b);
  const selected = [];
  let cost = 0;
  for (const i of order) if (insert(candidates[i])) { selected.push(i); cost += candidates[i].cost; }
  const additional = selected.map(i => {
    const { node, left, right } = candidates[i]; return { node, left, right };
  });
  const achievedRank = retainedRank + selected.length, complete = achievedRank === rank;
  const certificate = [...retained, ...additional];
  // Replay the actual proof via the existing, independent connectivity checker.
  if (verifyDescent(base, base.patches, certificate) !== complete)
    throw new Error('Descent extension bug: rank and propagated certificate disagree');
  return freeze({
    nodes: base.nodes, edges: base.edges, patches: base.patches, owners: base.owners,
    localEquations: base.localEquations,
    components: base.components.map((a, k) => ({ nodes: a.nodes, inheritedGroups: a.inheritedGroups,
      retainedGroups: retainedGroups[k], finalGroups: forests[k]
        .groups(a.inheritedGroups.map((_, i) => i)).map(ids => ids.flatMap(i => a.inheritedGroups[i])) })),
    retained, candidates, selected, additional, comparisons: certificate,
    rank, retainedRank, achievedRank, complete,
    minimumAdditional: complete ? selected.length : null,
    minimumCost: complete ? cost : null,
    obstruction: complete ? null : propagate(base, [...retained, ...candidates]),
  });
}

/** Generate full agree/check/glue/join, plus checkAdditional which ASSUMES local
 * coherence and all retained comparisons of the current pieces. Full check/join
 * never trusts retained inputs without rechecking. Incomplete plans throw.
 * @param {string} name
 * @param {Parameters<typeof planDescent>[0]} graph
 * @param {Parameters<typeof planDescent>[1]} patches
 * @param {Parameters<typeof planDescentExtension>[2]} options
 */
export function descentExtensionSource(name, graph, patches, options) {
  planReconstruction({ nodes: [name], edges: [] });
  const plan = planDescentExtension(graph, patches, options);
  if (!plan.complete) {
    const { node, left, right } = plan.obstruction.witness;
    throw new TypeError(`No descent extension: '${left}' and '${right}' can disagree at '${node}'`);
  }
  return Object.freeze({ name: `${name}.descent-extension.ass`,
    source: emitDescentSource(name, plan, plan.additional), plan });
}
