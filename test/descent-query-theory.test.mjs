import test from 'node:test';
import assert from 'node:assert/strict';
import { planDescentQuery, verifyDescentQuery, verifyDescentQueryCost, compileSources, descentQuerySource } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';

function* tuples(values, length, prefix = []) {
  if (length === 0) { yield prefix; return; }
  for (const v of values) yield* tuples(values, length - 1, [...prefix, v]);
}
function closure(n, edges) {
  const r = Array.from({ length: n }, (_, v) => 1 << v);
  for (const [a, b] of edges) r[a] |= 1 << b;
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) if (r[i] & (1 << k)) r[i] |= r[k];
  return r;
}
function* covers(maxN) {
  for (let n = 0; n <= maxN; n++) {
    const nodes = Array.from({ length: n }, (_, i) => `n${i}`);
    const possible = nodes.flatMap((_, a) => nodes.flatMap((_, b) => a !== b ? [[a, b]] : []));
    for (let m = 0; m < 2 ** possible.length; m++) {
      const es = possible.filter((_, i) => m & (1 << i)), reach = closure(n, es);
      const opens = Array.from({ length: 1 << n }, (_, d) => d).filter(d => es.every(([a, b]) => !(d & (1 << a)) || d & (1 << b)));
      for (let p = 0; p <= 3; p++) for (const ds of tuples(opens, p)) {
        if (ds.reduce((a, b) => a | b, 0) !== (1 << n) - 1) continue;
        const patches = ds.map((d, i) => ({ name: `p${i}`, nodes: nodes.filter((_, v) => d & (1 << v)) }));
        const members = nodes.map((_, v) => ds.flatMap((d, i) => d & (1 << v) ? [i] : []));
        const all = nodes.flatMap((node, v) => members[v].flatMap(a => members[v].filter(b => b > a).map(b => ({ node, left: `p${a}`, right: `p${b}`, v, a, b }))));
        yield { graph: { nodes, edges: es.map(([a, b], i) => ({ from: nodes[a], to: nodes[b], map: `m${i}` })) }, patches, members, reach, all };
      }
    }
  }
}
// Independent adjacency/Floyd oracle. No planner paths or SCC partitions.
function implies(instance, evidence, q) {
  const n = instance.patches.length, row = Array.from({ length: n }, (_, i) => 1 << i);
  for (const e of evidence) if (instance.reach[e.v] & (1 << q.v)) { row[e.a] |= 1 << e.b; row[e.b] |= 1 << e.a; }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) if (row[i] & (1 << k)) row[i] |= row[k];
  return !!(row[q.a] & (1 << q.b));
}
function checkModel(plan, evidence) {
  const model = plan.obstruction;
  const values = new Map(model.sections.map(p => [p.patch, new Map(p.values.map(x => [x.node, x.value]))]));
  for (const e of evidence) assert.equal(values.get(e.left).get(e.node), values.get(e.right).get(e.node));
  for (const arrow of model.arrows) for (const p of plan.patches) if (p.nodes.includes(arrow.from))
    assert.equal(arrow.table[values.get(p.name).get(arrow.from)], values.get(p.name).get(arrow.to));
  const { node, left, right } = plan.query;
  assert.equal(model.witness.node, node); assert.equal(model.witness.left, left); assert.equal(model.witness.right, right);
  assert.notEqual(values.get(left).get(node), values.get(right).get(node));
}

test('all small retained/allowed/unavailable presentations and goals match subset optima', t => {
  let configurations = 0, presentations = 0, queries = 0, countermodels = 0;
  for (const instance of covers(2)) {
    configurations++;
    const { graph, patches, all } = instance;
    for (const state of tuples([0, 1, 2], all.length)) {
      const retained = all.filter((_, i) => state[i] === 1);
      const candidates = all.flatMap((e, i) => state[i] === 2 ? [{ ...e, cost: (i * 7 + e.a + 2 * e.b) % 5 }] : []);
      presentations++;
      for (const q of all) {
        let cost = Infinity, count = Infinity;
        for (let subset = 0; subset < 2 ** candidates.length; subset++) {
          const chosen = candidates.filter((_, i) => subset & (1 << i));
          if (!implies(instance, [...retained, ...chosen], q)) continue;
          const c = chosen.reduce((s, e) => s + e.cost, 0);
          if (c < cost || (c === cost && chosen.length < count)) { cost = c; count = chosen.length; }
        }
        const opts = { query: q, retained, candidates };
        const p = planDescentQuery(graph, patches, opts);
        assert.equal(p.complete, cost < Infinity);
        assert.equal(p.minimumCost, cost < Infinity ? cost : null);
        assert.equal(p.additionalCount, cost < Infinity ? count : null);
        if (p.complete) {
          assert(verifyDescentQuery(graph, patches, opts, p.proof));
          assert(verifyDescentQueryCost(graph, patches, opts, p.proof, p.potentials));
          assert(implies(instance, [...p.usedRetained.map(i => retained[i]), ...p.selected.map(i => candidates[i])], q));
        } else { checkModel(p, [...retained, ...candidates]); countermodels++; }
        queries++;
      }
    }
  }
  t.diagnostic(JSON.stringify({ configurations, presentations, queries, countermodels }));
});

test('all zero-to-three-coordinate covers obey the evidence metric and nonexpansive transport', t => {
  let configurations = 0, queries = 0, triangleChecks = 0, arrowChecks = 0;
  for (const instance of covers(3)) {
    const { graph, patches, all, members } = instance;
    // Include zero weights and deliberately unavailable edges.
    const candidates = all.flatMap((e, i) => i % 3 === 2 ? [] : [{ ...e, cost: (i * 3 + e.a + e.b) % 5 }]);
    const metrics = graph.nodes.map(() => patches.map(() => patches.map(() => Infinity)));
    for (let v = 0; v < graph.nodes.length; v++) for (const a of members[v]) for (const b of members[v]) {
      const q = { node: graph.nodes[v], left: patches[a].name, right: patches[b].name };
      const p = planDescentQuery(graph, patches, { query: q, candidates });
      metrics[v][a][b] = p.minimumCost ?? Infinity;
      assert.equal(p.complete, implies(instance, candidates, { v, a, b })); queries++;
    }
    for (let v = 0; v < graph.nodes.length; v++) for (const a of members[v]) {
      assert.equal(metrics[v][a][a], 0);
      for (const b of members[v]) {
        assert.equal(metrics[v][a][b], metrics[v][b][a]);
        for (const c of members[v]) { assert(metrics[v][a][c] <= metrics[v][a][b] + metrics[v][b][c]); triangleChecks++; }
      }
    }
    for (const e of graph.edges) {
      const v = graph.nodes.indexOf(e.from), w = graph.nodes.indexOf(e.to);
      for (const a of members[v]) for (const b of members[v]) { assert(metrics[w][a][b] <= metrics[v][a][b]); arrowChecks++; }
    }
    configurations++;
  }
  assert.equal(configurations, 3251);
  t.diagnostic(JSON.stringify({ configurations, queries, triangleChecks, arrowChecks }));
});

test('actual generated guards imply the goal over all Boolean assignments without global coherence', async t => {
  const graph = { nodes: ['x', 'z'], edges: [{ from: 'x', to: 'z', map: 'f' }] };
  const patches = [{ name: 'a', nodes: graph.nodes }, { name: 'b', nodes: graph.nodes }, { name: 'c', nodes: ['z'] }, { name: 'd', nodes: graph.nodes }];
  const options = { query: { node: 'z', left: 'a', right: 'c' }, candidates: [
    { node: 'x', left: 'a', right: 'b' }, { node: 'z', left: 'b', right: 'c' },
  ] };
  const gen = descentQuerySource('goal', graph, patches, options);
  let assignments = 0, accepted = 0, acceptedIncoherentOutsideSupport = 0;
  for (const [fn, mapping] of [['x -> 0', [0, 0]], ['x -> x', [0, 1]], ['x -> 1-x', [1, 0]], ['x -> 1', [1, 1]]]) {
    const source = `fn eq = x -> y -> x==y;
      export fn main = (p:{a:{x:Num,z:Num},b:{x:Num,z:Num},c:{z:Num},d:{x:Num,z:Num}}) ->
        (goal {f:${fn}}).check {x:eq,z:eq} p;`;
    const r = await createRuntime(compileSources([gen, { name: 'app.ass', source }]));
    for (const vs of tuples([0, 1], 7)) {
      const p = { a: { x: vs[0], z: vs[1] }, b: { x: vs[2], z: vs[3] }, c: { z: vs[4] }, d: { x: vs[5], z: vs[6] } };
      const valid = r.call('main', [p]);
      const expected = p.a.x === p.b.x && p.b.z === p.c.z && mapping[p.a.x] === p.a.z && mapping[p.b.x] === p.b.z;
      assert.equal(valid, expected);
      if (valid) { assert.equal(p.a.z, p.c.z); accepted++; if (mapping[p.d.x] !== p.d.z) acceptedIncoherentOutsideSupport++; }
      assignments++;
    }
  }
  assert(acceptedIncoherentOutsideSupport > 0);
  t.diagnostic(JSON.stringify({ assignments, accepted, acceptedIncoherentOutsideSupport }));
});
