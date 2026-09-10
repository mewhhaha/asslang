import test from 'node:test';
import assert from 'node:assert/strict';
import { planDescentExtension, descentCountermodel, verifyDescent } from '../src/compiler.mjs';

function* tuples(choices, length, prefix = []) {
  if (!length) { yield prefix; return; }
  for (const x of choices) yield* tuples(choices, length - 1, [...prefix, x]);
}
function count(mask) { let n = 0; for (; mask; mask &= mask - 1) n++; return n; }
function* instances(maxNodes) {
  for (let n = 0; n <= maxNodes; n++) {
    const nodes = Array.from({ length: n }, (_, v) => `n${v}`);
    const possible = nodes.flatMap((_, a) => nodes.flatMap((_, b) => a === b ? [] : [[a, b]]));
    for (let mask = 0; mask < 2 ** possible.length; mask++) {
      const edges = possible.filter((_, i) => mask & (1 << i));
      // Floyd reachability is independent of the production traversals.
      const reach = nodes.map((_, v) => 1 << v);
      for (const [a, b] of edges) reach[a] |= 1 << b;
      for (let k = 0; k < n; k++) for (let v = 0; v < n; v++) if (reach[v] & (1 << k)) reach[v] |= reach[k];
      const opens = Array.from({ length: 1 << n }, (_, i) => i)
        .filter(m => edges.every(([a, b]) => !(m & (1 << a)) || (m & (1 << b))));
      const graph = { nodes, edges: edges.map(([a, b], i) => ({ from: nodes[a], to: nodes[b], map: `m${i}` })) };
      for (let p = 0; p <= 3; p++) for (const domains of tuples(opens, p)) {
        if (domains.reduce((a, b) => a | b, 0) !== (1 << n) - 1) continue;
        const patches = domains.map((m, i) => ({ name: `p${i}`, nodes: nodes.filter((_, v) => m & (1 << v)) }));
        const members = nodes.map((_, v) => domains.flatMap((m, i) => m & (1 << v) ? [i] : []));
        const candidates = nodes.flatMap((node, v) => members[v].flatMap(a => members[v].filter(b => b > a)
          .map(b => ({ node, left: `p${a}`, right: `p${b}`, v, a, b }))));
        function complete(mask) {
          const eq = nodes.map(() => Array.from({ length: p }, (_, i) => 1 << i));
          candidates.forEach(({ v, a, b }, i) => {
            if (!(mask & (1 << i))) return;
            for (let w = 0; w < n; w++) if (reach[v] & (1 << w)) { eq[w][a] |= 1 << b; eq[w][b] |= 1 << a; }
          });
          for (const row of eq) for (let k = 0; k < p; k++) for (let i = 0; i < p; i++)
            if (row[i] & (1 << k)) row[i] |= row[k];
          return members.every((ids, v) => ids.every(i => eq[v][i] === eq[v][ids[0]]));
        }
        yield { graph, patches, candidates, complete };
      }
    }
  }
}
function verifyModel(model, graph, patches, tests) {
  const domains = new Map(model.nodes.map(n => [n.node, n.classes]));
  const values = new Map(model.sections.map(p => [p.patch, new Map(p.values.map(v => [v.node, v.value]))]));
  assert.equal(model.nodes.length, graph.nodes.length);
  assert.equal(model.arrows.length, graph.edges.length);
  assert.equal(model.sections.length, patches.length);
  for (const patch of patches) {
    assert.deepEqual([...values.get(patch.name).keys()], graph.nodes.filter(v => patch.nodes.includes(v)));
    for (const node of patch.nodes) assert(domains.get(node)[values.get(patch.name).get(node)].includes(patch.name));
  }
  model.arrows.forEach((arrow, i) => {
    assert.deepEqual({ from: arrow.from, to: arrow.to, map: arrow.map }, graph.edges[i]);
    assert.equal(arrow.edge, i); assert.equal(arrow.table.length, domains.get(arrow.from).length);
    for (const result of arrow.table) assert(Number.isInteger(result) && result >= 0 && result < domains.get(arrow.to).length);
    for (const patch of patches) if (patch.nodes.includes(arrow.from))
      assert.equal(arrow.table[values.get(patch.name).get(arrow.from)], values.get(patch.name).get(arrow.to));
  });
  for (const t of tests) assert.equal(values.get(t.left).get(t.node), values.get(t.right).get(t.node));
  const w = model.witness;
  assert.equal(values.get(w.left).get(w.node), w.leftValue);
  assert.equal(values.get(w.right).get(w.node), w.rightValue);
  assert.notEqual(w.leftValue, w.rightValue);
}

test('all small descent bases satisfy exchange; optimizer rank matches maximum basis intersection', t => {
  let covers = 0, subsets = 0, exchanges = 0, countermodels = 0;
  for (const { graph, patches, candidates, complete } of instances(3)) {
    const outcomes = Array.from({ length: 1 << candidates.length }, (_, m) => complete(m));
    const bases = outcomes.flatMap((ok, m) => ok && candidates.every((_, i) => !(m & (1 << i)) || !outcomes[m ^ (1 << i)]) ? [m] : []);
    assert(bases.length > 0);
    const rank = count(bases[0]);
    for (const b of bases) {
      assert.equal(count(b), rank);
      for (const d of bases) for (let i = 0; i < candidates.length; i++) if ((b & ~d) & (1 << i)) {
        assert(candidates.some((_, j) => ((d & ~b) & (1 << j)) && bases.includes((b ^ (1 << i)) | (1 << j)))); exchanges++;
      }
    }
    for (let mask = 0; mask < outcomes.length; mask++) {
      const retained = candidates.filter((_, i) => mask & (1 << i));
      const plan = planDescentExtension(graph, patches, { retained, candidates: [] });
      assert.equal(plan.rank, rank);
      assert.equal(plan.retainedRank, Math.max(...bases.map(b => count(mask & b))));
      assert.equal(plan.complete, outcomes[mask]);
      if (plan.obstruction) { verifyModel(plan.obstruction, graph, patches, retained); countermodels++; }
      subsets++;
    }
    covers++;
  }
  assert.equal(covers, 3251); assert.equal(subsets, 82172); assert.equal(countermodels, 42274);
  t.diagnostic(JSON.stringify({ covers, subsets, exchanges, countermodels }));
});

test('all retained/available/unavailable assignments on zero-to-two-node covers attain brute-force optima', t => {
  let covers = 0, restrictions = 0, feasible = 0, impossible = 0;
  for (const { graph, patches, candidates, complete } of instances(2)) {
    const costs = candidates.map((c, i) => (i * 7 + c.a * 3 + c.b) % 5);
    for (const states of tuples([0, 1, 2], candidates.length)) {
      let retainedMask = 0;
      const available = [], retained = [];
      states.forEach((s, i) => { if (s === 1) { retainedMask |= 1 << i; retained.push(candidates[i]); } else if (s === 2) available.push(i); });
      let bestCost = Infinity, bestCount = Infinity;
      for (let m = 0; m < 1 << available.length; m++) {
        let all = retainedMask, cost = 0, size = 0;
        available.forEach((i, j) => { if (m & (1 << j)) { all |= 1 << i; cost += costs[i]; size++; } });
        if (complete(all)) { bestCost = Math.min(bestCost, cost); bestCount = Math.min(bestCount, size); }
      }
      const allowed = available.map(i => ({ ...candidates[i], cost: costs[i] }));
      const plan = planDescentExtension(graph, patches, { retained, candidates: allowed });
      assert.equal(plan.complete, bestCost < Infinity);
      if (plan.complete) {
        assert.equal(plan.minimumCost, bestCost); assert.equal(plan.minimumAdditional, bestCount);
        assert.equal(plan.minimumAdditional, plan.rank - plan.retainedRank);
        assert(verifyDescent(graph, patches, plan.comparisons)); feasible++;
      } else {
        assert.equal(plan.minimumCost, null); assert.equal(plan.minimumAdditional, null);
        verifyModel(plan.obstruction, graph, patches, [...retained, ...allowed]); impossible++;
      }
      restrictions++;
    }
    covers++;
  }
  t.diagnostic(JSON.stringify({ covers, restrictions, feasible, impossible }));
});

test('selected three-coordinate covers with cycles and transitivity satisfy constrained pair-cost optima', t => {
  let configurations = 0;
  const cases = [
    { edges: [['x', 'z'], ['y', 'z']], domains: [['x', 'z'], ['x', 'y', 'z'], ['y', 'z']] },
    { edges: [['x', 'y'], ['y', 'x'], ['y', 'z']], domains: [['x', 'y', 'z'], ['x', 'y', 'z'], ['z']] },
    { edges: [['x', 'y'], ['y', 'z']], domains: [['x', 'y', 'z'], ['y', 'z'], ['z']] },
  ];
  for (const { edges, domains } of cases) {
    const graph = { nodes: ['x', 'y', 'z'], edges: edges.map(([from, to], i) => ({ from, to, map: `m${i}` })) };
    const patches = domains.map((nodes, i) => ({ name: `p${i}`, nodes }));
    const all = graph.nodes.flatMap(node => patches.flatMap((a, i) => patches.slice(i + 1).filter(b => a.nodes.includes(node) && b.nodes.includes(node))
      .map(b => ({ node, left: a.name, right: b.name }))));
    for (const states of tuples([0, 1, 2], all.length)) {
      const retained = all.filter((_, i) => states[i] === 1);
      const candidates = all.flatMap((c, i) => states[i] === 2 ? [{ ...c, cost: (i * 7) % 4 }] : []);
      let best = Infinity, fewest = Infinity;
      for (let m = 0; m < 1 << candidates.length; m++) {
        const chosen = candidates.filter((_, i) => m & (1 << i));
        // Semantic oracle: actual equality propagation, never optimizer ranks.
        if (verifyDescent(graph, patches, [...retained, ...chosen])) {
          best = Math.min(best, chosen.reduce((s, c) => s + c.cost, 0)); fewest = Math.min(fewest, chosen.length);
        }
      }
      const p = planDescentExtension(graph, patches, { retained, candidates });
      assert.equal(p.complete, best < Infinity);
      assert.equal(p.minimumCost, best < Infinity ? best : null);
      assert.equal(p.minimumAdditional, best < Infinity ? fewest : null);
      if (!p.complete) verifyModel(p.obstruction, graph, patches, [...retained, ...candidates]);
      configurations++;
    }
  }
  t.diagnostic(JSON.stringify({ configurations }));
});

test('matroid loops are not automatically true; standalone countermodels expose that distinction', () => {
  const graph = { nodes: ['x', 'z'], edges: [{ from: 'x', to: 'z', map: 'id' }] };
  const patches = ['a', 'b'].map(name => ({ name, nodes: graph.nodes }));
  const downstream = { node: 'z', left: 'a', right: 'b' }, upstream = { ...downstream, node: 'x' };
  const p = planDescentExtension(graph, patches, { retained: [downstream], candidates: [upstream] });
  assert.equal(p.retainedRank, 0); assert.equal(p.minimumAdditional, 1);
  const model = descentCountermodel(graph, patches, []);
  verifyModel(model, graph, patches, []);
  const values = model.sections.map(s => s.values.find(v => v.node === 'z').value);
  assert.notEqual(values[0], values[1]);
  assert.equal(descentCountermodel(graph, patches, [upstream]), null);
});
