import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { compile, compileSources, checkSources, createCompiler, descentSource,
  planDescentExtension, descentCountermodel, descentExtensionSource, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';

const graph = { nodes: ['x', 'alias', 'summary'], edges: [
  { from: 'x', to: 'alias', map: 'id' }, { from: 'alias', to: 'x', map: 'id' },
  { from: 'x', to: 'summary', map: 'zero' },
] };
const patches = ['a', 'b', 'c', 'd'].map(name => ({ name, nodes: graph.nodes }));
const retained = [{ node: 'x', left: 'a', right: 'b' }];
const candidates = [
  { node: 'x', left: 'a', right: 'c', cost: 9 },
  { node: 'alias', left: 'b', right: 'c', cost: 2 },
  { node: 'x', left: 'c', right: 'd', cost: 1 },
  { node: 'alias', left: 'a', right: 'd', cost: 8 },
  { node: 'summary', left: 'b', right: 'd', cost: 0 },
];
const options = { retained, candidates }, generated = descentExtensionSource('extend', graph, patches, options);
const shape = '{a:{x:Num,alias:Num,summary:Num},b:{x:Num,alias:Num,summary:Num},c:{x:Num,alias:Num,summary:Num},d:{x:Num,alias:Num,summary:Num}}';
const equal = 'fn eq = x -> y -> x==y;';
const dictionary = '{id:x -> x,zero:x -> 0}', same = '{x:eq,alias:eq,summary:eq}';
const good = Object.fromEntries(patches.map(p => [p.name, { x: 5, alias: 5, summary: 0 }]));
const modes = [false, true].flatMap(simd => [false, true].flatMap(reductionFusion =>
  [false, true].map(memoizeReductions => ({ simd, reductionFusion, memoizeReductions }))));
const files = (g, source) => [g, { name: 'app.ass', source }];
const build = (g, source, opts) => compileSources(files(g, source), opts);

test('pair-specific costs, retained facts and unavailable checks produce the exact extension', () => {
  const p = generated.plan;
  assert.equal(p.rank, 3); assert.equal(p.retainedRank, 1); assert.equal(p.achievedRank, 3);
  assert.equal(p.complete, true); assert.equal(p.minimumAdditional, 2); assert.equal(p.minimumCost, 3);
  assert.deepEqual(p.selected, [2, 1]); // A zero-cost downstream loop cannot replace an upstream check.
  assert.deepEqual(p.comparisons, [...retained, ...p.additional]); assert.equal(p.obstruction, null);
  assert.deepEqual(p.components[0].retainedGroups, [['a', 'b'], ['c'], ['d']]);
  assert.deepEqual(p.components[0].finalGroups, [['a', 'b', 'c', 'd']]);
});

test('infeasible restrictions return a genuine obstruction, never a fake minimum or generated join', () => {
  const opts = { retained, candidates: [candidates[2]] }, p = planDescentExtension(graph, patches, opts);
  assert.equal(p.complete, false); assert.equal(p.achievedRank, 2);
  assert.equal(p.minimumAdditional, null); assert.equal(p.minimumCost, null);
  assert.equal(p.additional.length, 1); assert.equal(p.obstruction.witness.node, 'x');
  assert.throws(() => descentExtensionSource('bad', graph, patches, opts), /No descent extension.*disagree/);
});

test('parallel comparisons, orientation, zero costs and input order are handled deterministically', () => {
  const g = { nodes: ['x'], edges: [] }, ps = ['a', 'b', 'c'].map(name => ({ name, nodes: ['x'] }));
  const list = [
    { node: 'x', left: 'b', right: 'a', cost: 0 },
    { node: 'x', left: 'a', right: 'b', cost: 0 },
    { node: 'x', left: 'b', right: 'c', cost: 0 },
    { node: 'x', left: 'a', right: 'c', cost: 2 },
  ];
  const p = planDescentExtension(g, ps, { candidates: list });
  assert.deepEqual(p.selected, [0, 2]); assert.equal(p.minimumCost, 0);
  const reused = planDescentExtension(g, ps, { retained: p.comparisons, candidates: [] });
  assert.equal(reused.complete, true); assert.equal(reused.minimumAdditional, 0);
});

test('empty diagrams and already-complete retained sets require no new comparisons', async () => {
  const empty = descentExtensionSource('empty', { nodes: [], edges: [] }, [], { candidates: [] });
  assert.equal(empty.plan.rank, 0); assert.equal(empty.plan.complete, true);
  assert.equal(empty.plan.minimumAdditional, 0); assert.equal(empty.plan.minimumCost, 0);
  assert.equal(descentCountermodel({ nodes: [], edges: [] }, [], []), null);
  const c = build(empty, 'export fn main = () -> (empty {}).join {} {};', { maxLoopIterations: 0 });
  assert.deepEqual((await createRuntime(c)).call('main', [{}]), {});
});

test('new snapshots are deeply frozen and detached from caller data', () => {
  const g = structuredClone(graph), ps = structuredClone(patches), opts = structuredClone(options);
  const p = planDescentExtension(g, ps, opts), copy = structuredClone(p);
  g.edges[0].map = 'changed'; ps[0].nodes[0] = 'changed'; opts.retained[0].left = 'changed'; opts.candidates[0].cost = 99;
  assert.deepEqual(p, copy); assert(!Object.isFrozen(opts));
  for (const mutate of [() => p.selected.push(4), () => p.candidates[0].cost = 3,
    () => p.retained[0].node = 'bad', () => p.components[0].retainedGroups[0].push('bad'),
    () => generated.source = 'bad']) assert.throws(mutate, TypeError);
  const q = descentCountermodel(graph, patches, []);
  assert.throws(() => q.arrows[0].table[0] = 3, TypeError);
  assert.throws(() => q.sections[0].values[0].value = 3, TypeError);
});

test('invalid option, comparison, cost and name shapes are rejected', () => {
  for (const opts of [undefined, null, [], {}, { candidates: null }, { candidates: new Array(1) },
    { retained: null, candidates: [] }, { retained: new Array(1), candidates: [] },
    { candidates: [null] }, ...[-1, 0.1, NaN, Infinity, 1e9 + 1, '1', null].map(cost => ({ candidates: [{ ...candidates[0], cost }] }))])
    assert.throws(() => planDescentExtension(graph, patches, opts), TypeError);
  for (const c of [{ node: 'x', left: 'a', right: 'a' }, { node: 'bad', left: 'a', right: 'b' },
    { node: 'x', left: 'missing', right: 'b' }, { node: 'x', left: {}, right: 'b' }]) {
    assert.throws(() => planDescentExtension(graph, patches, { candidates: [c] }), TypeError);
    assert.throws(() => descentCountermodel(graph, patches, [c]), TypeError);
  }
  for (const name of ['do', 'x; export fn hacked', 'x.y', 'x\ny', '', null])
    assert.throws(() => descentExtensionSource(name, graph, patches, options), TypeError);
  for (const input of [null, new Array(1), [null]]) assert.throws(() => descentCountermodel(graph, patches, input), TypeError);
  const p = planDescentExtension(graph, patches, { retained: generated.plan.comparisons, candidates: [retained[0]] });
  assert.equal(p.candidates[0].cost, 1);
});

test('accessor-controlled comparisons are captured once before validation', () => {
  const calls = new Map();
  const entry = {};
  for (const [field, value] of Object.entries({ node: 'x', left: 'a', right: 'b', cost: 1 }))
    Object.defineProperty(entry, field, { get() { calls.set(field, (calls.get(field) ?? 0) + 1); return calls.get(field) === 1 ? value : 'bad; injected'; } });
  const p = planDescentExtension({ nodes: ['x'], edges: [] }, patches.slice(0, 2).map(p => ({ name: p.name, nodes: ['x'] })), { candidates: [entry] });
  assert.equal(p.complete, true); assert.deepEqual([...calls.values()], [1, 1, 1, 1]);
});

test('combined test limits and maximum-cost sums are exact', () => {
  const test = retained[0];
  assert.throws(() => planDescentExtension(graph, patches, { retained: Array(2048).fill(test), candidates: Array(2049).fill(test) }), RangeError);
  assert.throws(() => descentCountermodel(graph, patches, Array(4097).fill(test)), RangeError);
  const ps = Array.from({ length: 32 }, (_, i) => ({ name: `p${i}`, nodes: ['x'] }));
  const list = ps.slice(1).map(p => ({ node: 'x', left: 'p0', right: p.name, cost: 1e9 }));
  while (list.length < 4096) list.push({ ...list[0] });
  const p = planDescentExtension({ nodes: ['x'], edges: [] }, ps, { candidates: list });
  assert.equal(p.minimumAdditional, 31); assert.equal(p.minimumCost, 31e9);
  assert.equal(p.selected.length, 31);
});

for (const mode of modes) test(`full checks recheck retained facts; conditional checks expose assumptions ${JSON.stringify(mode)}`, async () => {
  const source = `${equal}
    export fn extra = (p:${shape}) -> (extend ${dictionary}).checkAdditional ${same} p;
    export fn agree = (p:${shape}) -> (extend ${dictionary}).agree ${same} p;
    export fn check = (p:${shape}) -> (extend ${dictionary}).check ${same} p;
    export fn join = (p:${shape}) -> (extend ${dictionary}).join ${same} p;
    export fn field = (p:${shape}) -> ((extend ${dictionary}).join ${same} p).x;
  `;
  const c = build(generated, source, { ...mode, maxLoopIterations: 0 }), r = await createRuntime(c);
  assert.equal(r.call('extra', [good]), true); assert.equal(r.call('check', [good]), true);
  assert.deepEqual(r.call('join', [good]), { x: 5, alias: 5, summary: 0 });
  const stale = structuredClone(good); stale.a.x = stale.a.alias = 9;
  assert.equal(r.call('extra', [stale]), true); assert.equal(r.call('agree', [stale]), false);
  assert.equal(r.call('check', [stale]), false);
  assert.throws(() => r.call('join', [stale]), WebAssembly.RuntimeError);
  assert.throws(() => r.call('field', [stale]), WebAssembly.RuntimeError);
  const incoherent = structuredClone(good); incoherent.a.summary = 3;
  assert.equal(r.call('extra', [incoherent]), true); assert.equal(r.call('agree', [incoherent]), true);
  assert.equal(r.call('check', [incoherent]), false);
  assert.throws(() => r.call('join', [incoherent]), WebAssembly.RuntimeError);
  assert.equal(r.call('field', [good]), 5);
});

test('conditional checks erase to exactly their handwritten comparisons', async () => {
  for (const mode of modes) for (const maxLoopIterations of [undefined, 0]) {
    const opts = { ...mode, maxLoopIterations };
    const source = `${equal} export fn main = (p:${shape}) -> (extend ${dictionary}).checkAdditional ${same} p;`;
    const hand = `export fn main = (p:${shape}) -> p.c.x == p.d.x && p.b.alias == p.c.alias;`;
    const c = build(generated, source, opts);
    assert.deepEqual(c.bytes, compile(hand, opts).bytes);
    assert(verifyCertificate(c.certificate.steps)); assert.equal(c.stats.kernelHeapAllocationSites, 0);
  }
});

test('conditional agreement loops share one exact budget and raw calls reset after traps', () => {
  const g = { nodes: ['x'], edges: [] }, ps = ['a', 'b', 'c'].map(name => ({ name, nodes: ['x'] }));
  const gen = descentExtensionSource('loops', g, ps, { candidates: [
    { node: 'x', left: 'a', right: 'b' }, { node: 'x', left: 'b', right: 'c' },
  ] });
  const source = `fn eq = x -> y -> sum (range x)>=0 && x==y;
    export fn main = (a:Num) -> (b:Num) -> (c:Num) ->
      (loops {}).checkAdditional {x:eq} {a:{x:a},b:{x:b},c:{x:c}};`;
  for (const mode of modes) for (const maxLoopIterations of [5, 6]) {
    const c = build(gen, source, { ...mode, maxLoopIterations });
    const raw = new WebAssembly.Instance(new WebAssembly.Module(c.bytes)).exports.main;
    if (maxLoopIterations === 5) assert.throws(() => raw(3, 3, 3), WebAssembly.RuntimeError);
    else assert.equal(raw(3, 3, 3), 1);
    assert.equal(raw(1, 1, 1), 1);
  }
});

test('only retained checks are skipped by checkAdditional, never by full agree', async () => {
  const g = { nodes: ['x', 'y'], edges: [] }, ps = ['a', 'b'].map(name => ({ name, nodes: g.nodes }));
  const gen = descentExtensionSource('reuse', g, ps, {
    retained: [{ node: 'x', left: 'a', right: 'b' }], candidates: [{ node: 'y', left: 'a', right: 'b' }],
  });
  for (const mode of modes) {
    const r = await createRuntime(build(gen, `fn eq = x -> y -> x==y;
      export fn extra = () -> (reuse {}).checkAdditional {x:a -> b -> require false true,y:eq} {a:{x:1,y:2},b:{x:1,y:2}};
      export fn full = () -> (reuse {}).agree {x:a -> b -> require false true,y:eq} {a:{x:1,y:2},b:{x:1,y:2}};`, mode));
    assert.equal(r.call('extra', [{}]), true);
    assert.throws(() => r.call('full', [{}]), WebAssembly.RuntimeError);
  }
});

test('mixed product and Boolean coordinates preserve captured maps and comparison typing', async () => {
  const g = { nodes: ['pair', 'flag'], edges: [{ from: 'pair', to: 'flag', map: 'positive' }] };
  const ps = ['a', 'b'].map(name => ({ name, nodes: g.nodes }));
  const gen = descentExtensionSource('mixed', g, ps, { candidates: [{ node: 'pair', left: 'a', right: 'b' }] });
  const r = await createRuntime(build(gen, `export fn main = (x:Num) -> (limit:Num) -> do {
    let value={pair:(x,2),flag:x>limit};
    (mixed {positive:p -> p._0>limit}).join {
      pair:p -> q -> p._0==q._0 && p._1==q._1,flag:p -> q -> if p then q else !q
    } {a:value,b:value}
  };`));
  assert.deepEqual(r.call('main', [4, 3]), { pair: { _0: 4, _1: 2 }, flag: true });
});

test('missing fields, bad equality, host effects and protocol ABI escapes are rejected', () => {
  for (const [source, code] of [
    ['export fn main = () -> (extend {id:x -> x,zero:x -> 0}).checkAdditional {} {};', 'E_TYPE'],
    [`export fn main = (p:${shape}) -> (extend ${dictionary}).checkAdditional {x:a -> b -> 1,alias:a -> b -> true} p;`, 'E_TYPE'],
    [`export fn main = () -> extend ${dictionary};`, 'E_ABI'],
    [`${equal} host fn audit:Num -> Num; export fn main = (p:${shape}) -> (extend {id:audit,zero:x -> 0}).check ${same} p;`, 'E_EFFECT'],
  ]) assert.throws(() => build(generated, source), e => e.code === code, source);
  const g = { nodes: ['x'], edges: [] }, ps = ['a', 'b'].map(name => ({ name, nodes: ['x'] }));
  const gen = descentExtensionSource('single', g, ps, { candidates: [{ node: 'x', left: 'a', right: 'b' }] });
  assert.throws(() => build(gen, 'export fn main = () -> (single {}).checkAdditional {x:a -> b -> 3} {a:{x:1},b:{x:1}};'), e => e.code === 'E_TYPE');
});

test('source-local diagnostics, caches and generated-name collisions remain ordinary checked behavior', async () => {
  const source = `// app location\nexport fn main = (p:${shape}) -> (extend {id:x -> missing x,zero:x -> 0}).glue p;`;
  const checked = checkSources(files(generated, source));
  assert.equal(checked.ok, false); assert.equal(checked.diagnostics[0].code, 'E_NAME');
  assert.equal(checked.diagnostics[0].sourceName, 'app.ass');
  assert.equal(checked.diagnostics[0].range.start.offset, source.indexOf('missing'));
  assert.throws(() => build(generated, 'fn extend = x -> x; export fn main = () -> 1;'), e => e.code === 'E_NAME');
  const session = createCompiler(), src = files(generated, `${equal} export fn main = (p:${shape}) -> (extend ${dictionary}).join ${same} p;`);
  const first = session.compileSources(src, { maxLoopIterations: 0 }); first.bytes.fill(0);
  const cached = session.compileSources(src, { maxLoopIterations: 0 }); assert(cached.cache.hit);
  assert.deepEqual((await createRuntime(cached)).call('main', [good]), { x: 5, alias: 5, summary: 0 });
});

test('generated local names cannot capture validated coordinate or patch names', async () => {
  const g = { nodes: ['same', 'pieces', 'p0'], edges: [] }, ps = ['maps', 'pieces'].map(name => ({ name, nodes: g.nodes }));
  const cs = g.nodes.map(node => ({ node, left: 'maps', right: 'pieces' }));
  const gen = descentExtensionSource('same', g, ps, { candidates: cs });
  const r = await createRuntime(build(gen, `${equal} export fn main = () -> do {
    let value={same:1,pieces:2,p0:3}; (same {}).join {same:eq,pieces:eq,p0:eq} {maps:value,pieces:value}
  };`));
  assert.deepEqual(r.call('main', [{}]), { same: 1, pieces: 2, p0: 3 });
});

test('unchecked stream assembly preserves causal access and event domains', async () => {
  const g = { nodes: ['xs'], edges: [] }, ps = ['a', 'b'].map(name => ({ name, nodes: ['xs'] }));
  const gen = descentExtensionSource('streams', g, ps, { candidates: [{ node: 'xs', left: 'a', right: 'b' }] });
  const body = 'let ys=scan xs 0 (s -> x -> s+x); let v=(streams {}).glue {a:{xs:ys},b:{xs:ys}};';
  for (const mode of modes) {
    const r = await createRuntime(build(gen, `export fn main = (xs:[Num]) -> do {${body} sum v.xs};`, { ...mode, maxLoopIterations: 3 }));
    assert.equal(r.call('main', [[1, 2, 3]]), 10);
    assert.throws(() => r.call('main', [[1, 2, 3, 4]]), WebAssembly.RuntimeError);
    assert.throws(() => build(gen, `export fn main = (xs:[Num]) -> do {${body} at v.xs 0};`, mode), e => e.code === 'E_CAUSAL_ACCESS');
  }
  const separate = descentExtensionSource('separate', { nodes: ['x', 'y'], edges: [] }, [
    { name: 'a', nodes: ['x'] }, { name: 'b', nodes: ['y'] },
  ], { candidates: [] });
  assert.throws(() => build(separate, 'export fn main = (x:[Num]) -> (y:[Num]) -> do {let v=(separate {}).join {} {a:{x},b:{y}}; zip v.x v.y (a -> b -> a+b)};'), e => e.code === 'E_DOMAIN');
});

test('shared emitter preserves pre-extension descent source snapshots exactly', async () => {
  const fixtures = JSON.parse(await readFile(new URL('./fixtures/descent-source-golden.json', import.meta.url), 'utf8'));
  for (const f of fixtures) {
    const generated = descentSource(f.name, f.graph, f.patches, f.options);
    assert.equal(createHash('sha256').update(generated.source).digest('hex'), f.sha256);
  }
});

test('graph properties are captured once, and maximum retained proofs still compile', async () => {
  let nodeReads = 0, edgeReads = 0;
  const graph = {
    get nodes() { nodeReads++; return nodeReads === 1 ? ['x'] : null; },
    get edges() { edgeReads++; return edgeReads === 1 ? [] : null; },
  };
  const ps = ['a', 'b'].map(name => ({ name, nodes: ['x'] }));
  const c = { node: 'x', left: 'a', right: 'b' };
  const gen = descentExtensionSource('dense', graph, ps, { retained: Array(4096).fill(c), candidates: [] });
  assert.equal(nodeReads, 1); assert.equal(edgeReads, 1);
  assert.equal(gen.plan.minimumAdditional, 0); assert.equal(gen.plan.retainedRank, 1);
  const r = await createRuntime(build(gen, `${equal} export fn main = (a:Num) -> (b:Num) ->
    (dense {}).check {x:eq} {a:{x:a},b:{x:b}};`));
  assert.equal(r.call('main', [3, 3]), true);
  assert.equal(r.call('main', [3, 4]), false);
});
