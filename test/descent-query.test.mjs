import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileSources, checkSources, createCompiler, verifyCertificate,
  planDescentQuery, verifyDescentQuery, verifyDescentQueryCost, descentQuerySource, planDescentExtension } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';

const graph = { nodes: ['raw', 'summary'], edges: [{ from: 'raw', to: 'summary', map: 'square' }] };
const patches = [{ name: 'a', nodes: graph.nodes }, { name: 'b', nodes: graph.nodes },
  { name: 'c', nodes: ['summary'] }, { name: 'unused', nodes: graph.nodes }];
const candidates = [
  { node: 'raw', left: 'a', right: 'b', cost: 1 },
  { node: 'summary', left: 'b', right: 'c', cost: 2 },
  { node: 'summary', left: 'a', right: 'c', cost: 9 },
];
const query = { node: 'summary', left: 'a', right: 'c' }, options = { query, candidates };
const gen = descentQuerySource('goal', graph, patches, options);
const shape = '{a:{raw:Num,summary:Num},b:{raw:Num,summary:Num},c:{summary:Num}}';
const good = { a: { raw: 3, summary: 9 }, b: { raw: 3, summary: 9 }, c: { summary: 9 } };
const eq = 'fn eq = x -> y -> x==y;', maps = '{square:x -> x*x}', same = '{raw:eq,summary:eq}';
const modes = [false, true].flatMap(simd => [false, true].flatMap(reductionFusion =>
  [false, true].map(memoizeReductions => ({ simd, reductionFusion, memoizeReductions }))));
const files = (g, source) => [g, { name: 'app.ass', source }];
const build = (g, source, opts) => compileSources(files(g, source), opts);

test('a goal has a cheap proof and finite dual witness while full gluing is impossible', () => {
  const p = gen.plan;
  assert.equal(p.complete, true); assert.equal(p.minimumCost, 3); assert.equal(p.additionalCount, 2);
  assert.deepEqual(p.selected, [0, 1]); assert.deepEqual(p.proof.map(s => s.transport), [[0], []]);
  assert.deepEqual(p.support.map(s => s.patch), ['a', 'b', 'c']);
  assert.deepEqual(p.localEquations, [{ patch: 'a', edge: 0 }, { patch: 'b', edge: 0 }]);
  assert(verifyDescentQueryCost(graph, patches, options, p.proof, p.potentials));
  assert.equal(planDescentExtension(graph, patches, { candidates }).complete, false);
});

test('cost verifier rejects a sufficient but costly proof and invalid potentials', () => {
  const direct = [{ kind: 'candidate', index: 2, from: 'a', to: 'c', transport: [] }];
  assert(verifyDescentQuery(graph, patches, options, direct));
  assert.equal(verifyDescentQueryCost(graph, patches, options, direct, gen.plan.potentials), false);
  for (const potentials of [null, {}, [], new Array(4), [...gen.plan.potentials, { patch: 'bad', value: 0 }],
    gen.plan.potentials.map(p => ({ ...p, value: p.patch === 'c' ? 9 : p.value })),
    gen.plan.potentials.map(p => ({ ...p, value: p.patch === 'a' ? NaN : p.value })),
    gen.plan.potentials.map(p => ({ ...p, value: -1 }))])
    assert.equal(verifyDescentQueryCost(graph, patches, options, gen.plan.proof, potentials), false);
  const shifted = gen.plan.potentials.map(p => ({ ...p, value: p.value + 7 }));
  assert(verifyDescentQueryCost(graph, patches, options, gen.plan.proof, shifted));
});

test('malformed proofs, reversed transports, absent evidence and loops are rejected', () => {
  const proof = structuredClone(gen.plan.proof);
  for (const invalid of [null, {}, [], new Array(2), [null], [...proof, ...proof],
    [{ ...proof[0], kind: 'assumed' }, proof[1]], [{ ...proof[0], index: -1 }, proof[1]],
    [{ ...proof[0], index: 99 }, proof[1]], [{ ...proof[0], from: 'b' }, proof[1]],
    [{ ...proof[0], to: 'c' }, proof[1]], [{ ...proof[0], transport: [] }, proof[1]],
    [{ ...proof[0], transport: [99] }, proof[1]], [{ ...proof[0], transport: [0, 0] }, proof[1]],
    [{ ...proof[0], transport: new Array(1) }, proof[1]],
    [{ ...proof[0], transport: null }, proof[1]]])
    assert.equal(verifyDescentQuery(graph, patches, options, invalid), false);
  const reversed = { ...options, query: { ...query, left: 'c', right: 'a' } };
  const p = planDescentQuery(graph, patches, reversed);
  assert.equal(p.minimumCost, 3); assert(verifyDescentQuery(graph, patches, reversed, p.proof));
});

test('retained evidence costs zero but used retained facts are still rechecked', async () => {
  const opts = { query, retained: [candidates[0]], candidates: [candidates[1]] };
  const g = descentQuerySource('retainedGoal', graph, patches, opts);
  assert.equal(g.plan.minimumCost, 2); assert.deepEqual(g.plan.usedRetained, [0]);
  const r = await createRuntime(build(g, `${eq} export fn main = (p:${shape}) ->
    (retainedGoal ${maps}).checkEvidence ${same} p;`));
  const stale = structuredClone(good); stale.a.raw = -3;
  assert.equal(r.call('main', [good]), true); assert.equal(r.call('main', [stale]), false);
});

test('cost-first optimization differs from minimum count and handles zero-cost ties', () => {
  assert.equal(gen.plan.additionalCount, 2); // A one-comparison proof costs 9.
  const tie = candidates.map(c => ({ ...c, cost: 0 }));
  const p = planDescentQuery(graph, patches, { query, candidates: tie });
  assert.equal(p.minimumCost, 0); assert.equal(p.additionalCount, 1); assert.deepEqual(p.selected, [2]);
  const duplicate = planDescentQuery(graph, patches, { query, candidates: [tie[2], tie[2]] });
  assert.deepEqual(duplicate.selected, [0]);
});

test('goal-specific obstruction targets the requested pair, not the first global failure', () => {
  const q = { node: 'summary', left: 'b', right: 'unused' };
  const p = planDescentQuery(graph, patches, { query: q, candidates: [candidates[0]] });
  assert.equal(p.complete, false); assert.equal(p.minimumCost, null); assert.equal(p.potentials, null);
  assert.deepEqual({ node: p.obstruction.witness.node, left: p.obstruction.witness.left, right: p.obstruction.witness.right }, q);
  assert.notEqual(p.obstruction.witness.leftValue, p.obstruction.witness.rightValue);
  assert.throws(() => descentQuerySource('bad', graph, patches, { query: q, candidates: [] }), /Query not implied/);
});

test('reflexive queries need no evidence or equality predicate and select only their value', async () => {
  const g = descentQuerySource('reflexive', graph, patches, { query: { ...query, right: 'a' }, candidates: [] });
  assert.equal(g.plan.minimumCost, 0); assert.deepEqual(g.plan.proof, []);
  assert.deepEqual(g.plan.support, [{ patch: 'a', nodes: ['summary'] }]);
  const r = await createRuntime(build(g, 'export fn main = (x:Num) -> (reflexive {}).select {} {a:{summary:x}};', { maxLoopIterations: 0 }));
  assert.equal(r.call('main', [7]), 7);
});

test('cycles, parallel arrows and shortest transports are explicit in the proof', () => {
  const g = { nodes: ['a', 'b', 'c'], edges: [
    { from: 'a', to: 'b', map: 'f' }, { from: 'b', to: 'a', map: 'g' },
    { from: 'b', to: 'c', map: 'h' }, { from: 'a', to: 'c', map: 'direct' },
    { from: 'a', to: 'c', map: 'parallel' },
  ] };
  const ps = ['left', 'right'].map(name => ({ name, nodes: g.nodes }));
  const opts = { query: { node: 'c', left: 'left', right: 'right' }, candidates: [{ node: 'a', left: 'left', right: 'right' }] };
  const p = planDescentQuery(g, ps, opts);
  assert.deepEqual(p.proof[0].transport, [3]);
  assert(verifyDescentQuery(g, ps, opts, [{ ...p.proof[0], transport: [0, 2] }]));
  assert.equal(verifyDescentQuery(g, ps, opts, [{ ...p.proof[0], transport: [0, 1, 3] }]), false);
});

for (const mode of modes) test(`support-local guards and subset-shaped inputs ${JSON.stringify(mode)}`, async () => {
  const source = `${eq}
    export fn evidence = (p:${shape}) -> (goal ${maps}).checkEvidence ${same} p;
    export fn check = (p:${shape}) -> (goal ${maps}).check ${same} p;
    export fn select = (p:${shape}) -> (goal ${maps}).select ${same} p;`;
  const c = build(gen, source, { ...mode, maxLoopIterations: 0 }), r = await createRuntime(c);
  assert.equal(r.call('select', [good]), 9); assert(verifyCertificate(c.certificate.steps));
  const incoherent = structuredClone(good); incoherent.a.summary = 8;
  assert.equal(r.call('evidence', [incoherent]), true); assert.equal(r.call('check', [incoherent]), false);
  assert.throws(() => r.call('select', [incoherent]), WebAssembly.RuntimeError);
  const mismatch = structuredClone(good); mismatch.c.summary = 10;
  assert.equal(r.call('check', [mismatch]), false);
  assert.throws(() => r.call('select', [mismatch]), WebAssembly.RuntimeError);
  assert.equal(r.call('select', [good]), 9);
});

test('selected evidence stages to byte-identical handwritten comparisons', () => {
  for (const mode of modes) for (const maxLoopIterations of [undefined, 0]) {
    const opts = { ...mode, maxLoopIterations };
    const c = build(gen, `${eq} export fn main = (p:${shape}) -> (goal ${maps}).checkEvidence ${same} p;`, opts);
    const direct = compile(`export fn main = (p:${shape}) -> p.a.raw == p.b.raw && p.b.summary == p.c.summary;`, opts);
    assert.deepEqual(c.bytes, direct.bytes); assert.equal(c.stats.kernelHeapAllocationSites, 0);
  }
});

test('support-local checking ignores irrelevant incoherence and trapping maps', async () => {
  const g = { nodes: ['raw', 'summary', 'other'], edges: [...graph.edges, { from: 'raw', to: 'other', map: 'bad' }] };
  const ps = patches.map(p => ({ ...p, nodes: p.nodes.includes('raw') ? g.nodes : p.nodes }));
  const generated = descentQuerySource('local', g, ps, options);
  // bad is not even required in the map dictionary, nor other/unused in pieces.
  const source = `${eq} export fn main = () -> (local {square:x -> x*x}).select ${same} {
    a:{raw:3,summary:9,other:require false 0},b:{raw:3,summary:9},c:{summary:9},unused:require false {}
  };`;
  for (const mode of modes) assert.equal((await createRuntime(build(generated, source, mode))).call('main', [{}]), 9);
});

test('a failed sufficient guard does not imply unequal results for noninjective maps', async () => {
  const r = await createRuntime(build(gen, `${eq} export fn main = (p:${shape}) -> (goal ${maps}).check ${same} p;`));
  const p = structuredClone(good); p.b.raw = -3;
  assert.equal(p.a.summary, p.c.summary);
  assert.equal(r.call('main', [p]), false);
});

test('local transport loops consume one aggregate allowance and raw calls recover after traps', () => {
  const source = `${eq} export fn main = (a:Num) -> (b:Num) ->
    (goal {square:x -> sum (range x)}).check ${same} {
      a:{raw:a,summary:3},b:{raw:b,summary:3},c:{summary:3}
    };`;
  for (const mode of modes) for (const maxLoopIterations of [5, 6]) {
    const c = build(gen, source, { ...mode, maxLoopIterations });
    const raw = new WebAssembly.Instance(new WebAssembly.Module(c.bytes)).exports.main;
    if (maxLoopIterations === 5) assert.throws(() => raw(3, 3), WebAssembly.RuntimeError);
    else assert.equal(raw(3, 3), 1);
    assert.equal(raw(1, 1), 0); // Coherence fails normally after a fresh allowance.
  }
});

test('map and comparison types, required support fields, effects and ABI escape are checked', () => {
  for (const [source, code] of [
    ['export fn main = () -> (goal {}).select {} {};', 'E_TYPE'],
    [`${eq} export fn main = () -> (goal ${maps}).select ${same} {a:{raw:3,summary:9},b:{raw:3},c:{summary:9}};`, 'E_TYPE'],
    [`export fn main = (p:${shape}) -> (goal ${maps}).checkEvidence {raw:x -> y -> 1,summary:x -> y -> true} p;`, 'E_TYPE'],
    [`export fn main = () -> goal ${maps};`, 'E_ABI'],
    [`${eq} host fn f:Num -> Num; export fn main = (p:${shape}) -> (goal {square:f}).check ${same} p;`, 'E_EFFECT'],
  ]) assert.throws(() => build(gen, source), e => e.code === code, source);
});

test('source-local errors, cache snapshots and lexical captures retain existing behavior', async () => {
  const source = `// app\nexport fn main = (p:${shape}) -> (goal {square:x -> missing x}).select {} p;`;
  const result = checkSources(files(gen, source));
  assert.equal(result.ok, false); assert.equal(result.diagnostics[0].code, 'E_NAME');
  assert.equal(result.diagnostics[0].sourceName, 'app.ass'); assert.equal(result.diagnostics[0].range.start.offset, source.indexOf('missing'));
  const session = createCompiler(), src = files(gen, `${eq} export fn main = (p:${shape}) -> (goal ${maps}).select ${same} p;`);
  const first = session.compileSources(src); first.bytes.fill(0);
  const next = session.compileSources(src); assert(next.cache.hit);
  assert.equal((await createRuntime(next)).call('main', [good]), 9);
});

test('invalid inputs, costs, sparse arrays and unsafe identifier generation are rejected', () => {
  for (const opts of [undefined, null, [], {}, { query, candidates: null }, { query, candidates: new Array(1) },
    { query, retained: null, candidates: [] }, { query: null, candidates: [] },
    { query: { ...query, node: 'unknown' }, candidates: [] }, { query, candidates: [{ ...candidates[0], right: 'a' }] },
    ...[-1, NaN, Infinity, 1e9 + 1, 0.5, '1', null].map(cost => ({ query, candidates: [{ ...candidates[0], cost }] }))])
    assert.throws(() => planDescentQuery(graph, patches, opts), TypeError);
  for (const name of ['do', 'perform', 'x.y', 'x; export fn injected', '', null, 'x'.repeat(65)])
    assert.throws(() => descentQuerySource(name, graph, patches, options), TypeError);
  assert.throws(() => planDescentQuery(graph, patches, { query, retained: Array(2048).fill(candidates[0]), candidates: Array(2049).fill(candidates[1]) }), RangeError);
});

test('plans are frozen snapshots; graph, query, evidence and cost properties are captured once', () => {
  const g = structuredClone(graph), ps = structuredClone(patches), opts = structuredClone(options);
  const p = planDescentQuery(g, ps, opts), before = structuredClone(p);
  g.edges[0].map = 'bad'; ps[0].name = 'bad'; opts.query.left = 'bad'; opts.candidates[0].cost = 99;
  assert.deepEqual(p, before); assert(!Object.isFrozen(opts));
  for (const mutate of [() => p.proof[0].transport.push(5), () => p.support[0].nodes.push('x'),
    () => p.potentials[0].value = 99, () => p.candidates[0].cost = 0]) assert.throws(mutate, TypeError);
  const reads = {};
  function getters(fields, prefix) {
    const obj = {}; for (const [k, v] of Object.entries(fields)) Object.defineProperty(obj, k, { get() {
      const key = `${prefix}.${k}`; reads[key] = (reads[key] ?? 0) + 1; return reads[key] === 1 ? v : null;
    } }); return obj;
  }
  const simple = getters({ nodes: ['x'], edges: [] }, 'g');
  const q = getters({ node: 'x', left: 'a', right: 'b' }, 'q');
  const e = getters({ node: 'x', left: 'a', right: 'b', cost: 1 }, 'e');
  const planned = planDescentQuery(simple, ['a', 'b'].map(name => ({ name, nodes: ['x'] })), { query: q, candidates: [e] });
  assert(planned.complete); assert(Object.values(reads).every(n => n === 1));
});

test('maximum transports and candidate lists stay bounded; maximum patch proof compiles', async () => {
  const nodes = Array.from({ length: 256 }, (_, i) => `n${i}`);
  const g = { nodes, edges: nodes.slice(1).map((to, i) => ({ from: nodes[i], to, map: 'id' })) };
  const ps = ['a', 'b'].map(name => ({ name, nodes }));
  const opts = { query: { node: 'n255', left: 'a', right: 'b' }, candidates: [{ node: 'n0', left: 'a', right: 'b' }] };
  const p = planDescentQuery(g, ps, opts);
  assert.equal(p.proof[0].transport.length, 255); assert.equal(p.localEquations.length, 510);
  assert(verifyDescentQueryCost(g, ps, opts, p.proof, p.potentials));
  const many = Array.from({ length: 32 }, (_, i) => ({ name: `p${i}`, nodes: ['x'] }));
  const cs = many.slice(1).map((p, i) => ({ node: 'x', left: many[i].name, right: p.name, cost: 1e9 }));
  while (cs.length < 4096) cs.push(cs[0]);
  const generated = descentQuerySource('long', { nodes: ['x'], edges: [] }, many,
    { query: { node: 'x', left: 'p0', right: 'p31' }, candidates: cs });
  assert.equal(generated.plan.minimumCost, 31e9); assert.equal(generated.plan.proof.length, 31);
  const pieces = `{${many.map(p => `${p.name}:{x}`).join(',')}}`;
  const r = await createRuntime(build(generated, `${eq} export fn main = (x:Num) -> (long {}).select {x:eq} ${pieces};`));
  assert.equal(r.call('main', [3]), 3);
});

test('product selection still demands its guard, and unconstrained streams retain causal restrictions', async () => {
  const g = { nodes: ['x'], edges: [] }, ps = ['a', 'b'].map(name => ({ name, nodes: ['x'] }));
  const generator = descentQuerySource('pair', g, ps, { query: { node: 'x', left: 'a', right: 'b' }, candidates: [{ node: 'x', left: 'a', right: 'b' }] });
  const r = await createRuntime(build(generator, 'export fn main = (a:Num) -> (b:Num) -> ((pair {}).select {x:p -> q -> p._0==q._0 && p._1==q._1} {a:{x:(1,a)},b:{x:(1,b)}})._0;'));
  assert.equal(r.call('main', [3, 3]), 1); assert.throws(() => r.call('main', [3, 4]), WebAssembly.RuntimeError);
  const reflexive = descentQuerySource('stream', g, ps, { query: { node: 'x', left: 'a', right: 'a' }, candidates: [] });
  const body = 'let xs=(stream {}).select {} {a:{x:scan input 0 (s -> x -> s+x)}};';
  const stream = await createRuntime(build(reflexive, `export fn main = (input:[Num]) -> do {${body} sum xs};`, { maxLoopIterations: 3 }));
  assert.equal(stream.call('main', [[1, 2, 3]]), 10);
  assert.throws(() => stream.call('main', [[1, 2, 3, 4]]), WebAssembly.RuntimeError);
  assert.throws(() => build(reflexive, `export fn main = (input:[Num]) -> do {${body} at xs 0};`), e => e.code === 'E_CAUSAL_ACCESS');
});
