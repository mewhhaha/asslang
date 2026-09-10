// Build-time planning only. See docs/RECONSTRUCTION.md for the coherence contract.
const MAX_NODES = 256;
const MAX_EDGES = 2048;
const MAX_IDENTIFIER = 64;
const reserved = new Set(['fn', 'export', 'host', 'let', 'if', 'then', 'else',
  'true', 'false', 'do', 'effect', 'perform']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
}
function identifier(value, label) {
  if (typeof value !== 'string' || value.length > MAX_IDENTIFIER ||
      !/^[A-Za-z_][A-Za-z_0-9]*$/.test(value) || reserved.has(value))
    throw new TypeError(`${label} must be a non-reserved Asslang identifier of at most ${MAX_IDENTIFIER} characters`);
  return value;
}
function snapshotGraph(graph) {
  object(graph, 'Reconstruction graph');
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    throw new TypeError('Reconstruction nodes and edges must be arrays');
  if (graph.nodes.length > MAX_NODES || graph.edges.length > MAX_EDGES)
    throw new RangeError(`Reconstruction limit is ${MAX_NODES} nodes and ${MAX_EDGES} edges`);
  const nodes = [], indices = new Map();
  // Iteration, rather than Array.map, also rejects holes in sparse arrays.
  for (const node of graph.nodes) {
    identifier(node, 'Node');
    if (indices.has(node)) throw new TypeError(`Duplicate reconstruction node '${node}'`);
    indices.set(node, nodes.length); nodes.push(node);
  }
  const edges = [];
  for (const edge of graph.edges) {
    object(edge, 'Edge');
    const from = identifier(edge.from, 'Edge source');
    const to = identifier(edge.to, 'Edge target');
    const map = identifier(edge.map, 'Edge map');
    if (!indices.has(from) || !indices.has(to))
      throw new TypeError(`Unknown reconstruction endpoint in '${from} -> ${to}'`);
    edges.push(Object.freeze({ from, to, map }));
  }
  return { nodes, indices, edges };
}

/** Analyze a finite graph of pure unary observation maps, without executing them.
 * An omitted observed set selects one seed per source SCC. Explicit observations
 * are never supplemented. The distance is universal over diagrams, not a claim
 * about a particular map dictionary. Empty diagrams have distance null.
 * @param {{nodes: string[], edges: {from: string, to: string, map: string}[]}} graph
 * @param {{observed?: string[]}} options
 */
export function planReconstruction(graph, options = {}) {
  object(options, 'Reconstruction options');
  const { nodes, indices, edges } = snapshotGraph(graph);
  let observed;
  if (options.observed !== undefined) {
    if (!Array.isArray(options.observed) || options.observed.length > nodes.length)
      throw new TypeError('Observed nodes must be an array with no more entries than the graph');
    observed = new Set();
    for (const name of options.observed) {
      identifier(name, 'Observed node');
      if (!indices.has(name)) throw new TypeError(`Unknown observed node '${name}'`);
      if (observed.has(name)) throw new TypeError(`Duplicate observed node '${name}'`);
      observed.add(name);
    }
  }
  const forward = nodes.map(() => []), reverse = nodes.map(() => []);
  for (let i = 0; i < edges.length; i++) {
    const a = indices.get(edges[i].from), b = indices.get(edges[i].to);
    forward[a].push(i); reverse[b].push(a);
  }

  // Iterative Kosaraju: finishing order, then components on reversed edges.
  const seen = new Uint8Array(nodes.length), finished = [];
  for (let start = 0; start < nodes.length; start++) {
    if (seen[start]) continue;
    seen[start] = 1;
    const stack = [{ vertex: start, next: 0 }];
    while (stack.length) {
      const frame = stack.at(-1), outgoing = forward[frame.vertex];
      if (frame.next === outgoing.length) {
        finished.push(frame.vertex); stack.pop();
      } else {
        const to = indices.get(edges[outgoing[frame.next++]].to);
        if (!seen[to]) { seen[to] = 1; stack.push({ vertex: to, next: 0 }); }
      }
    }
  }
  const component = new Int32Array(nodes.length).fill(-1);
  let count = 0;
  for (let i = finished.length - 1; i >= 0; i--) {
    const start = finished[i];
    if (component[start] !== -1) continue;
    component[start] = count;
    const stack = [start];
    while (stack.length) {
      for (const from of reverse[stack.pop()]) {
        if (component[from] !== -1) continue;
        component[from] = count; stack.push(from);
      }
    }
    count++;
  }
  const groups = Array.from({ length: count }, () => []);
  for (let i = 0; i < nodes.length; i++) groups[component[i]].push(i);
  const incoming = new Uint8Array(count);
  for (const { from, to } of edges) {
    const a = component[indices.get(from)], b = component[indices.get(to)];
    if (a !== b) incoming[b] = 1;
  }
  const sources = groups.filter((_, i) => !incoming[i]).sort((a, b) => a[0] - b[0]);
  const sourceComponents = Object.freeze(sources.map(group => Object.freeze(group.map(i => nodes[i]))));
  observed ??= new Set(sourceComponents.map(group => group[0]));
  const basis = Object.freeze(nodes.filter(name => observed.has(name)));
  const missingComponents = Object.freeze(sourceComponents.filter(group => !group.some(name => observed.has(name))));

  // A multi-source BFS forest never recomputes or overwrites a retained value.
  const queue = basis.map(name => indices.get(name)), reached = new Uint8Array(nodes.length), steps = [];
  for (const i of queue) reached[i] = 1;
  for (let head = 0; head < queue.length; head++) {
    for (const edgeIndex of forward[queue[head]]) {
      const edge = edges[edgeIndex], to = indices.get(edge.to);
      if (reached[to]) continue;
      reached[to] = 1; queue.push(to); steps.push(edge);
    }
  }
  return Object.freeze({
    nodes: Object.freeze(nodes), edges: Object.freeze(edges), sourceComponents, basis,
    missingComponents, complete: missingComponents.length === 0,
    minimumDistance: sources.length ? Math.min(...sources.map(group => group.length)) : null,
    steps: Object.freeze(steps),
  });
}

// Bounded logarithmic recursion; balancing also bounds generated parser nesting.
function conjunction(expressions, start = 0, end = expressions.length) {
  if (start === end) return 'true';
  if (end - start === 1) return expressions[start];
  const middle = start + Math.floor((end - start) / 2);
  return `(${conjunction(expressions, start, middle)} && ${conjunction(expressions, middle, end)})`;
}

/** Generate an ordinary staged Asslang protocol with restore and check methods.
 * Pass the returned named source directly to compileSources. restore assumes
 * coherent observations; check explicitly tests every original edge using the
 * caller's curried equality predicates. No runtime graph or new intrinsic.
 * @param {string} name Definition name (the generated filename adds .generated.ass).
 * @param {Parameters<typeof planReconstruction>[0]} graph
 * @param {Parameters<typeof planReconstruction>[1]} options
 */
export function reconstructionSource(name, graph, options = {}) {
  identifier(name, 'Reconstruction definition');
  const plan = planReconstruction(graph, options);
  if (!plan.complete) {
    const missing = plan.missingComponents.map(group => `[${group.join(', ')}]`).join('; ');
    throw new TypeError(`Reconstruction observations miss source components: ${missing}`);
  }
  const local = new Map(plan.nodes.map((node, i) => [node, `v${i}`]));
  const bindings = plan.basis.map(node => `    let ${local.get(node)} = seed.${node};`);
  for (const { from, to, map } of plan.steps)
    bindings.push(`    let ${local.get(to)} = maps.${map} ${local.get(from)};`);
  const fields = plan.nodes.map(node => `${node}: ${local.get(node)}`).join(', ');
  // Hoist dictionary projections instead of growing one row-tail chain per edge.
  // Reading every coordinate also checks the full record shape, even for isolates.
  const mapNames = [...new Set(plan.edges.map(edge => edge.map))];
  const mapLocal = new Map(mapNames.map((map, i) => [map, `m${i}`]));
  const targets = new Set(plan.edges.map(edge => edge.to));
  const comparisons = new Map(plan.nodes.filter(node => targets.has(node)).map((node, i) => [node, `eq${i}`]));
  const checkBindings = [
    ...plan.nodes.map(node => `    let ${local.get(node)} = value.${node};`),
    ...mapNames.map(map => `    let ${mapLocal.get(map)} = maps.${map};`),
    ...[...comparisons].map(([node, variable]) => `    let ${variable} = same.${node};`),
  ];
  const checks = plan.edges.map(({ from, to, map }) =>
    `(${comparisons.get(to)} (${mapLocal.get(map)} ${local.get(from)}) ${local.get(to)})`);
  const source = [
    '// Generated observation protocol; restore assumes coherence. check is explicit.',
    `fn ${name} = maps -> {`,
    '  restore: seed -> do {',
    ...bindings,
    `    {${fields}}`,
    '  },',
    '  check: same -> value -> do {',
    ...checkBindings,
    // The final conjunction also constrains a single comparator to return Bool.
    `    ${conjunction(checks)} && true`,
    '  }',
    '};', '',
  ].join('\n');
  return Object.freeze({ name: `${name}.generated.ass`, source, plan });
}
