import { planReconstruction } from './reconstruction.mjs';

// Build-time only. The optimality and equality contracts are in docs/DESCENT.md.
const MAX_PATCHES = 32, MAX_MEMBERSHIPS = 2048, MAX_EQUATIONS = 4096;
const MAX_COMPARISONS = 4096, MAX_COST = 1_000_000_000;
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
}
function frozen(value) {
  // Only newly constructed, bounded-depth arrays and records reach this helper.
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
function cover(graph, patches) {
  const { nodes, edges } = planReconstruction(graph);
  if (!Array.isArray(patches)) throw new TypeError('Descent patches must be an array');
  if (patches.length > MAX_PATCHES) throw new RangeError(`Descent limit is ${MAX_PATCHES} patches`);
  const names = [];
  for (const patch of patches) { object(patch, 'Patch'); names.push(patch.name); }
  // Keep ordinary identifiers, duplicate detection and reserved words in sync.
  planReconstruction({ nodes: names, edges: [] });
  const indices = new Map(nodes.map((node, i) => [node, i]));
  const members = nodes.map(() => []), normalized = [];
  let memberships = 0;
  for (const [i, patch] of patches.entries()) {
    const domain = patch.nodes, name = names[i];
    if (!Array.isArray(domain) || domain.length > nodes.length)
      throw new TypeError('Patch nodes must be an array no longer than the graph');
    memberships += domain.length;
    if (memberships > MAX_MEMBERSHIPS) throw new RangeError(`Descent limit is ${MAX_MEMBERSHIPS} memberships`);
    const included = new Set();
    for (const node of domain) {
      if (!indices.has(node)) throw new TypeError(`Unknown patch node '${String(node)}'`);
      if (included.has(node)) throw new TypeError(`Duplicate node '${node}' in patch '${name}'`);
      included.add(node); members[indices.get(node)].push(i);
    }
    for (const { from, to } of edges) if (included.has(from) && !included.has(to))
      throw new TypeError(`Patch '${name}' is not successor-closed: '${from} -> ${to}'`);
    normalized.push({ name, nodes: nodes.filter(node => included.has(node)) });
  }
  for (let v = 0; v < nodes.length; v++) if (!members[v].length)
    throw new TypeError(`Descent cover misses node '${nodes[v]}'`);
  const forward = nodes.map(() => []);
  let localEquations = 0;
  for (const { from, to } of edges) {
    forward[indices.get(from)].push(indices.get(to));
    localEquations += members[indices.get(from)].length;
  }
  if (localEquations > MAX_EQUATIONS) throw new RangeError(`Descent limit is ${MAX_EQUATIONS} local equations`);
  return { nodes, edges, indices, names, patches: normalized, members, forward, localEquations };
}
function partition(size) {
  const parent = Array.from({ length: size }, (_, i) => i);
  function root(i) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  return {
    root,
    join(a, b) { a = root(a); b = root(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); },
    groups(ids) {
      const groups = new Map();
      for (const i of ids) { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
      return [...groups.values()];
    },
  };
}
function reachable(forward, start) {
  const seen = new Uint8Array(forward.length), queue = [start]; seen[start] = 1;
  for (let head = 0; head < queue.length; head++) for (const next of forward[queue[head]])
    if (!seen[next]) { seen[next] = 1; queue.push(next); }
  return seen;
}

/** Minimum-cost pairwise agreement certificate for coherent, successor-closed patches.
 * Costs are static coordinate-equality estimates, not Wasm iteration allowances.
 * The optimum is uniform over diagrams; see docs/DESCENT.md for its exact scope.
 * @param {Parameters<typeof planReconstruction>[0]} graph
 * @param {{name:string,nodes:string[]}[]} patches
 * @param {{costs?:{node:string,cost:number}[]}} options
 */
export function planDescent(graph, patches, options = {}) {
  object(options, 'Descent options');
  const data = cover(graph, patches);
  const { nodes, edges, indices, names, members, forward, localEquations } = data;
  const costs = nodes.map(() => 1), overridden = new Set();
  const overrides = options.costs;
  if (overrides !== undefined) {
    if (!Array.isArray(overrides) || overrides.length > nodes.length)
      throw new TypeError('Descent costs must be an array no longer than the graph');
    for (const entry of overrides) {
      object(entry, 'Cost');
      const { node, cost } = entry;
      if (!indices.has(node) || overridden.has(node))
        throw new TypeError(`Unknown or duplicate cost node '${String(node)}'`);
      if (!Number.isSafeInteger(cost) || cost < 0 || cost > MAX_COST)
        throw new TypeError(`Descent cost must be an integer between 0 and ${MAX_COST}`);
      overridden.add(node); costs[indices.get(node)] = cost;
    }
  }
  const reach = nodes.map((_, i) => reachable(forward, i));
  const assigned = new Uint8Array(nodes.length), groups = [];
  for (let v = 0; v < nodes.length; v++) {
    if (assigned[v]) continue;
    const group = [];
    for (let w = 0; w < nodes.length; w++) if (reach[v][w] && reach[w][v]) {
      assigned[w] = 1; group.push(w);
    }
    groups.push(group);
  }
  const comparisons = [], components = [];
  let minimumCost = 0;
  for (const group of groups) {
    const v = group[0], inherited = partition(names.length);
    // An ancestor's entire patch set must already agree in any complete proof.
    for (const previous of groups) {
      const u = previous[0];
      if (!reach[u][v] || reach[v][u]) continue;
      for (const i of members[u]) inherited.join(members[u][0], i);
    }
    const blocks = inherited.groups(members[v]);
    const at = group.reduce((best, w) => costs[w] < costs[best] ? w : best, v);
    for (let i = 1; i < blocks.length; i++) {
      comparisons.push({ node: nodes[at], left: names[blocks[0][0]], right: names[blocks[i][0]] });
      minimumCost += costs[at];
    }
    components.push({
      nodes: group.map(w => nodes[w]), patches: members[v].map(i => names[i]),
      inheritedGroups: blocks.map(block => block.map(i => names[i])),
      comparisonNode: nodes[at], requiredComparisons: blocks.length - 1,
    });
  }
  return frozen({
    nodes, edges, patches: data.patches,
    costs: nodes.map((node, v) => ({ node, cost: costs[v] })),
    components, comparisons, minimumComparisons: comparisons.length, minimumCost,
    naiveComparisons: members.reduce((sum, ids) => sum + ids.length * (ids.length - 1) / 2, 0),
    localEquations,
    owners: nodes.map((node, v) => ({ node, patch: names[members[v][0]] })),
  });
}

/** Independently replay a comparison certificate; no SCC optimizer metadata is trusted.
 * Returns true exactly for universally sufficient comparisons on coherent patches.
 * Malformed inputs throw. This does not validate actual values or equality laws.
 * @param {Parameters<typeof planReconstruction>[0]} graph
 * @param {{name:string,nodes:string[]}[]} patches
 * @param {{node:string,left:string,right:string}[]} comparisons
 */
export function verifyDescent(graph, patches, comparisons) {
  const { nodes, indices, names, members, forward } = cover(graph, patches);
  if (!Array.isArray(comparisons)) throw new TypeError('Descent comparisons must be an array');
  if (comparisons.length > MAX_COMPARISONS) throw new RangeError(`Descent limit is ${MAX_COMPARISONS} comparisons`);
  const patchIndex = new Map(names.map((name, i) => [name, i]));
  const connected = nodes.map(() => partition(names.length));
  for (const test of comparisons) {
    object(test, 'Comparison');
    const v = indices.get(test.node), a = patchIndex.get(test.left), b = patchIndex.get(test.right);
    if (v === undefined || a === undefined || b === undefined || a === b ||
        !members[v].includes(a) || !members[v].includes(b))
      throw new TypeError('Comparison requires a known coordinate shared by two distinct patches');
    // Propagate actual comparisons, not the optimizer's inherited-block formula.
    const seen = reachable(forward, v);
    for (let w = 0; w < nodes.length; w++) if (seen[w]) connected[w].join(a, b);
  }
  return members.every((ids, v) => ids.every(i => connected[v].root(i) === connected[v].root(ids[0])));
}

function conjunction(expressions, start = 0, end = expressions.length) {
  if (start === end) return 'true';
  if (end - start === 1) return expressions[start];
  const mid = start + Math.floor((end - start) / 2);
  return `(${conjunction(expressions, start, mid)} && ${conjunction(expressions, mid, end)})`;
}

/** Generate staged agree/check/glue/join methods. join explicitly requires full
 * local coherence and overlap agreement; agree alone assumes local coherence.
 * Equality must be lawful and respected by the maps; these laws are not inferred.
 * @param {string} name
 * @param {Parameters<typeof planReconstruction>[0]} graph
 * @param {{name:string,nodes:string[]}[]} patches
 * @param {Parameters<typeof planDescent>[2]} options
 */
export function descentSource(name, graph, patches, options = {}) {
  planReconstruction({ nodes: [name], edges: [] });
  const plan = planDescent(graph, patches, options);
  const nodeIndex = new Map(plan.nodes.map((node, v) => [node, v]));
  const patchIndex = new Map(plan.patches.map((patch, i) => [patch.name, i]));
  const value = (patch, node) => `v${patchIndex.get(patch)}_${nodeIndex.get(node)}`;
  const bindings = [];
  for (const [i, patch] of plan.patches.entries()) {
    bindings.push(`    let p${i} = pieces.${patch.name};`);
    for (const node of patch.nodes) bindings.push(`    let ${value(patch.name, node)} = p${i}.${node};`);
  }
  const eq = node => `eq${nodeIndex.get(node)}`;
  const eqBindings = nodes => plan.nodes.filter(node => nodes.has(node)).map(node => `    let ${eq(node)} = same.${node};`);
  const agreement = plan.comparisons.map(({ node, left, right }) => `(${eq(node)} ${value(left, node)} ${value(right, node)})`);
  const usedMaps = [...new Set(plan.edges.map(edge => edge.map))];
  const mapIndex = new Map(usedMaps.map((map, i) => [map, i]));
  const local = [];
  for (const patch of plan.patches) {
    const included = new Set(patch.nodes);
    for (const { from, to, map } of plan.edges) if (included.has(from))
      local.push(`(${eq(to)} (m${mapIndex.get(map)} ${value(patch.name, from)}) ${value(patch.name, to)})`);
  }
  const source = [
    '// Generated descent protocol. agree assumes coherence; join checks equations.',
    '// All compressed checks require lawful, map-compatible equality.',
    `fn ${name} = maps -> do {`,
    '  let agree = same -> pieces -> do {', ...bindings,
    ...eqBindings(new Set(plan.comparisons.map(test => test.node))),
    `    ((result:Bool) -> result) (${conjunction(agreement)})`, '  };',
    '  let check = same -> pieces -> do {', ...bindings,
    ...usedMaps.map((map, i) => `    let m${i} = maps.${map};`),
    ...eqBindings(new Set(plan.edges.map(edge => edge.to))),
    `    ${conjunction(local)} && (agree same pieces)`, '  };',
    '  let glue = pieces -> do {', ...bindings,
    `    {${plan.owners.map(({ node, patch }) => `${node}: ${value(patch, node)}`).join(', ')}}`, '  };',
    '  {agree, check, glue, join:same -> pieces -> require (check same pieces) (glue pieces)}',
    '};', '',
  ].join('\n');
  return Object.freeze({ name: `${name}.descent.ass`, source, plan });
}
