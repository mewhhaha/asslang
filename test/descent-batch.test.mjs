import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileSources, checkSources, createCompiler, verifyCertificate,
  planDescentQuery, planDescentBatch, verifyDescentBatch, descentBatchSource } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';

const graph = { nodes: ['raw', 'summary'], edges: [{ from: 'raw', to: 'summary', map: 'square' }] };
const patches = [{ name: 'a', nodes: graph.nodes }, { name: 'b', nodes: graph.nodes },
  { name: 'c', nodes: ['summary'] }, { name: 'unused', nodes: graph.nodes }];
const queries = [{ name: 'input', node: 'raw', left: 'a', right: 'b' }, { name: 'output', node: 'summary', left: 'a', right: 'c' }];
const candidates = [{ node: 'raw', left: 'a', right: 'b', cost: 4 },
  { node: 'summary', left: 'b', right: 'c', cost: 1 }, { node: 'summary', left: 'a', right: 'c', cost: 3 }];
const options = { queries, candidates }, gen = descentBatchSource('batch', graph, patches, options);
const shape = '{a:{raw:Num,summary:Num},b:{raw:Num,summary:Num},c:{summary:Num}}';
const good = { a: { raw: 3, summary: 9 }, b: { raw: 3, summary: 9 }, c: { summary: 9 } };
const eq = 'fn eq = x -> y -> x==y;', maps = '{square:x -> x*x}', same = '{raw:eq,summary:eq}';
const modes = [false, true].flatMap(simd => [false, true].flatMap(reductionFusion =>
  [false, true].map(memoizeReductions => ({ simd, reductionFusion, memoizeReductions }))));
const files = (g, source) => [g, { name: 'app.ass', source }];
const build = (g, source, opts) => compileSources(files(g, source), opts);

test('shared optimum retains a non-cheapest per-goal alternative and certifies the whole frontier', () => {
  const separate = queries.map(query => planDescentQuery(graph, patches, { query, candidates }));
  const chosen = new Set(separate.flatMap(p => p.selected));
  assert.equal([...chosen].reduce((s, i) => s + candidates[i].cost, 0), 7);
  const p = gen.plan;
  assert.equal(p.minimumCost, 5); assert.equal(p.additionalCount, 2); assert.deepEqual(p.selected, [0, 1]);
  assert.deepEqual(p.frontier.minimal, [[0, 1], [0, 2]]);
  assert.deepEqual(p.frontier.maximalFailures.map(f => f.allowed), [[0], [1, 2]]);
  assert.deepEqual(p.proofs.map(p => p.proof.map(s => s.index)), [[0], [0, 1]]);
  assert.deepEqual(p.support.map(p => p.patch), ['a', 'b', 'c']);
  assert(verifyDescentBatch(graph, patches, options, p));
});

test('missing nonselected alternatives or negative boundaries fail independent verification', () => {
  const mutations = [
    p => p.frontier.minimal.pop(), p => p.frontier.maximalFailures.pop(),
    p => p.frontier.minimal.push([0, 1, 2]), p => p.frontier.maximalFailures.push({ allowed: [], query: 'input', cut: ['a'] }),
    p => p.frontier.maximalFailures[0].cut.push('c'), p => p.frontier.maximalFailures[0].cut = ['b'],
    p => p.frontier.maximalFailures[0].query = 'missing', p => p.frontier.maximalFailures[0].allowed.push(1),
    p => p.frontier.minimal[0] = [0, 0], p => p.frontier.minimal[0] = [1, 0],
    p => p.frontier.minimal[0] = [99], p => p.frontier.maximalFailures[0].allowed = new Array(1),
    p => p.selected = [0, 2], p => p.minimumCost = 7, p => p.additionalCount = 1,
    p => p.proofs[1].name = 'input', p => p.proofs[1].proof[0].transport = [],
    p => p.proofs.pop(), p => p.complete = false,
  ];
  for (const mutate of mutations) { const p = structuredClone(gen.plan); mutate(p); assert.equal(verifyDescentBatch(graph, patches, options, p), false); }
  for (const bad of [null, {}, [], { frontier: {} }, { frontier: { minimal: new Array(1), maximalFailures: [] } }])
    assert.equal(verifyDescentBatch(graph, patches, options, bad), false);
});

test('repricing preserves the structural frontier while changing the selected support', () => {
  const cheaperDirect = candidates.map((c, i) => ({ ...c, cost: i === 2 ? 0 : c.cost }));
  const p = planDescentBatch(graph, patches, { queries, candidates: cheaperDirect });
  assert.deepEqual(p.frontier, gen.plan.frontier); assert.equal(p.minimumCost, 4); assert.deepEqual(p.selected, [0, 2]);
  assert.equal(verifyDescentBatch(graph, patches, { queries, candidates: cheaperDirect }, gen.plan), false);
});

test('retained facts are sunk acquisition costs but are rechecked on current pieces', async () => {
  const g = descentBatchSource('retained', graph, patches, { queries, retained: [candidates[0]], candidates: candidates.slice(1) });
  assert.equal(g.plan.minimumCost, 1); assert.deepEqual(g.plan.usedRetained, [0]);
  const r = await createRuntime(build(g, `${eq} export fn main = (p:${shape}) -> (retained ${maps}).select ${same} p;`));
  assert.deepEqual(r.call('main', [good]), { input: 3, output: 9 });
  const stale = structuredClone(good); stale.a.raw = -3;
  assert.throws(() => r.call('main', [stale]), WebAssembly.RuntimeError);
});

test('impossible batches carry the requested failure and cannot generate a guarded selection', () => {
  const opts = { queries: [...queries, { name: 'missing', node: 'raw', left: 'a', right: 'unused' }], candidates };
  const p = planDescentBatch(graph, patches, opts);
  assert.equal(p.complete, false); assert.equal(p.minimumCost, null); assert.equal(p.additionalCount, null);
  assert.deepEqual(p.frontier.minimal, []); assert.deepEqual(p.frontier.maximalFailures[0].allowed, [0, 1, 2]);
  assert.equal(p.obstruction.witness.right, 'unused'); assert(verifyDescentBatch(graph, patches, opts, p));
  assert.throws(() => descentBatchSource('bad', graph, patches, opts), /Batch not implied/);
});

test('empty batches and reflexive goals require no equality predicates', async () => {
  const empty = descentBatchSource('empty', { nodes: [], edges: [] }, [], { queries: [], candidates: [] });
  assert.deepEqual(empty.plan.frontier, { minimal: [[]], maximalFailures: [] });
  assert.equal(empty.plan.minimumCost, 0);
  assert.deepEqual((await createRuntime(build(empty, 'export fn main = () -> (empty {}).select {} {};', { maxLoopIterations: 0 }))).call('main', [{}]), {});
  const reflexive = descentBatchSource('refl', graph, patches, { queries: [{ name: 'value', node: 'summary', left: 'a', right: 'a' }], candidates: [] });
  assert.deepEqual(reflexive.plan.support, [{ patch: 'a', nodes: ['summary'] }]);
  assert.deepEqual((await createRuntime(build(reflexive, 'export fn main = (x:Num) -> (refl {}).select {} {a:{summary:x}};'))).call('main', [7]), { value: 7 });
});

test('parallel/reversed labels, zero costs and repeated goals retain their set semantics', () => {
  const g = { nodes: ['x'], edges: [] }, ps = ['a', 'b'].map(name => ({ name, nodes: ['x'] }));
  const q = { name: 'one', node: 'x', left: 'a', right: 'b' };
  const opts = { queries: [q, { ...q, name: 'two' }], candidates: [
    { node: 'x', left: 'b', right: 'a', cost: 0 }, { node: 'x', left: 'a', right: 'b', cost: 0 },
  ] };
  const p = planDescentBatch(g, ps, opts);
  assert.deepEqual(p.frontier.minimal, [[0], [1]]); assert.deepEqual(p.selected, [0]);
  assert.equal(p.minimumCost, 0); assert.equal(p.additionalCount, 1); assert(verifyDescentBatch(g, ps, opts, p));
});

for (const mode of modes) test(`atomic shared selection validates sibling goals and local support ${JSON.stringify(mode)}`, async () => {
  const source = `${eq}
    export fn evidence = (p:${shape}) -> (batch ${maps}).checkEvidence ${same} p;
    export fn main = (p:${shape}) -> (batch ${maps}).select ${same} p;
    export fn field = (p:${shape}) -> ((batch ${maps}).select ${same} p).input;`;
  const c = build(gen, source, { ...mode, maxLoopIterations: 0 }), r = await createRuntime(c);
  assert.deepEqual(r.call('main', [good]), { input: 3, output: 9 }); assert(verifyCertificate(c.certificate.steps));
  const bad = structuredClone(good); bad.c.summary = 10;
  assert.throws(() => r.call('field', [bad]), WebAssembly.RuntimeError);
  const local = structuredClone(good); local.a.summary = 10;
  assert.equal(r.call('evidence', [local]), true); assert.throws(() => r.call('main', [local]), WebAssembly.RuntimeError);
  assert.equal(r.call('field', [good]), 3);
});

test('shared evidence is emitted once and erases to handwritten Wasm in all configurations', () => {
  for (const mode of modes) for (const maxLoopIterations of [undefined, 0]) {
    const opts = { ...mode, maxLoopIterations };
    const c = build(gen, `${eq} export fn main = (p:${shape}) -> (batch ${maps}).checkEvidence ${same} p;`, opts);
    const hand = compile(`export fn main = (p:${shape}) -> p.a.raw == p.b.raw && p.b.summary == p.c.summary;`, opts);
    assert.deepEqual(c.bytes, hand.bytes); assert.equal(c.stats.kernelHeapAllocationSites, 0);
  }
});

test('shared comparison loops are charged once across goals, including raw Wasm and trap recovery', () => {
  const source = `fn costly = x -> y -> sum (range x)>=0 && x==y;
    export fn main = (a:Num) -> (b:Num) -> (c:Num) -> (d:Num) ->
    (batch ${maps}).checkEvidence {raw:costly,summary:costly} {
      a:{raw:a,summary:0},b:{raw:b,summary:c},c:{summary:d}
    };`;
  for (const mode of modes) for (const maxLoopIterations of [6, 7]) {
    const c = build(gen, source, { ...mode, maxLoopIterations });
    const raw = new WebAssembly.Instance(new WebAssembly.Module(c.bytes)).exports.main;
    if (maxLoopIterations === 6) assert.throws(() => raw(3, 3, 4, 4), WebAssembly.RuntimeError);
    else assert.equal(raw(3, 3, 4, 4), 1);
    assert.equal(raw(1, 1, 1, 1), 1);
  }
});

test('transport equations shared by repeated goals are deduplicated under the same budget', async () => {
  const extended = descentBatchSource('repeated', graph, patches, { queries: [...queries, { ...queries[1], name: 'again' }], candidates });
  assert.equal(extended.plan.localEquations.length, 2);
  for (const mode of modes) for (const maxLoopIterations of [5, 6]) {
    const source = `${eq} export fn main = (a:Num) -> (b:Num) ->
      (repeated {square:x -> sum (range x)}).check ${same} {a:{raw:a,summary:3},b:{raw:b,summary:3},c:{summary:3}};`;
    const r = await createRuntime(build(extended, source, { ...mode, maxLoopIterations }));
    if (maxLoopIterations === 5) assert.throws(() => r.call('main', [3, 3]), WebAssembly.RuntimeError);
    else assert.equal(r.call('main', [3, 3]), true);
  }
});

test('unrelated fields and maps stay outside generated types and demand', async () => {
  const g = { nodes: ['raw', 'summary', 'other'], edges: [...graph.edges, { from: 'raw', to: 'other', map: 'bad' }] };
  const ps = patches.map(p => ({ ...p, nodes: p.nodes.includes('raw') ? g.nodes : p.nodes }));
  const generated = descentBatchSource('local', g, ps, options);
  const source = `${eq} export fn main = () -> (local ${maps}).select ${same} {
    a:{raw:3,summary:9,other:require false 0},b:{raw:3,summary:9},c:{summary:9},unused:require false {}
  };`;
  for (const mode of modes) assert.deepEqual((await createRuntime(build(generated, source, mode))).call('main', [{}]), { input: 3, output: 9 });
});

test('a failed chosen proof is not a decision that its goals are false', async () => {
  const g = descentBatchSource('only', graph, patches, { queries: [queries[1]], candidates: candidates.slice(0, 2) });
  const p = structuredClone(good); p.b.raw = -3;
  const r = await createRuntime(build(g, `${eq} export fn main = (p:${shape}) -> (only ${maps}).check ${same} p;`));
  assert.equal(p.a.summary, p.c.summary); assert.equal(r.call('main', [p]), false);
});

test('source-local errors, support types, effects, ABI escapes and caches remain checked', async () => {
  for (const [source, code] of [
    ['export fn main = () -> (batch {}).select {} {};', 'E_TYPE'],
    [`export fn main = (p:${shape}) -> (batch ${maps}).checkEvidence {raw:x -> y -> 1,summary:x -> y -> true} p;`, 'E_TYPE'],
    [`export fn main = () -> batch ${maps};`, 'E_ABI'],
    [`${eq} host fn bad:Num -> Num; export fn main = (p:${shape}) -> (batch {square:bad}).check ${same} p;`, 'E_EFFECT'],
  ]) assert.throws(() => build(gen, source), e => e.code === code, source);
  const source = `// local\nexport fn main = (p:${shape}) -> (batch {square:x -> missing x}).select {} p;`;
  const checked = checkSources(files(gen, source));
  assert.equal(checked.diagnostics[0].code, 'E_NAME'); assert.equal(checked.diagnostics[0].sourceName, 'app.ass');
  assert.equal(checked.diagnostics[0].range.start.offset, source.indexOf('missing'));
  const session = createCompiler(), sources = files(gen, `${eq} export fn main = (p:${shape}) -> (batch ${maps}).select ${same} p;`);
  const first = session.compileSources(sources); first.bytes.fill(0);
  const again = session.compileSources(sources); assert(again.cache.hit);
  assert.deepEqual((await createRuntime(again)).call('main', [good]), { input: 3, output: 9 });
});

test('invalid batches, names, memberships, prices, sparse arrays and resource overruns are rejected', () => {
  for (const opts of [undefined, null, [], {}, { queries: null, candidates: [] }, { queries: new Array(1), candidates: [] },
    { queries, candidates: null }, { queries, candidates: new Array(1) }, { queries, retained: null, candidates: [] },
    { queries, candidates: [{ ...candidates[0], right: 'a' }] },
    { queries: [{ ...queries[0], node: 'missing' }], candidates },
    { queries: [queries[0], queries[0]], candidates },
    ...[-1, 0.5, NaN, Infinity, 1e9 + 1, '1', null].map(cost => ({ queries, candidates: [{ ...candidates[0], cost }] }))])
    assert.throws(() => planDescentBatch(graph, patches, opts), TypeError);
  for (const name of ['', 'do', 'perform', 'x.y', 'x; export fn hacked', 'x'.repeat(65), null]) {
    assert.throws(() => descentBatchSource(name, graph, patches, options), TypeError);
    assert.throws(() => planDescentBatch(graph, patches, { queries: [{ ...queries[0], name }], candidates }), TypeError);
  }
  assert.throws(() => planDescentBatch(graph, patches, { queries, candidates: Array(17).fill(candidates[0]) }), RangeError);
  assert.throws(() => planDescentBatch(graph, patches, { queries: Array(9).fill(queries[0]), candidates }), RangeError);
  assert.throws(() => planDescentBatch(graph, patches, { queries, retained: Array(4096).fill(candidates[0]), candidates }), RangeError);
});

test('snapshots are detached and frozen; graph, query, evidence properties are read once', () => {
  const g = structuredClone(graph), ps = structuredClone(patches), opts = structuredClone(options);
  const p = planDescentBatch(g, ps, opts), before = structuredClone(p);
  g.edges[0].map = 'bad'; ps[0].name = 'bad'; opts.queries[0].name = 'bad'; opts.candidates[0].cost = 99;
  assert.deepEqual(p, before); assert(!Object.isFrozen(opts));
  for (const f of [() => p.frontier.minimal[0].push(2), () => p.frontier.maximalFailures[0].cut.push('c'),
    () => p.proofs[0].proof[0].index = 99, () => p.support[0].nodes.push('x')]) assert.throws(f, TypeError);
  const reads = {};
  function once(fields, prefix) {
    const x = {}; for (const [k, value] of Object.entries(fields)) Object.defineProperty(x, k, { get() {
      const key = `${prefix}.${k}`; reads[key] = (reads[key] ?? 0) + 1; return reads[key] === 1 ? value : null;
    } }); return x;
  }
  const gg = once({ nodes: ['x'], edges: [] }, 'g');
  const query = once({ name: 'value', node: 'x', left: 'a', right: 'b' }, 'q');
  const e = once({ node: 'x', left: 'a', right: 'b', cost: 1 }, 'e');
  assert(planDescentBatch(gg, ['a', 'b'].map(name => ({ name, nodes: ['x'] })), { queries: [query], candidates: [e] }).complete);
  assert(Object.values(reads).every(v => v === 1));
});

test('16 candidates expose an exponential frontier without truncation; bit 31 cuts remain correct', () => {
  const ps = Array.from({ length: 9 }, (_, i) => ({ name: `p${i}`, nodes: ['x'] }));
  const cs = ps.slice(1).flatMap((p, i) => [0, 1].map(() => ({ node: 'x', left: ps[i].name, right: p.name, cost: 1e9 })));
  const opts = { queries: [{ name: 'value', node: 'x', left: 'p0', right: 'p8' }], candidates: cs };
  const plan = planDescentBatch({ nodes: ['x'], edges: [] }, ps, opts);
  assert.equal(plan.frontier.minimal.length, 256); assert.equal(plan.frontier.maximalFailures.length, 8);
  assert.equal(plan.minimumCost, 8e9); assert.equal(plan.additionalCount, 8);
  assert(verifyDescentBatch({ nodes: ['x'], edges: [] }, ps, opts, plan));
  const many = Array.from({ length: 32 }, (_, i) => ({ name: `p${i}`, nodes: ['x'] }));
  const q = { name: 'value', node: 'x', left: 'p31', right: 'p0' };
  const candidate = { node: 'x', left: 'p31', right: 'p0' };
  const boundary = planDescentBatch({ nodes: ['x'], edges: [] }, many, { queries: [q], candidates: [candidate] });
  assert.deepEqual(boundary.frontier.maximalFailures[0].cut, ['p31']);
  assert(verifyDescentBatch({ nodes: ['x'], edges: [] }, many, { queries: [q], candidates: [candidate] }, boundary));
});

test('maximum graph transports and eight goals share their local equations', () => {
  const nodes = Array.from({ length: 256 }, (_, i) => `n${i}`);
  const g = { nodes, edges: nodes.slice(1).map((to, i) => ({ from: nodes[i], to, map: 'id' })) };
  const ps = ['a', 'b'].map(name => ({ name, nodes }));
  const opts = { queries: Array.from({ length: 8 }, (_, i) => ({ name: `g${i}`, node: 'n255', left: 'a', right: 'b' })),
    candidates: [{ node: 'n0', left: 'a', right: 'b' }] };
  const plan = planDescentBatch(g, ps, opts);
  assert.equal(plan.localEquations.length, 510); assert.equal(plan.proofs.length, 8);
  assert(plan.proofs.every(p => p.proof[0].transport.length === 255));
  assert(verifyDescentBatch(g, ps, opts, plan));
});

test('hygienic result names, product guards and causal streams preserve language boundaries', async () => {
  const g = { nodes: ['pieces'], edges: [] }, ps = ['same', 'maps'].map(name => ({ name, nodes: ['pieces'] }));
  const generated = descentBatchSource('same', g, ps, { queries: [{ name: 'pieces', node: 'pieces', left: 'same', right: 'maps' }],
    candidates: [{ node: 'pieces', left: 'same', right: 'maps' }] });
  const r = await createRuntime(build(generated, `export fn main = (a:Num) -> (b:Num) ->
    ((same {}).select {pieces:p -> q -> p._0==q._0 && p._1==q._1} {same:{pieces:(1,a)},maps:{pieces:(1,b)}}).pieces._0;`));
  assert.equal(r.call('main', [3, 3]), 1); assert.throws(() => r.call('main', [3, 4]), WebAssembly.RuntimeError);
  const reflexive = descentBatchSource('stream', g, ps, { queries: [{ name: 'data', node: 'pieces', left: 'same', right: 'same' }], candidates: [] });
  const body = 'let v=(stream {}).select {} {same:{pieces:scan input 0 (s -> x -> s+x)}};';
  const runtime = await createRuntime(build(reflexive, `export fn main = (input:[Num]) -> do {${body} sum v.data};`, { maxLoopIterations: 3 }));
  assert.equal(runtime.call('main', [[1, 2, 3]]), 10);
  assert.throws(() => runtime.call('main', [[1, 2, 3, 4]]), WebAssembly.RuntimeError);
  assert.throws(() => build(reflexive, `export fn main = (input:[Num]) -> do {${body} at v.data 0};`), e => e.code === 'E_CAUSAL_ACCESS');
});
