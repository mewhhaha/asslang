import test from 'node:test';
import assert from 'node:assert/strict';
import { planDescent, verifyDescent } from '../src/compiler.mjs';

// Independent oracle: Floyd closure of vertices and Boolean adjacency matrices
// of patch equalities. No optimizer SCCs or disjoint-set implementation is used.
function closure(n, edges) {
  const r = Array.from({ length: n }, (_, v) => 1 << v);
  for (const [a, b] of edges) r[a] |= 1 << b;
  for (let k = 0; k < n; k++) for (let v = 0; v < n; v++)
    if (r[v] & (1 << k)) r[v] |= r[k];
  return r;
}
function* tuples(choices, length, prefix = []) {
  if (!length) { yield prefix; return; }
  for (const x of choices) yield* tuples(choices, length - 1, [...prefix, x]);
}
function equalityOracle(n, p, membership, reach, candidates, mask) {
  const eq = Array.from({ length: n }, () => Array.from({ length: p }, (_, i) => 1 << i));
  for (let t = 0; t < candidates.length; t++) if (mask & (1 << t)) {
    const { v, a, b } = candidates[t];
    for (let w = 0; w < n; w++) if (reach[v] & (1 << w)) {
      eq[w][a] |= 1 << b; eq[w][b] |= 1 << a;
    }
  }
  for (const row of eq) for (let k = 0; k < p; k++) for (let i = 0; i < p; i++)
    if (row[i] & (1 << k)) row[i] |= row[k];
  const complete = membership.every((ids, v) => ids.every(i => eq[v][i] === eq[v][ids[0]]));
  return { complete, eq };
}
function checkCountermodel(edges, membership, candidates, mask, eq) {
  // Classes are labelled by their bitsets. Mapping a class uses any member;
  // all representatives must have the same target class. Patch i chooses [i].
  for (const [v, w] of edges) for (const i of membership[v])
    for (const j of membership[v]) if (eq[v][i] === eq[v][j]) assert.equal(eq[w][i], eq[w][j]);
  for (let t = 0; t < candidates.length; t++) if (mask & (1 << t)) {
    const { v, a, b } = candidates[t]; assert.equal(eq[v][a], eq[v][b]);
  }
  assert(membership.some((ids, v) => ids.some(i => eq[v][i] !== eq[v][ids[0]])));
}

test('exhaustive small covers: minimum counts/costs, independent verifier, and finite countermodels', t => {
  let covers = 0, certificates = 0, countermodels = 0;
  for (let n = 0; n <= 3; n++) {
    const nodes = Array.from({ length: n }, (_, v) => `n${v}`);
    const possible = nodes.flatMap((_, a) => nodes.flatMap((_, b) => a === b ? [] : [[a, b]]));
    for (let graphMask = 0; graphMask < 2 ** possible.length; graphMask++) {
      const edges = possible.filter((_, i) => graphMask & (1 << i));
      const reach = closure(n, edges), all = (1 << n) - 1;
      const opens = Array.from({ length: 1 << n }, (_, mask) => mask)
        .filter(mask => edges.every(([v, w]) => !(mask & (1 << v)) || (mask & (1 << w))));
      const graph = { nodes, edges: edges.map(([a, b], e) => ({ from: nodes[a], to: nodes[b], map: `m${e}` })) };
      for (let p = 0; p <= 3; p++) for (const domains of tuples(opens, p)) {
        if (domains.reduce((union, mask) => union | mask, 0) !== all) continue;
        const patches = domains.map((mask, i) => ({ name: `p${i}`, nodes: nodes.filter((_, v) => mask & (1 << v)) }));
        const membership = nodes.map((_, v) => domains.flatMap((mask, i) => mask & (1 << v) ? [i] : []));
        const candidates = nodes.flatMap((node, v) => membership[v].flatMap(a =>
          membership[v].filter(b => b > a).map(b => ({ node, left: `p${a}`, right: `p${b}`, v, a, b }))));
        let minCount = Infinity, minCost = Infinity;
        for (let mask = 0; mask < 2 ** candidates.length; mask++) {
          const selected = candidates.filter((_, i) => mask & (1 << i));
          const { complete, eq } = equalityOracle(n, p, membership, reach, candidates, mask);
          assert.equal(verifyDescent(graph, patches, selected), complete);
          if (complete) {
            minCount = Math.min(minCount, selected.length);
            minCost = Math.min(minCost, selected.reduce((sum, { v }) => sum + (v + 1) % 3, 0));
          } else { checkCountermodel(edges, membership, candidates, mask, eq); countermodels++; }
          certificates++;
        }
        const plan = planDescent(graph, patches);
        const weighted = planDescent(graph, patches, { costs: nodes.map((node, v) => ({ node, cost: (v + 1) % 3 })) });
        assert.equal(plan.minimumComparisons, minCount);
        assert.equal(weighted.minimumComparisons, minCount);
        assert.equal(weighted.minimumCost, minCost);
        assert(verifyDescent(graph, patches, plan.comparisons));
        assert(verifyDescent(graph, patches, weighted.comparisons));
        covers++;
      }
    }
  }
  assert.deepEqual({ covers, certificates, countermodels }, { covers: 3251, certificates: 82172, countermodels: 42274 });
  t.diagnostic(JSON.stringify({ covers, certificates, countermodels }));
});

test('all Boolean arrow maps and local sections agree with actual global-extension existence', t => {
  const nodes = ['x', 'y', 'z'], edgeIndices = [[0, 2], [1, 2]];
  const graph = { nodes, edges: edgeIndices.map(([a, b], e) => ({ from: nodes[a], to: nodes[b], map: `m${e}` })) };
  const domains = [[0, 2], [0, 1, 2], [1, 2]];
  const patches = domains.map((domain, i) => ({ name: `p${i}`, nodes: domain.map(v => nodes[v]) }));
  const plan = planDescent(graph, patches), comparisons = plan.comparisons.map(({ node, left, right }) => ({
    v: nodes.indexOf(node), a: Number(left.slice(1)), b: Number(right.slice(1)),
  }));
  const booleanMaps = [[0, 0], [0, 1], [1, 0], [1, 1]];
  let diagrams = 0, families = 0;
  for (const maps of tuples(booleanMaps, 2)) {
    const sections = domain => [...tuples([0, 1], domain.length)]
      .map(values => Object.fromEntries(domain.map((v, i) => [v, values[i]])))
      .filter(values => edgeIndices.every(([a, b], e) => !domain.includes(a) || maps[e][values[a]] === values[b]));
    const locals = domains.map(sections), globals = sections([0, 1, 2]);
    for (const a of locals[0]) for (const b of locals[1]) for (const c of locals[2]) {
      const family = [a, b, c];
      const accepted = comparisons.every(({ v, a, b }) => family[a][v] === family[b][v]);
      const extensions = globals.filter(g => domains.every((domain, i) => domain.every(v => family[i][v] === g[v])));
      assert.equal(extensions.length, accepted ? 1 : 0);
      families++;
    }
    diagrams++;
  }
  t.diagnostic(JSON.stringify({ diagrams, families }));
});

test('larger seeded covers preserve completeness and every chosen comparison is indispensable', () => {
  let seed = 0x13c52a7;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let trial = 0; trial < 200; trial++) {
    const n = 4 + random() % 12, p = 2 + random() % 6;
    const nodes = Array.from({ length: n }, (_, v) => `n${v}`), edges = [];
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (random() % 13 === 0) edges.push([a, b]);
    const reach = closure(n, edges), domains = Array(p).fill(0);
    for (let v = 0; v < n; v++) domains[random() % p] |= reach[v];
    for (let i = 0; i < p; i++) if (random() % 2) domains[i] |= reach[random() % n];
    const graph = { nodes, edges: edges.map(([a, b], i) => ({ from: nodes[a], to: nodes[b], map: `m${i}` })) };
    const patches = domains.map((mask, i) => ({ name: `p${i}`, nodes: nodes.filter((_, v) => mask & (1 << v)) }));
    const plan = planDescent(graph, patches, { costs: nodes.map(node => ({ node, cost: random() % 100 })) });
    assert(verifyDescent(graph, patches, plan.comparisons));
    for (let i = 0; i < plan.comparisons.length; i++)
      assert.equal(verifyDescent(graph, patches, plan.comparisons.filter((_, j) => i !== j)), false);
  }
});
