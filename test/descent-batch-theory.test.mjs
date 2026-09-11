import test from 'node:test';
import assert from 'node:assert/strict';
import { planDescentBatch, verifyDescentBatch, descentBatchSource, compileSources } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';

function* tuples(values, n, prefix = []) {
  if (!n) { yield prefix; return; }
  for (const v of values) yield* tuples(values, n - 1, [...prefix, v]);
}
const bits = mask => { let n = 0; for (; mask; mask &= mask - 1) n++; return n; };
const maskOf = ids => ids.reduce((mask, i) => mask | (1 << i), 0);
function minSets(masks) {
  return [...new Set(masks)].filter(m => !masks.some(n => n !== m && (m & n) === n)).sort((a, b) => a - b);
}
const plus = (a, b) => minSets([...a, ...b]);
const times = (a, b) => minSets(a.flatMap(x => b.map(y => x | y)));
function* covers() {
  for (let n = 0; n <= 2; n++) {
    const nodes = Array.from({ length: n }, (_, i) => `n${i}`);
    const possible = nodes.flatMap((_, a) => nodes.flatMap((_, b) => a !== b ? [[a, b]] : []));
    for (let e = 0; e < 1 << possible.length; e++) {
      const edges = possible.filter((_, i) => e & (1 << i));
      const reach = nodes.map((_, i) => 1 << i);
      for (const [a, b] of edges) reach[a] |= 1 << b;
      for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) if (reach[i] & (1 << k)) reach[i] |= reach[k];
      const opens = Array.from({ length: 1 << n }, (_, i) => i)
        .filter(d => edges.every(([a, b]) => !(d & (1 << a)) || d & (1 << b)));
      for (let p = 0; p <= 3; p++) for (const domains of tuples(opens, p)) {
        if (domains.reduce((a, b) => a | b, 0) !== (1 << n) - 1) continue;
        const patches = domains.map((d, i) => ({ name: `p${i}`, nodes: nodes.filter((_, v) => d & (1 << v)) }));
        const all = nodes.flatMap((node, v) => patches.flatMap((a, i) => patches.slice(i + 1)
          .filter(b => a.nodes.includes(node) && b.nodes.includes(node))
          .map(b => ({ node, left: a.name, right: b.name, v, a: i, b: Number(b.name.slice(1)) }))));
        yield { graph: { nodes, edges: edges.map(([a, b], i) => ({ from: nodes[a], to: nodes[b], map: `m${i}` })) }, patches, reach, all };
      }
    }
  }
}
// Independent set-based fixed-point equality oracle on each target coordinate.
// It uses neither production DSU state enumeration nor its certificate coverage.
function implies(instance, evidence, query) {
  const seen = new Set([query.a]);
  for (let changed = true; changed;) {
    changed = false;
    for (const e of evidence) if (instance.reach[e.v] & (1 << query.v)) {
      if (seen.has(e.a) && !seen.has(e.b)) { seen.add(e.b); changed = true; }
      if (seen.has(e.b) && !seen.has(e.a)) { seen.add(e.a); changed = true; }
    }
  }
  return seen.has(query.b);
}
function oracle(instance, retained, candidates, queries) {
  const truth = Array.from({ length: 1 << candidates.length }, (_, mask) =>
    queries.every(q => implies(instance, [...retained, ...candidates.filter((_, i) => mask & (1 << i))], q)));
  const minimal = minSets(truth.flatMap((ok, mask) => ok ? [mask] : []));
  const maximalFalse = truth.flatMap((ok, mask) => !ok && candidates.every((_, i) => (mask & (1 << i)) || truth[mask | (1 << i)]) ? [mask] : []);
  const costs = mask => candidates.reduce((c, e, i) => c + ((mask & (1 << i)) ? e.cost : 0), 0);
  const ranked = [...minimal].sort((a, b) => costs(a) - costs(b) || bits(a) - bits(b) || a - b);
  return { minimal, maximalFalse, selected: ranked[0] ?? -1, cost: ranked.length ? costs(ranked[0]) : null };
}
function verifyCountermodel(plan) {
  const m = plan.obstruction;
  const sections = new Map(m.sections.map(p => [p.patch, new Map(p.values.map(v => [v.node, v.value]))]));
  for (const e of [...plan.retained, ...plan.candidates]) assert.equal(sections.get(e.left).get(e.node), sections.get(e.right).get(e.node));
  for (const a of m.arrows) for (const p of plan.patches) if (p.nodes.includes(a.from))
    assert.equal(a.table[sections.get(p.name).get(a.from)], sections.get(p.name).get(a.to));
  assert(plan.queries.some(q => q.node === m.witness.node && q.left === m.witness.left && q.right === m.witness.right));
  assert.notEqual(sections.get(m.witness.left).get(m.witness.node), sections.get(m.witness.right).get(m.witness.node));
}

test('bounded exhaustive batches match all minimal supports, maximal failures, shared costs and countermodels', t => {
  let configurations = 0, presentations = 0, batches = 0, countermodels = 0, certifiedSupports = 0;
  for (const instance of covers()) {
    configurations++;
    const { graph, patches, all } = instance;
    for (const states of tuples([0, 1, 2], all.length)) {
      const retained = all.filter((_, i) => states[i] === 1);
      const candidates = all.flatMap((e, i) => states[i] === 2 ? [{ ...e, cost: (i * 7 + e.a + e.b) % 5 }] : []);
      const families = [all, all.length > 1 ? [all[0], all.at(-1)] : []];
      for (const goals of families) {
        const queries = goals.map((q, i) => ({ ...q, name: `g${i}` }));
        const options = { queries, retained, candidates };
        const expected = oracle(instance, retained, candidates, queries);
        const plan = planDescentBatch(graph, patches, options);
        assert.deepEqual(plan.frontier.minimal.map(maskOf), expected.minimal);
        assert.deepEqual(plan.frontier.maximalFailures.map(f => maskOf(f.allowed)), expected.maximalFalse);
        assert.equal(plan.complete, expected.selected >= 0);
        assert.equal(plan.minimumCost, expected.cost);
        assert.equal(plan.additionalCount, expected.selected >= 0 ? bits(expected.selected) : null);
        if (plan.complete) assert.equal(maskOf(plan.selected), expected.selected);
        else { verifyCountermodel(plan); countermodels++; }
        assert(verifyDescentBatch(graph, patches, options, plan));
        certifiedSupports += expected.minimal.length; batches++;
      }
      presentations++;
    }
  }
  assert.equal(configurations, 135); assert.equal(presentations, 4605);
  t.diagnostic(JSON.stringify({ configurations, presentations, batches, countermodels, certifiedSupports }));
});

test('antichain composition gives the exact multi-goal frontier on every small cover', t => {
  let batches = 0;
  for (const instance of covers()) {
    const candidates = instance.all.map((e, i) => ({ ...e, cost: i % 3 }));
    const single = instance.all.map(q => oracle(instance, [], candidates, [q]).minimal);
    for (let mask = 0; mask < 1 << single.length; mask++) {
      let composed = [0];
      const queries = [];
      for (let i = 0; i < single.length; i++) if (mask & (1 << i)) {
        composed = times(composed, single[i]); queries.push({ ...instance.all[i], name: `g${i}` });
      }
      const actual = planDescentBatch(instance.graph, instance.patches, { queries, candidates });
      assert.deepEqual(actual.frontier.minimal.map(maskOf), composed); batches++;
    }
  }
  t.diagnostic(JSON.stringify({ batches }));
});

test('all antichains on three generators satisfy the sharing quantale laws', t => {
  const antichains = [];
  for (let mask = 0; mask < 256; mask++) {
    const family = Array.from({ length: 8 }, (_, i) => i).filter(i => mask & (1 << i));
    if (minSets(family).length === family.length) antichains.push(family);
  }
  assert.equal(antichains.length, 20);
  let triples = 0;
  for (const a of antichains) {
    assert.deepEqual(plus(a, []), a); assert.deepEqual(times(a, [0]), a);
    assert.deepEqual(times(a, a), a); assert.deepEqual(plus(a, a), a);
    for (const b of antichains) {
      assert.deepEqual(plus(a, times(a, b)), a);
      assert.deepEqual(times(a, plus(a, b)), a);
      for (const c of antichains) {
        assert.deepEqual(times(a, times(b, c)), times(times(a, b), c));
        assert.deepEqual(times(a, plus(b, c)), plus(times(a, b), times(a, c))); triples++;
      }
    }
  }
  // Positive prices cannot preserve idempotent sharing under additive composition.
  const evaluate = a => a.length ? Math.min(...a.map(mask => [4, 1, 3].reduce((s, c, i) => s + ((mask & (1 << i)) ? c : 0), 0))) : Infinity;
  assert.equal(evaluate(times([1], [1])), 4); assert.equal(evaluate([1]) + evaluate([1]), 8);
  for (const a of antichains) for (const b of antichains) {
    assert(evaluate(times(a, b)) >= Math.max(evaluate(a), evaluate(b)));
    assert(evaluate(times(a, b)) <= evaluate(a) + evaluate(b));
  }
  t.diagnostic(JSON.stringify({ antichains: antichains.length, triples }));
});

test('compiled shared guards imply both goals without assuming coherence outside their support', async t => {
  const graph = { nodes: ['x', 'z'], edges: [{ from: 'x', to: 'z', map: 'f' }] };
  const patches = [{ name: 'a', nodes: graph.nodes }, { name: 'b', nodes: graph.nodes },
    { name: 'c', nodes: ['z'] }, { name: 'unused', nodes: graph.nodes }];
  const options = { queries: [{ name: 'input', node: 'x', left: 'a', right: 'b' }, { name: 'output', node: 'z', left: 'a', right: 'c' }],
    candidates: [{ node: 'x', left: 'a', right: 'b', cost: 4 }, { node: 'z', left: 'b', right: 'c', cost: 1 }, { node: 'z', left: 'a', right: 'c', cost: 3 }] };
  const gen = descentBatchSource('batch', graph, patches, options);
  let assignments = 0, accepted = 0, incoherentOutsideSupport = 0;
  for (const [fn, map] of [['x -> 0', [0, 0]], ['x -> x', [0, 1]], ['x -> 1-x', [1, 0]], ['x -> 1', [1, 1]]]) {
    const source = `fn eq = x -> y -> x==y; export fn main = (p:{a:{x:Num,z:Num},b:{x:Num,z:Num},c:{z:Num},unused:{x:Num,z:Num}}) -> (batch {f:${fn}}).check {x:eq,z:eq} p;`;
    const r = await createRuntime(compileSources([gen, { name: 'app.ass', source }]));
    for (const v of tuples([0, 1], 7)) {
      const p = { a: { x: v[0], z: v[1] }, b: { x: v[2], z: v[3] }, c: { z: v[4] }, unused: { x: v[5], z: v[6] } };
      const ok = r.call('main', [p]);
      const expected = p.a.x === p.b.x && p.b.z === p.c.z && map[p.a.x] === p.a.z && map[p.b.x] === p.b.z;
      assert.equal(ok, expected);
      if (ok) {
        assert.equal(p.a.x, p.b.x); assert.equal(p.a.z, p.c.z); accepted++;
        if (map[p.unused.x] !== p.unused.z) incoherentOutsideSupport++;
      }
      assignments++;
    }
  }
  t.diagnostic(JSON.stringify({ assignments, accepted, incoherentOutsideSupport }));
});
