import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compile, compileSources, checkSources, createCompiler, verifyCertificate,
  planDescent, verifyDescent, descentSource, reconstructionSource,
} from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';

const edge = (from, to, map = 'zero') => ({ from, to, map });
const graph = { nodes: ['x', 'y', 'z'], edges: [edge('x', 'z'), edge('y', 'z')] };
const patches = [
  { name: 'left', nodes: ['x', 'z'] },
  { name: 'middle', nodes: ['x', 'y', 'z'] },
  { name: 'right', nodes: ['y', 'z'] },
];
const shape = '{left:{x:Num,z:Num},middle:{x:Num,y:Num,z:Num},right:{y:Num,z:Num}}';
const good = { left: { x: 3, z: 0 }, middle: { x: 3, y: 4, z: 0 }, right: { y: 4, z: 0 } };
const modes = [false, true].flatMap(simd => [false, true].flatMap(reductionFusion =>
  [false, true].map(memoizeReductions => ({ simd, reductionFusion, memoizeReductions }))));
const equal = 'fn equal = x -> y -> x == y;';
const same = '{x:equal,y:equal,z:equal}';
const generated = descentSource('assemble', graph, patches);
const files = (g, source) => [g, { name: 'app.ass', source }];
const build = (g, source, options) => compileSources(files(g, source), options);

test('three patches need two comparisons, not five, with independently verified metadata', () => {
  const p = generated.plan;
  assert.equal(p.minimumComparisons, 2); assert.equal(p.minimumCost, 2);
  assert.equal(p.naiveComparisons, 5); assert.equal(p.localEquations, 4);
  assert.deepEqual(p.comparisons, [
    { node: 'x', left: 'left', right: 'middle' }, { node: 'y', left: 'middle', right: 'right' },
  ]);
  assert.deepEqual(p.components[2].inheritedGroups, [['left', 'middle', 'right']]);
  assert(verifyDescent(graph, patches, p.comparisons));
  assert.equal(verifyDescent(graph, patches, p.comparisons.slice(1)), false);
  assert(verifyDescent(graph, patches, [...p.comparisons, ...p.comparisons]));
  assert(verifyDescent(graph, patches, p.comparisons.map(({ node, left, right }) => ({ node, left: right, right: left }))));
});

test('cycles choose the cheapest coordinate, including zero, with deterministic tie breaks', () => {
  const g = { nodes: ['later', 'a', 'b'], edges: [edge('a', 'b'), edge('b', 'a'), edge('a', 'later')] };
  const ps = ['one', 'two', 'three'].map(name => ({ name, nodes: g.nodes }));
  const p = planDescent(g, ps, { costs: [{ node: 'a', cost: 100 }, { node: 'b', cost: 0 }] });
  assert.equal(p.minimumComparisons, 2); assert.equal(p.minimumCost, 0);
  assert(p.comparisons.every(t => t.node === 'b'));
  assert.equal(p.components[0].requiredComparisons, 0);
  assert(verifyDescent(g, ps, p.comparisons));
  assert(planDescent(g, ps).comparisons.every(t => t.node === 'a'));
});

test('plans own frozen snapshots without freezing or retaining caller inputs', () => {
  const g = structuredClone(graph), ps = structuredClone(patches), costs = [{ node: 'x', cost: 3 }];
  const p = planDescent(g, ps, { costs }), before = structuredClone(p);
  g.nodes[0] = 'changed'; g.edges[0].map = 'changed'; ps[0].nodes[0] = 'changed'; costs[0].cost = 9;
  assert.deepEqual(p, before); assert(!Object.isFrozen(g));
  for (const mutate of [() => p.patches[0].nodes.push('z'), () => p.comparisons[0].node = 'z',
    () => p.components[0].inheritedGroups[0].push('other'), () => p.costs[0].cost = 9,
    () => p.owners[0].patch = 'other', () => generated.source = 'changed']) assert.throws(mutate, TypeError);
});

test('invalid covers, graph inputs, names and sparse arrays are rejected', () => {
  for (const ps of [null, {}, new Array(1), [{ name: 'left', nodes: ['x'] }],
    [{ name: 'left', nodes: ['x', 'z'] }], [{ name: 'p', nodes: ['unknown'] }],
    [{ name: 'p', nodes: new Array(1) }], [{ name: 'p', nodes: ['x', 'x'] }],
    [{ name: 'p', nodes: 'x' }], [{ name: 'p', nodes: graph.nodes }, { name: 'p', nodes: [] }]])
    assert.throws(() => planDescent(graph, ps), TypeError);
  for (const name of ['', 'do', 'perform', 'a.b', 'x; export fn bad', 'x\ny', 'x'.repeat(65), null]) {
    assert.throws(() => descentSource(name, graph, patches), TypeError);
    assert.throws(() => planDescent(graph, [{ name, nodes: graph.nodes }]), TypeError);
  }
  assert.throws(() => planDescent({ nodes: ['x'], edges: [edge('x', 'missing')] }, []), TypeError);
  assert.throws(() => planDescent(graph, patches, null), TypeError);
});

test('cost validation rejects unknown/duplicate coordinates, sparse arrays and unsafe numbers', () => {
  for (const costs of [null, {}, new Array(1), [null], [{ node: 'bad', cost: 1 }],
    [{ node: 'x', cost: 1 }, { node: 'x', cost: 2 }],
    ...[-1, 0.5, Infinity, NaN, 1e9 + 1, '1', null].map(cost => [{ node: 'x', cost }])])
    assert.throws(() => planDescent(graph, patches, { costs }), TypeError);
  const p = planDescent(graph, patches, { costs: [{ node: 'x', cost: 1e9 }] });
  assert.equal(p.minimumCost, 1e9 + 1);
});

test('the verifier rejects malformed proofs instead of trusting metadata', () => {
  for (const comparisons of [null, {}, new Array(1), [null],
    [{ node: 'x', left: 'left', right: 'left' }],
    [{ node: 'x', left: 'left', right: 'right' }],
    [{ node: 'missing', left: 'left', right: 'middle' }],
    [{ node: 'x', left: 'left', right: 'unknown' }]])
    assert.throws(() => verifyDescent(graph, patches, comparisons), TypeError);
  assert.throws(() => verifyDescent(graph, patches, Array(4097).fill(generated.plan.comparisons[0])), RangeError);
});

test('cover limits are enforced while the largest bounded membership plan remains valid', () => {
  const nodes = Array.from({ length: 256 }, (_, i) => `n${i}`);
  const g = { nodes, edges: nodes.slice(1).map((to, i) => edge(nodes[i], to)) };
  const ps = Array.from({ length: 8 }, (_, i) => ({ name: `p${i}`, nodes }));
  const p = planDescent(g, ps);
  assert.equal(p.minimumComparisons, 7); assert.equal(p.localEquations, 2040);
  assert(verifyDescent(g, ps, p.comparisons));
  assert.throws(() => planDescent(g, [...ps, { name: 'too_many', nodes }]), RangeError);
  assert.throws(() => planDescent({ nodes: [], edges: [] }, Array.from({ length: 33 }, (_, i) => ({ name: `p${i}`, nodes: [] }))), RangeError);
  const dense = { nodes: ['x'], edges: Array.from({ length: 2048 }, () => edge('x', 'x')) };
  const two = [{ name: 'a', nodes: ['x'] }, { name: 'b', nodes: ['x'] }];
  assert.equal(planDescent(dense, two).localEquations, 4096);
  assert.throws(() => planDescent(dense, [...two, { name: 'c', nodes: ['x'] }]), RangeError);
});

test('empty diagrams and empty patches give the unique empty join', async () => {
  for (const ps of [[], [{ name: 'empty', nodes: [] }]]) {
    const g = { nodes: [], edges: [] }, generated = descentSource('empty_join', g, ps);
    assert.equal(generated.plan.minimumComparisons, 0); assert.equal(generated.plan.minimumCost, 0);
    assert(verifyDescent(g, ps, []));
    const pieces = ps.length ? '{empty:{}}' : '{}';
    const c = build(generated, `export fn main = () -> (empty_join {}).join {} ${pieces};`, { maxLoopIterations: 0 });
    assert.deepEqual((await createRuntime(c)).call('main', [{}]), {});
  }
});

test('full joins reject both local incoherence and incompatible coherent pieces in all lowering modes', async () => {
  const source = `${equal}
    export fn agree = (pieces:${shape}) -> (assemble {zero:x -> 0}).agree ${same} pieces;
    export fn check = (pieces:${shape}) -> (assemble {zero:x -> 0}).check ${same} pieces;
    export fn join = (pieces:${shape}) -> (assemble {zero:x -> 0}).join ${same} pieces;
    export fn glue = (pieces:${shape}) -> (assemble {zero:x -> 0}).glue pieces;`;
  for (const mode of modes) {
    const r = await createRuntime(build(generated, source, { ...mode, maxLoopIterations: 0 }));
    assert.equal(r.call('agree', [good]), true); assert.equal(r.call('check', [good]), true);
    assert.deepEqual(r.call('join', [good]), { x: 3, y: 4, z: 0 });
    const mismatch = structuredClone(good); mismatch.left.x = 9;
    assert.equal(r.call('agree', [mismatch]), false); assert.equal(r.call('check', [mismatch]), false);
    assert.throws(() => r.call('join', [mismatch]), WebAssembly.RuntimeError);
    const incoherent = structuredClone(good); incoherent.middle.z = 99;
    assert.equal(r.call('agree', [incoherent]), true); // This is not an untrusted-input check.
    assert.equal(r.call('check', [incoherent]), false);
    assert.throws(() => r.call('join', [incoherent]), WebAssembly.RuntimeError);
    assert.deepEqual(r.call('glue', [mismatch]), { x: 9, y: 4, z: 0 });
    assert.deepEqual(r.call('join', [good]), { x: 3, y: 4, z: 0 });
  }
});

test('generated agreement and unchecked assembly erase to handwritten Wasm', async () => {
  for (const mode of modes) for (const maxLoopIterations of [undefined, 0]) {
    const options = { ...mode, maxLoopIterations };
    const source = `${equal} export fn main = (pieces:${shape}) -> (assemble {zero:x -> 0}).agree ${same} pieces;`;
    const direct = `export fn main = (pieces:${shape}) -> pieces.left.x == pieces.middle.x && pieces.middle.y == pieces.right.y;`;
    assert.deepEqual(build(generated, source, options).bytes, compile(direct, options).bytes);
    const glue = `export fn main = (pieces:${shape}) -> (assemble {zero:x -> 0}).glue pieces;`;
    const hand = `export fn main = (pieces:${shape}) -> {x:pieces.left.x,y:pieces.middle.y,z:pieces.left.z};`;
    const c = build(generated, glue, options);
    assert.deepEqual(c.bytes, compile(hand, options).bytes);
    assert.equal(c.stats.kernelHeapAllocationSites, 0);
    assert.equal(verifyCertificate(c.certificate.steps), true);
  }
});

test('descent composes with existing reconstruction protocols', async () => {
  const sources = patches.map(patch => reconstructionSource(`${patch.name}_restore`, {
    nodes: patch.nodes, edges: graph.edges.filter(e => patch.nodes.includes(e.from)),
  }));
  const app = { name: 'app.ass', source: `${equal} export fn main = (x:Num) -> (y:Num) -> do {
    let maps = {zero:n -> 0};
    let pieces = {
      left:(left_restore maps).restore {x},
      middle:(middle_restore maps).restore {x,y},
      right:(right_restore maps).restore {y}
    };
    (assemble maps).join ${same} pieces
  };` };
  for (const mode of modes) {
    const c = compileSources([generated, ...sources, app], { ...mode, maxLoopIterations: 0 });
    assert.deepEqual((await createRuntime(c)).call('main', [3, 4]), { x: 3, y: 4, z: 0 });
  }
});

test('mixed product/Boolean coordinates and captured maps retain their types', async () => {
  const g = { nodes: ['pair', 'positive'], edges: [edge('pair', 'positive', 'above')] };
  const ps = ['a', 'b'].map(name => ({ name, nodes: g.nodes }));
  const gen = descentSource('mixed', g, ps);
  const source = `export fn main = (x:Num) -> (y:Num) -> (threshold:Num) -> do {
    let value={pair:(x,y),positive:x>threshold};
    let same={pair:a -> b -> a._0==b._0 && a._1==b._1,positive:a -> b -> if a then b else !b};
    (mixed {above:p -> p._0>threshold}).join same {a:value,b:value}
  };`;
  const r = await createRuntime(build(gen, source));
  assert.deepEqual(r.call('main', [3, 4, 2]), { pair: { _0: 3, _1: 4 }, positive: true });
});

test('full checks retain every loop and parallel edge equation', async () => {
  const g = { nodes: ['x'], edges: [edge('x', 'x', 'id'), edge('x', 'x', 'bad')] };
  const ps = ['a', 'b'].map(name => ({ name, nodes: ['x'] })), gen = descentSource('loops', g, ps);
  const r = await createRuntime(build(gen, `${equal} export fn main = (x:Num) ->
    (loops {id:x -> x,bad:x -> x+1}).check {x:equal} {a:{x},b:{x}};`));
  assert.equal(r.call('main', [3]), false);
});

test('unused pieces, maps and checks remain lazy; demanding a join field demands validation', async () => {
  for (const mode of modes) {
    const source = `${equal} export fn main = () -> do {
      let p=assemble {zero:x -> require false x};
      let pieces={left:{x:3,z:0},middle:{x:require false 3,y:4,z:0},right:{y:4,z:0}};
      {valid:p.check ${same} pieces,value:(p.glue pieces).x}.value
    };`;
    assert.equal((await createRuntime(build(generated, source, { ...mode, maxLoopIterations: 0 }))).call('main', [{}]), 3);
    const demanded = `${equal} export fn main = (pieces:${shape}) -> ((assemble {zero:x -> 0}).join ${same} pieces).x;`;
    const r = await createRuntime(build(generated, demanded, mode));
    const bad = structuredClone(good); bad.right.y = 99;
    assert.throws(() => r.call('main', [bad]), WebAssembly.RuntimeError);
  }
});

test('balanced conjunctions short-circuit in planned order', async () => {
  const source = `export fn main = (pieces:${shape}) ->
    (assemble {zero:x -> 0}).agree {x:a -> b -> false,y:a -> b -> require false true} pieces;`;
  for (const mode of modes) assert.equal((await createRuntime(build(generated, source, mode))).call('main', [good]), false);
});

test('selected equality loops consume one exact aggregate allowance, including raw Wasm', async () => {
  const source = `fn same = x -> y -> sum (range x) >= 0 && x==y;
    export fn main = (x:Num) -> (y:Num) -> (a:Num) -> (b:Num) ->
      (assemble {zero:x -> 0}).agree {x:same,y:same} {
        left:{x,z:0},middle:{x:a,y,z:0},right:{y:b,z:0}
      };`;
  for (const mode of modes) for (const maxLoopIterations of [6, 7]) {
    const c = build(generated, source, { ...mode, maxLoopIterations });
    const raw = new WebAssembly.Instance(new WebAssembly.Module(c.bytes)).exports.main;
    assert.equal(c.executionLimits.maxLoopIterations, maxLoopIterations);
    if (maxLoopIterations === 6) assert.throws(() => raw(3, 4, 3, 4), WebAssembly.RuntimeError);
    else assert.equal(raw(3, 4, 3, 4), 1);
    assert.equal(raw(1, 1, 1, 1), 1);
  }
});

test('local coherence arrows share the enclosing invocation budget', async () => {
  const g = { nodes: ['n', 'total'], edges: [edge('n', 'total', 'sumRange')] };
  const ps = ['a', 'b'].map(name => ({ name, nodes: g.nodes })), gen = descentSource('metered', g, ps);
  const source = `${equal} export fn main = (a:Num) -> (b:Num) ->
    (metered {sumRange:n -> sum (range n)}).check {n:equal,total:equal} {a:{n:a,total:6},b:{n:b,total:6}};`;
  for (const mode of modes) for (const maxLoopIterations of [7, 8]) {
    const r = await createRuntime(build(gen, source, { ...mode, maxLoopIterations }));
    if (maxLoopIterations === 7) assert.throws(() => r.call('main', [4, 4]), WebAssembly.RuntimeError);
    else assert.equal(r.call('main', [4, 4]), true);
  }
});

test('missing shapes, map/equality types, host effects and protocol ABI escapes remain rejected', () => {
  for (const [source, code] of [
    ['export fn main = () -> (assemble {}).glue {left:{x:3,z:0},middle:{x:3,y:4,z:0},right:{y:4,z:0}};', 'E_TYPE'],
    ['export fn main = () -> (assemble {zero:x -> 0}).glue {left:{x:3,z:0},middle:{x:3,y:4,z:0}};', 'E_TYPE'],
    ['export fn main = () -> (assemble {zero:x -> 0}).glue {left:{x:3,z:0},middle:{x:3,y:4},right:{y:4,z:0}};', 'E_TYPE'],
    [`export fn main = (pieces:${shape}) -> (assemble {zero:x -> 0}).agree {x:a -> b -> 3,y:a -> b -> true} pieces;`, 'E_TYPE'],
    ['export fn main = () -> assemble {zero:x -> 0};', 'E_ABI'],
    [`${equal} host fn audit:Num -> Num; export fn main = (pieces:${shape}) -> (assemble {zero:audit}).check ${same} pieces;`, 'E_EFFECT'],
  ]) assert.throws(() => build(generated, source), e => e.code === code, source);
});

test('single comparisons are constrained to Bool and isolates are required even when unused', () => {
  const g = { nodes: ['x', 'alone'], edges: [] }, ps = [{ name: 'a', nodes: g.nodes }, { name: 'b', nodes: ['x'] }];
  const gen = descentSource('isolates', g, ps);
  assert.throws(() => build(gen, 'export fn main = () -> (isolates {}).agree {x:a -> b -> 3} {a:{x:1,alone:2},b:{x:1}};'), e => e.code === 'E_TYPE');
  assert.throws(() => build(gen, 'export fn main = () -> (isolates {}).agree {x:a -> b -> true} {a:{x:1},b:{x:1}};'), e => e.code === 'E_TYPE');
});

test('source-local diagnostics, duplicate definitions, and cache snapshots survive composition', async () => {
  const source = `// app location\nexport fn main = (pieces:${shape}) -> (assemble {zero:x -> missing x}).glue pieces;`;
  const result = checkSources(files(generated, source), { maxLoopIterations: 0 });
  assert.equal(result.ok, false); assert.equal(result.diagnostics[0].code, 'E_NAME');
  assert.equal(result.diagnostics[0].sourceName, 'app.ass');
  assert.equal(result.diagnostics[0].range.start.offset, source.indexOf('missing'));
  assert.throws(() => build(generated, 'fn assemble = x -> x; export fn main = () -> 1;'), e => e.code === 'E_NAME');
  const session = createCompiler(), src = files(generated, `${equal} export fn main = (pieces:${shape}) -> (assemble {zero:x -> 0}).join ${same} pieces;`);
  const c = session.compileSources(src, { maxLoopIterations: 0 }); c.bytes.fill(0);
  const cached = session.compileSources(src, { maxLoopIterations: 0 });
  assert.equal(cached.cache.hit, true);
  assert.deepEqual((await createRuntime(cached)).call('main', [good]), { x: 3, y: 4, z: 0 });
});

test('generated field names cannot capture locals or inject expressions', async () => {
  const names = ['maps', 'same', 'pieces', 'p0', 'v0_0'];
  const g = { nodes: names, edges: [] }, ps = names.map(name => ({ name, nodes: [name] }));
  const gen = descentSource('same', g, ps);
  const pieces = `{${names.map(name => `${name}:{${name}:3}`).join(',')}}`;
  const r = await createRuntime(build(gen, `export fn main = () -> (same {}).join {} ${pieces};`));
  assert.deepEqual(r.call('main', [{}]), Object.fromEntries(names.map(name => [name, 3])));
});

test('stream assembly preserves causal access, budgets and event-domain separation', async () => {
  const g = { nodes: ['xs', 'prefix'], edges: [edge('xs', 'prefix', 'scan')] };
  const ps = ['a', 'b'].map(name => ({ name, nodes: g.nodes })), gen = descentSource('streams', g, ps);
  const body = `let prefix=scan xs 0 (s -> x -> s+x);
    let value=(streams {scan:ys -> scan ys 0 (s -> x -> s+x)}).glue {a:{xs,prefix},b:{xs,prefix}};`;
  for (const mode of modes) {
    const c = build(gen, `export fn main = (xs:[Num]) -> do {${body} sum value.prefix};`, { ...mode, maxLoopIterations: 4 });
    assert.equal(verifyCertificate(c.certificate.steps), true);
    const r = await createRuntime(c);
    assert.equal(r.call('main', [[1, 2, 3, 4]]), 20);
    assert.throws(() => r.call('main', [[1, 2, 3, 4, 5]]), WebAssembly.RuntimeError);
    assert.throws(() => build(gen, `export fn main = (xs:[Num]) -> do {${body} at value.prefix 0};`, mode), e => e.code === 'E_CAUSAL_ACCESS');
  }
  const independent = descentSource('separate', { nodes: ['a', 'b'], edges: [] }, [
    { name: 'left', nodes: ['a'] }, { name: 'right', nodes: ['b'] },
  ]);
  assert.throws(() => build(independent, `export fn main = (a:[Num]) -> (b:[Num]) -> do {
    let v=(separate {}).join {} {left:{a},right:{b}}; zip v.a v.b (x -> y -> x+y)
  };`), e => e.code === 'E_DOMAIN');
});

test('nontransitive approximate equality demonstrates the documented law boundary', async () => {
  const g = { nodes: ['x'], edges: [] }, ps = ['a', 'b', 'c'].map(name => ({ name, nodes: ['x'] }));
  const gen = descentSource('approx', g, ps);
  const r = await createRuntime(build(gen, `fn near = a -> b -> a-b<1 && b-a<1;
    export fn main = () -> {
      compressed:(approx {}).check {x:near} {a:{x:0},b:{x:0.75},c:{x:-0.75}},
      omitted:near 0.75 (-0.75)
    };`));
  assert.deepEqual(r.call('main', [{}]), { compressed: true, omitted: false });
});

test('numeric equality must be congruent with maps: signed zero is not an automatic law', async () => {
  const g = { nodes: ['x', 'inverse'], edges: [edge('x', 'inverse', 'reciprocal')] };
  const ps = ['a', 'b'].map(name => ({ name, nodes: g.nodes })), gen = descentSource('zeros', g, ps);
  const r = await createRuntime(build(gen, `${equal} export fn main = (x:Num) -> (y:Num) ->
    (zeros {reciprocal:x -> 1/x}).check {x:equal,inverse:equal} {
      a:{x,inverse:1/x},b:{x:y,inverse:1/y}
    };`));
  assert.equal(r.call('main', [0, -0]), true);
  assert.notEqual(1 / 0, 1 / -0); // This predicate is not a congruence for reciprocal.
});

test('validated names and cost snapshots cannot be swapped by accessors', async () => {
  let calls = 0, costCalls = 0;
  const patch = { get name() { return calls++ ? 'x; export fn injected' : 'valid'; }, nodes: ['x'] };
  const costs = [{ node: 'x', get cost() { return costCalls++ ? -9 : 1; } }];
  const gen = descentSource('snapshot', { nodes: ['x'], edges: [] }, [patch], { costs });
  assert.equal(calls, 1); assert.equal(costCalls, 1);
  assert.equal(gen.plan.patches[0].name, 'valid'); assert.equal(gen.plan.costs[0].cost, 1);
  const r = await createRuntime(build(gen, 'export fn main = () -> (snapshot {}).join {} {valid:{x:3}};'));
  assert.deepEqual(r.call('main', [{}]), { x: 3 });
});

test('maximum patch count and maximum local-equation checkers compile and execute', async () => {
  const one = { nodes: ['x'], edges: [] };
  const ps = Array.from({ length: 32 }, (_, i) => ({ name: `p${i}`, nodes: ['x'] }));
  const gen = descentSource('many', one, ps);
  assert.equal(gen.plan.minimumComparisons, 31);
  const pieces = `{${ps.map(p => `${p.name}:{x}`).join(',')}}`;
  const r = await createRuntime(build(gen, `${equal} export fn main = (x:Num) -> (many {}).join {x:equal} ${pieces};`));
  assert.deepEqual(r.call('main', [3]), { x: 3 });
  const dense = descentSource('dense', { nodes: ['x'], edges: Array.from({ length: 2048 }, () => edge('x', 'x', 'id')) }, ps.slice(0, 2));
  const c = build(dense, `${equal} export fn main = (x:Num) -> (dense {id:x -> x}).check {x:equal} {p0:{x},p1:{x}};`);
  const checker = await createRuntime(c);
  assert.equal(checker.call('main', [3]), true);
  assert.equal(checker.call('main', [NaN]), false);
});
