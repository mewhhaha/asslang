import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceAlgebra, compile, compileSources, checkSources, createCompiler, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';
const modes = [false, true].flatMap(simd => [false, true].flatMap(reductionFusion =>
  [false, true].map(memoizeReductions => ({ simd, reductionFusion, memoizeReductions }))));
const d = createEvidenceAlgebra(['x', 'y', 'z']);
const x = d.atom('x'), y = d.atom('y'), z = d.atom('z');
const f = d.all([x, d.any([y, z])]), generated = d.source('accept', f);
const files = (g, source) => [g, { name: 'app.ass', source }];
const build = (g, source, options) => compileSources(files(g, source), options);
const shape = '{x:Bool,y:Bool,z:Bool}';

test('opaque handles cannot be forged or accidentally mixed between namespaces', () => {
  const other = createEvidenceAlgebra(['x']), ox = other.atom('x');
  assert.notEqual(ox, x); assert(Object.isFrozen(x));
  for (const forged of [{}, { ...x }, 2, null, [], undefined])
    assert.throws(() => d.evaluate(forged, []), TypeError);
  for (const operation of [() => d.all([ox]), () => d.any([ox]), () => d.equivalent(x, ox),
    () => d.residual(x, ox), () => d.source('wrong', ox), () => d.minimum(ox), () => d.inspect(ox)])
    assert.throws(operation, TypeError);
  assert.equal(d.substitute(ox, [{ atom: 'x', value: y }]), y);
});

test('frontier import and canonical sharing preserve alternatives without authenticating them', () => {
  assert.equal(d.fromFrontier([['x', 'y'], ['x', 'z']]), f);
  assert.equal(d.all([f, f]), f); assert.equal(d.any([x, d.all([x, y])]), x);
  assert.equal(d.all([]), d.always); assert.equal(d.any([]), d.never);
  assert.equal(d.fromFrontier([]), d.never); assert.equal(d.fromFrontier([[]]), d.always);
  assert.deepEqual(d.inspect(d.any([x, d.all([x, y])])).support, ['x']);
});

test('substitution requires exactly the used template vocabulary and target-owned replacements', () => {
  for (const input of [null, new Array(1), [], [{ atom: 'x', value: x }],
    [{ atom: 'x', value: x }, { atom: 'y', value: y }, { atom: 'z', value: {} }],
    [{ atom: 'x', value: x }, { atom: 'x', value: y }, { atom: 'z', value: z }]])
    assert.throws(() => d.substitute(f, input));
  assert.throws(() => d.substitute(x, [{ atom: 'y', value: y }]), TypeError);
  const other = createEvidenceAlgebra(['q']);
  assert.throws(() => d.substitute(x, [{ atom: 'x', value: other.atom('q') }]), TypeError);
  assert.equal(d.substitute(d.always, []), d.always);
});

test('invalid atoms, costs, sparse data and explicit operation bounds are rejected', () => {
  for (const input of [null, {}, ['x', 'x'], new Array(1), ['do'], ['x; export fn bad'], ['x.y'], ['x'.repeat(65)]])
    assert.throws(() => createEvidenceAlgebra(input), TypeError);
  assert.throws(() => createEvidenceAlgebra(Array.from({ length: 129 }, (_, i) => `x${i}`)), RangeError);
  for (const options of [null, [], { maxNodes: null }, { maxNodes: 1 }, { maxNodes: 65537 },
    { maxWork: 0 }, { maxWork: 2000001 }, { maxWork: 1.2 }]) assert.throws(() => createEvidenceAlgebra([], options));
  for (const input of [null, {}, new Array(1), ['bad'], ['x', 'x']]) assert.throws(() => d.evaluate(x, input), TypeError);
  for (const input of [null, [null], new Array(1), [{ atom: 'bad', cost: 1 }],
    [{ atom: 'x', cost: 1 }, { atom: 'x', cost: 2 }],
    ...[-1, NaN, Infinity, 0.5, 1e9 + 1, '1', null].map(cost => [{ atom: 'x', cost }])])
    assert.throws(() => d.minimum(x, input));
  assert.throws(() => d.all(Array(4097).fill(x)), RangeError);
  assert.throws(() => d.fromFrontier(Array(4097).fill([])), RangeError);
  for (const input of [null, [null], new Array(1), [['x', 'x']], [['unknown']]]) assert.throws(() => d.fromFrontier(input));
  for (const name of ['do', '', 'x.y', 'x; export fn bad']) assert.throws(() => d.source(name, x), TypeError);
});

test('resource failures roll back allocations and preserve all pre-existing contracts', () => {
  const small = createEvidenceAlgebra(['a', 'b'], { maxNodes: 5 }), a = small.atom('a'), b = small.atom('b');
  const before = small.stats.nodes;
  // and(a,b) fits; negation and the residual together need more nodes.
  assert.throws(() => small.residual(a, b), RangeError);
  assert.equal(small.stats.nodes, before);
  assert(small.evaluate(a, ['a']));
  const both = small.all([a, b]); assert.equal(small.stats.nodes, 5);
  assert.throws(() => small.any([a, b]), RangeError);
  assert.equal(small.all([a, b]), both); assert(small.evaluate(both, ['a', 'b']));
  const work = createEvidenceAlgebra(['a', 'b'], { maxWork: 3 }), wa = work.atom('a'), wb = work.atom('b');
  const retained = work.stats.nodes;
  assert.throws(() => work.all([wa, wb]), /work limit/);
  assert.equal(work.stats.nodes, retained); assert.equal(work.all([wa]), wa);
  const constants = createEvidenceAlgebra(['x'], { maxNodes: 2 });
  assert.throws(() => constants.atom('x'), /node limit/); assert.equal(constants.stats.nodes, 2);
  assert(constants.evaluate(constants.always, []));
});

test('snapshots and accessor inputs are detached without freezing caller objects', () => {
  const atoms = ['x']; const a = createEvidenceAlgebra(atoms), h = a.atom('x'); atoms[0] = 'bad';
  assert.deepEqual(a.atoms, ['x']); assert(!Object.isFrozen(atoms));
  const snap = a.inspect(h);
  assert.throws(() => snap.nodes[0].low = 1, TypeError);
  assert.throws(() => a.stats.nodes = 0, TypeError);
  const b = createEvidenceAlgebra(['y']); let n = 0, v = 0;
  const binding = { get atom() { n++; return n === 1 ? 'x' : 'bad'; }, get value() { v++; return b.atom('y'); } };
  assert.equal(b.substitute(h, [binding]), b.atom('y')); assert.equal(n, 1); assert.equal(v, 1);
  let costs = 0;
  assert.equal(b.minimum(b.atom('y'), [{ atom: 'y', get cost() { costs++; return 3; } }]).cost, 3);
  assert.equal(costs, 1);
});

for (const mode of modes) test(`generated contracts have exact Boolean truth and matching handwritten Wasm ${JSON.stringify(mode)}`, async () => {
  const source = `export fn main = (facts:${shape}) -> accept facts;`;
  const c = build(generated, source, { ...mode, maxLoopIterations: 0 });
  const direct = compile(`export fn main = (facts:${shape}) -> facts.x && (facts.y || facts.z);`, { ...mode, maxLoopIterations: 0 });
  assert.deepEqual(c.bytes, direct.bytes); assert(verifyCertificate(c.certificate.steps));
  assert.equal(c.stats.kernelHeapAllocationSites, 0);
  const r = await createRuntime(c);
  for (const a of [false, true]) for (const b of [false, true]) for (const c of [false, true])
    assert.equal(r.call('main', [{ x: a, y: b, z: c }]), a && (b || c));
});

test('generated factoring agrees with independent truth tables on every three-atom monotone function', async () => {
  for (let mask = 0; mask < 256; mask++) {
    const values = Array.from({ length: 8 }, (_, i) => !!(mask & (1 << i)));
    const monotone = values.every((value, i) => !value || values.every((larger, j) => (i & j) !== i || larger));
    if (!monotone) continue;
    const frontier = values.flatMap((value, i) => value ? [['x', 'y', 'z'].filter((_, j) => i & (1 << j))] : []);
    const h = d.fromFrontier(frontier), src = d.source('law', h);
    const r = await createRuntime(build(src, `export fn main = (facts:${shape}) -> law facts;`));
    for (let i = 0; i < 8; i++) assert.equal(r.call('main', [{ x: !!(i & 1), y: !!(i & 2), z: !!(i & 4) }]), values[i]);
  }
});

test('principal completion must be guarded by the actual guarantee; selected records retain guards', async () => {
  const missing = d.residual(d.any([y, z]), f), src = d.source('missing', missing);
  assert.equal(missing, x);
  const source = `export fn main = (facts:${shape}) ->
    (require ((facts.y || facts.z) && missing facts) {value:7, other:9}).value;`;
  for (const mode of modes) {
    const r = await createRuntime(build(src, source, mode));
    assert.equal(r.call('main', [{ x: true, y: false, z: true }]), 7);
    for (const facts of [{ x: true, y: false, z: false }, { x: false, y: true, z: true }])
      assert.throws(() => r.call('main', [facts]), WebAssembly.RuntimeError);
    assert.equal(r.call('main', [{ x: true, y: true, z: false }]), 7);
  }
});

test('only support fields are required and canonical decision order preserves lazy branches', async () => {
  const minimal = d.source('minimal', d.any([x, d.all([x, y])]));
  assert.deepEqual(minimal.support, ['x']);
  const r = await createRuntime(build(minimal, 'export fn main = () -> minimal {x:true};'));
  assert.equal(r.call('main', [{}]), true);
  for (const mode of modes) {
    const r = await createRuntime(build(generated, `export fn main = () ->
      accept {x:false,y:require false true,z:require false false};`, mode));
    assert.equal(r.call('main', [{}]), false);
    const unused = await createRuntime(build(generated, `export fn main = () ->
      {valid:accept {x:require false true,y:true,z:true},value:7}.value;`, mode));
    assert.equal(unused.call('main', [{}]), 7);
  }
});

test('raw Wasm aggregates fact loops and recovers after exhaustion in all lowering modes', () => {
  const source = `export fn main = (a:Num) -> (b:Num) ->
    accept {x:sum (range a)>=0,y:sum (range b)>=0,z:false};`;
  for (const mode of modes) for (const maxLoopIterations of [6, 7]) {
    const c = build(generated, source, { ...mode, maxLoopIterations });
    const raw = new WebAssembly.Instance(new WebAssembly.Module(c.bytes)).exports.main;
    if (maxLoopIterations === 6) assert.throws(() => raw(3, 4), WebAssembly.RuntimeError);
    else assert.equal(raw(3, 4), 1);
    assert.equal(raw(1, 1), 1);
  }
});

test('identifying abstract requirements shares one concrete predicate even without memoization', async () => {
  const t = createEvidenceAlgebra(['a', 'b']), concrete = createEvidenceAlgebra(['p']);
  const template = t.all([t.atom('a'), t.atom('b')]), p = concrete.atom('p');
  const contracted = concrete.substitute(template, [{ atom: 'a', value: p }, { atom: 'b', value: p }]);
  assert.equal(contracted, p);
  const src = concrete.source('once', contracted);
  const c = build(src, 'export fn main = (n:Num) -> once {p:sum (range n)>=0};', { memoizeReductions: false, maxLoopIterations: 3 });
  assert.equal((await createRuntime(c)).call('main', [3]), true);
});

test('wrong types, missing facts, name errors, duplicate definitions and host effects still fail normally', () => {
  for (const [source, code] of [
    ['export fn main = () -> accept {x:1,y:true,z:true};', 'E_TYPE'],
    ['export fn main = () -> accept {x:true,y:true};', 'E_TYPE'],
    ['fn accept = x -> x; export fn main = () -> 1;', 'E_NAME'],
    ['host fn audit:Num -> Bool; export fn main = (n:Num) -> accept {x:audit n,y:true,z:true};', 'E_EFFECT'],
  ]) assert.throws(() => build(generated, source), e => e.code === code, source);
  const source = '// location\nexport fn main = () -> accept {x:unknown,y:true,z:true};';
  const checked = checkSources(files(generated, source));
  assert.equal(checked.diagnostics[0].code, 'E_NAME'); assert.equal(checked.diagnostics[0].sourceName, 'app.ass');
  assert.equal(checked.diagnostics[0].range.start.offset, source.indexOf('unknown'));
});

test('compiler sessions isolate binaries and validated field names cannot capture generated locals', async () => {
  const session = createCompiler(), sources = files(generated, `export fn main = (facts:${shape}) -> accept facts;`);
  const first = session.compileSources(sources); first.bytes.fill(0);
  const cached = session.compileSources(sources); assert(cached.cache.hit);
  assert.equal((await createRuntime(cached)).call('main', [{ x: true, y: true, z: false }]), true);
  const names = ['facts', 'a0', 'n0', 'value']; const a = createEvidenceAlgebra(names), h = a.all(names.map(n => a.atom(n)));
  const r = await createRuntime(build(a.source('facts', h), 'export fn main = () -> facts {facts:true,a0:true,n0:true,value:true};'));
  assert.equal(r.call('main', [{}]), true);
});

test('96-variable product of choices keeps 2^48 supports symbolic and executes after branch factoring', async () => {
  const names = Array.from({ length: 96 }, (_, i) => `a${i}`), a = createEvidenceAlgebra(names);
  const h = a.all(Array.from({ length: 48 }, (_, i) => a.any([a.atom(names[i * 2]), a.atom(names[i * 2 + 1])])));
  assert.equal(a.inspect(h).decisionNodes, 96); assert.equal(a.minimum(h).cost, 48);
  const src = a.source('large', h), shape = `{${names.map(n => `${n}:Bool`).join(',')}}`;
  const c = build(src, `export fn main = (facts:${shape}) -> large facts;`, { maxLoopIterations: 0 });
  const r = await createRuntime(c), facts = Object.fromEntries(names.map((n, i) => [n, i % 2 === 0]));
  assert.equal(r.call('main', [facts]), true); facts.a0 = false; assert.equal(r.call('main', [facts]), false);
  assert(verifyCertificate(c.certificate.steps));
});

test('variable order can enlarge BDDs and source limits are enforced rather than truncated', () => {
  const a = createEvidenceAlgebra([...Array.from({ length: 10 }, (_, i) => `a${i}`), ...Array.from({ length: 10 }, (_, i) => `b${i}`)], { maxNodes: 65536 });
  const h = a.all(Array.from({ length: 10 }, (_, i) => a.any([a.atom(`a${i}`), a.atom(`b${i}`)])));
  assert(a.inspect(h).decisionNodes > 512);
  assert.throws(() => a.source('oversized', h), /source limit/);
  assert.equal(a.minimum(h).cost, 10);
  const big = createEvidenceAlgebra(Array.from({ length: 128 }, (_, i) => `n${i}`), { maxNodes: 65536 });
  const all = big.all(big.atoms.map(n => big.atom(n)));
  assert.equal(big.minimum(all, big.atoms.map(atom => ({ atom, cost: 1e9 }))).cost, 128e9);
});
