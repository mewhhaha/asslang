import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceAlgebra, compile, compileSources, checkSources, createCompiler, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';
const d = createEvidenceAlgebra(['a', 'b']), a = d.atom('a'), b = d.atom('b');
const twins = [{ atom: 'left', value: a }, { atom: 'right', value: a }];
const q = d.present(twins);
const modes = [false, true].flatMap(simd => [false, true].flatMap(reductionFusion =>
  [false, true].map(memoizeReductions => ({ simd, reductionFusion, memoizeReductions }))));
const files = (g, source) => [g, { name: 'app.ass', source }];
const build = (g, source, options) => compileSources(files(g, source), options);

test('inferred laws identify duplicated meanings without changing the old free algebra', () => {
  assert(!d.auditTransport(twins).preservesImplication);
  assert(q.auditTransport().preservesImplication);
  assert.equal(q.atom('left'), q.atom('right'));
  assert.equal(q.residual(q.atom('left'), q.atom('right')), q.always);
  assert(q.isRealizable([])); assert(q.isRealizable(['left', 'right']));
  assert(!q.isRealizable(['left'])); assert(!q.isRealizable(['right']));
  assert.throws(() => q.evaluate(q.always, ['left']), /Unrealizable/);
  const free = createEvidenceAlgebra(['left', 'right']);
  assert.notEqual(free.atom('left'), free.atom('right'));
  assert.equal(free.residual(free.atom('left'), free.atom('right')), free.atom('right'));
});

test('valid state laws cannot remove hidden future blockers, but exposing the hidden fact can', () => {
  const partial = [{ atom: 'x', value: a }, { atom: 'y', value: d.all([a, b]) }];
  const p = d.present(partial), loss = p.auditTransport();
  assert(!loss.preservesImplication); assert.deepEqual(loss.obstruction.current, ['b']);
  assert.deepEqual(loss.obstruction.requested, ['x']);
  assert.deepEqual(loss.obstruction.realizableWitness, ['a']);
  assert(p.isRealizable(['x'])); assert.equal(d.liftEvidence(partial, ['b'], ['x']), null);
  const improved = d.present([...partial, { atom: 'z', value: b }]);
  assert(improved.auditTransport().preservesImplication);
  assert(!d.auditTransport([...partial, { atom: 'z', value: b }]).preservesImplication);
});

test('exact schemas retain higher-order laws that all pairwise implications would miss', () => {
  const p = d.present([{ atom: 'x', value: a }, { atom: 'y', value: b }, { atom: 'both', value: d.all([a, b]) }]);
  assert(p.isRealizable(['x'])); assert(p.isRealizable(['y']));
  assert(!p.isRealizable(['x', 'y'])); // Both implies each is not the whole schema.
  assert(p.isRealizable(['x', 'y', 'both']));
  assert.equal(p.all([p.atom('x'), p.atom('y')]), p.atom('both'));
});

test('empty and constant presentations have honest quotient constants and valid views', () => {
  const p = d.present([{ atom: 'yes', value: d.always }, { atom: 'no', value: d.never }]);
  assert.equal(p.atom('yes'), p.always); assert.equal(p.atom('no'), p.never);
  assert(p.isRealizable(['yes'])); assert(!p.isRealizable([]));
  assert(p.auditTransport().preservesImplication);
  assert.equal(p.minimum(p.always).cost, 1);
  const empty = d.present([]); assert(empty.evaluate(empty.always, [])); assert(empty.auditTransport().preservesImplication);
  assert.deepEqual(empty.view(['a']), []); assert.equal(empty.minimum(empty.never), null);
  assert.equal(empty.all([]), empty.always); assert.equal(empty.any([]), empty.never);
});

test('presented handles are scoped, opaque and incompatible with ordinary algebra handles', () => {
  const other = d.present(twins);
  for (const h of [a, {}, { ...q.always }, null, 1, other.always]) {
    assert.throws(() => q.evaluate(h, []), TypeError);
    assert.throws(() => q.all([h]), TypeError);
    assert.throws(() => q.source('bad', h), TypeError);
  }
  assert.throws(() => d.evaluate(q.always, []), TypeError);
  assert.throws(() => d.present([{ atom: 'x', value: createEvidenceAlgebra(['a']).atom('a') }]), TypeError);
});

test('input validation rejects sparse arrays, forged mappings, invalid names and prices', () => {
  for (const bs of [null, {}, new Array(1), [null], [twins[0], twins[0]], [{ atom: 'do', value: a }], [{ atom: 'x.y', value: a }], [{ atom: 'x', value: {} }]])
    assert.throws(() => d.present(bs));
  for (const fs of [null, {}, ['missing'], ['left', 'left'], new Array(1)]) assert.throws(() => q.isRealizable(fs), TypeError);
  for (const f of [null, [null], new Array(1), [['left', 'left']], [['unknown']]]) assert.throws(() => q.fromFrontier(f));
  for (const name of ['', 'do', 'x.y', 'x; export fn oops', 'x'.repeat(65), null]) assert.throws(() => q.source(name, q.always), TypeError);
  for (const cost of [-1, 0.1, NaN, Infinity, null, '1', 1e9 + 1])
    assert.throws(() => q.minimum(q.always, [{ atom: 'left', cost }]));
  for (const prices of [null, [null], new Array(1), [{ atom: 'bad', cost: 1 }], [{ atom: 'left', cost: 1 }, { atom: 'left', cost: 2 }]])
    assert.throws(() => q.minimum(q.always, prices));
  assert.throws(() => q.all(Array(4097).fill(q.always)), RangeError);
  assert.throws(() => q.fromFrontier(Array(4097).fill([])), RangeError);
  assert.throws(() => d.present(Array.from({ length: 129 }, (_, i) => ({ atom: `p${i}`, value: a }))), RangeError);
});

test('snapshots are detached, frozen, single-read bindings do not mutate the source', () => {
  const bs = twins.map(x => ({ ...x })), before = d.stats.nodes, p = d.present(bs);
  bs[0].atom = 'changed'; bs[1].value = b;
  assert.equal(p.atom('left'), p.atom('right')); assert.equal(d.stats.nodes, before);
  assert.throws(() => p.inspectLaws().nodes[0].low = 99, TypeError);
  assert.throws(() => p.atoms.push('bad'), TypeError);
  assert.throws(() => p.inspect(p.always).support.push('bad'), TypeError);
  let names = 0, values = 0;
  const single = d.present([{ get atom() { return ++names === 1 ? 'x' : 'bad'; }, get value() { values++; return a; } }]);
  assert(single.evaluate(single.atom('x'), ['x'])); assert.equal(names, 1); assert.equal(values, 1);
});

test('node and work exhaustion preserve caller state and existing presentation handles', () => {
  const tiny = createEvidenceAlgebra(['a'], { maxNodes: 4 }), ta = tiny.atom('a'), before = tiny.stats.nodes;
  assert.throws(() => tiny.present([{ atom: 'x', value: ta }, { atom: 'y', value: ta }]), /node limit/);
  assert.equal(tiny.stats.nodes, before); assert(tiny.evaluate(ta, ['a']));
  const limited = createEvidenceAlgebra(['a', 'b'], { maxNodes: 6 });
  const p = limited.present(limited.atoms.map(atom => ({ atom, value: limited.atom(atom) })));
  const x = p.atom('a'), y = p.atom('b'); p.all([x, y]); p.any([x, y]);
  const stats = p.stats;
  assert.throws(() => p.residual(x, y), /node limit/);
  assert.deepEqual(p.stats, stats); assert(p.evaluate(x, ['a']));
  const work = createEvidenceAlgebra(['a'], { maxWork: 1 }), wa = work.atom('a');
  assert.throws(() => work.present([{ atom: 'x', value: wa }]), /work limit/);
  assert.equal(work.atom('a'), wa);
});

for (const mode of modes) test(`law guards remain mandatory for quotient-true predicates ${JSON.stringify(mode)}`, async () => {
  const g = q.source('accept', q.residual(q.atom('left'), q.atom('right')));
  const source = 'export fn main = (left:Bool) -> (right:Bool) -> accept {left,right};';
  const c = build(g, source, { ...mode, maxLoopIterations: 0 });
  assert(verifyCertificate(c.certificate.steps)); assert.equal(c.stats.kernelHeapAllocationSites, 0);
  const r = await createRuntime(c);
  for (const v of [false, true]) assert.equal(r.call('main', [v, v]), true);
  assert.throws(() => r.call('main', [true, false]), WebAssembly.RuntimeError);
  assert.throws(() => r.call('main', [false, true]), WebAssembly.RuntimeError);
  assert(r.call('main', [true, true]));
  const hand = compile('export fn main = (left:Bool) -> (right:Bool) -> require (if left then right else !right) true;', { ...mode, maxLoopIterations: 0 });
  assert.deepEqual(c.bytes, hand.bytes);
});

test('private lowering means composition, not an unproved claim that every residual commutes', async () => {
  const p = d.present([{ atom: 'x', value: a }, { atom: 'y', value: d.all([a, b]) }]);
  const r = p.residual(p.atom('x'), p.atom('y'));
  const runtime = await createRuntime(build(p.sourcePrivate('gate', r), 'export fn main = (a:Bool) -> (b:Bool) -> gate {a,b};'));
  assert.equal(runtime.call('main', [false, true]), false);
  assert(d.evaluate(d.residual(a, d.all([a, b])), ['b']));
  assert(!p.auditTransport().preservesImplication);
});

test('projected results enforce schemas, while unrelated pure computations remain lazy', async () => {
  const g = q.source('gate', q.always);
  for (const mode of modes) {
    const r = await createRuntime(build(g, `export fn projected = (x:Bool) ->
      (require (gate {left:x,right:true}) {value:7,other:9}).value;
      export fn lazy = () -> {ignored:gate {left:require false true,right:false},value:7}.value;`, mode));
    assert.equal(r.call('projected', [true]), 7); assert.throws(() => r.call('projected', [false]), WebAssembly.RuntimeError);
    assert.equal(r.call('lazy', [{}]), 7);
  }
});

test('law checking and private facts retain exact raw invocation budgets', () => {
  const p = d.present([{ atom: 'x', value: a }, { atom: 'y', value: b }]);
  const g = p.source('gate', p.all([p.atom('x'), p.atom('y')]));
  for (const mode of modes) for (const maxLoopIterations of [6, 7]) {
    const c = build(g, 'export fn main = (a:Num) -> (b:Num) -> gate {x:sum (range a)>=0,y:sum (range b)>=0};', { ...mode, maxLoopIterations });
    const raw = new WebAssembly.Instance(new WebAssembly.Module(c.bytes)).exports.main;
    if (maxLoopIterations === 6) assert.throws(() => raw(3, 4), WebAssembly.RuntimeError); else assert.equal(raw(3, 4), 1);
    assert.equal(raw(1, 1), 1);
  }
});

test('typing, source-local diagnostics, capabilities, ABI and caches keep existing boundaries', async () => {
  const g = q.source('gate', q.always);
  for (const [s, code] of [
    ['export fn main = () -> gate {left:1,right:true};', 'E_TYPE'],
    ['export fn main = () -> gate {left:true};', 'E_TYPE'],
    ['export fn main = () -> gate;', 'E_ABI'],
    ['host fn audit:Num -> Bool; export fn main = (n:Num) -> gate {left:audit n,right:true};', 'E_EFFECT'],
  ]) assert.throws(() => build(g, s), e => e.code === code, s);
  const s = '// local\nexport fn main = () -> gate {left:missing,right:true};';
  const result = checkSources(files(g, s));
  assert.equal(result.diagnostics[0].sourceName, 'app.ass'); assert.equal(result.diagnostics[0].range.start.offset, s.indexOf('missing'));
  const session = createCompiler(), sources = files(g, 'export fn main = () -> gate {left:true,right:true};');
  session.compileSources(sources).bytes.fill(0);
  const cached = session.compileSources(sources); assert(cached.cache.hit); assert((await createRuntime(cached)).call('main', [{}]));
});

test('laws do not change causal indexing or align unrelated streams', async () => {
  const g = q.source('gate', q.always), guard = '(gate {left:valid,right:true})';
  const r = await createRuntime(build(g, `export fn main = (xs:[Num]) -> (valid:Bool) -> require ${guard} (sum (scan xs 0 (s -> x -> s+x)));`, { maxLoopIterations: 3 }));
  assert.equal(r.call('main', [[1, 2, 3], true]), 10);
  assert.throws(() => r.call('main', [[1, 2, 3], false]), WebAssembly.RuntimeError);
  assert.throws(() => build(g, `export fn main = (xs:[Num]) -> (valid:Bool) -> require ${guard} (at (scan xs 0 (s -> x -> s+x)) 0);`), e => e.code === 'E_CAUSAL_ACCESS');
  assert.throws(() => build(g, `export fn main = (xs:[Num]) -> (ys:[Num]) -> (valid:Bool) -> require ${guard} (zip xs ys (x -> y -> x+y));`), e => e.code === 'E_DOMAIN');
});

test('64 public duplicate flags remain a symbolic image and their checked source executes', async () => {
  const hidden = createEvidenceAlgebra(Array.from({ length: 64 }, (_, i) => `a${i}`));
  const groups = Array.from({ length: 32 }, (_, i) => hidden.any([hidden.atom(`a${2*i}`), hidden.atom(`a${2*i+1}`)]));
  const before = hidden.stats.nodes;
  const p = hidden.present(groups.flatMap((value, i) => [{ atom: `p${i}`, value }, { atom: `q${i}`, value }]));
  assert.equal(p.inspectLaws().decisionNodes, 96);
  const audit = p.auditTransport(); assert(audit.preservesImplication); assert.equal(audit.symbolicComponents, 32);
  const pairs = p.all(groups.map((_, i) => p.atom(`p${i}`)));
  assert.equal(p.minimum(pairs).cost, 64);
  const shape = `{${p.atoms.map(n => `${n}:Bool`).join(',')}}`;
  const r = await createRuntime(build(p.source('large', pairs), `export fn main = (v:${shape}) -> large v;`, { maxLoopIterations: 0 }));
  const values = Object.fromEntries(p.atoms.map(n => [n, true])); assert(r.call('main', [values]));
  values.q31 = false; assert.throws(() => r.call('main', [values]), WebAssembly.RuntimeError);
  assert.equal(hidden.stats.nodes, before);
});

test('128th private variable and reversed public order retain exact image and transport semantics', () => {
  const hidden = createEvidenceAlgebra(Array.from({ length: 128 }, (_, i) => `a${i}`), { maxNodes: 65536, maxWork: 2000000 });
  const first = hidden.atom('a0'), last = hidden.atom('a127');
  const p = hidden.present([{ atom: 'both', value: hidden.all([first, last]) }, { atom: 'first', value: first }]);
  const witness = p.auditTransport().obstruction;
  assert(witness); assert(witness.current.includes('a127')); assert.deepEqual(witness.requested, ['first']);
  const exact = hidden.present([{ atom: 'last', value: last }, { atom: 'both', value: hidden.all([first, last]) }, { atom: 'first', value: first }]);
  assert(exact.auditTransport().preservesImplication);
});

test('source bounds reject a large correlated schema without changing existing handles', () => {
  const h = createEvidenceAlgebra(Array.from({ length: 10 }, (_, i) => `a${i}`), { maxNodes: 65536, maxWork: 2000000 });
  const xs = h.atoms.map(n => h.atom(n));
  const p = h.present([...xs.map((value, i) => ({ atom: `x${i}`, value })), ...xs.map((value, i) => ({ atom: `y${i}`, value }))]);
  assert(p.inspectLaws().decisionNodes > 512);
  const before = p.stats;
  assert.throws(() => p.source('large', p.always), /source limit/);
  assert.deepEqual(p.stats, before); assert(p.evaluate(p.always, []));
});

test('128 forced public truths have exact prices and constants need no private data', async () => {
  const empty = createEvidenceAlgebra([]), p = empty.present(Array.from({ length: 128 }, (_, i) => ({ atom: `a${i}`, value: empty.always })));
  assert.equal(p.minimum(p.always, p.atoms.map(atom => ({ atom, cost: 1e9 }))).cost, 128e9);
  assert(p.auditTransport().preservesImplication); assert.equal(p.auditTransport().constantSummaries, 128);
  assert(!p.isRealizable([])); assert(p.isRealizable(p.atoms));
  const r = await createRuntime(build(p.sourcePrivate('constant', p.always), 'export fn main = () -> constant {};', { maxLoopIterations: 0 }));
  assert(r.call('main', [{}]));
});

test('canonical source bindings cannot capture user field names and empty image predicates execute', async () => {
  const p = d.present([{ atom: 'facts', value: a }, { atom: 'a0', value: a }, { atom: 'n0', value: b }, { atom: 'v', value: b }]);
  const r = await createRuntime(build(p.source('facts', p.always), 'export fn main = () -> facts {facts:true,a0:true,n0:false,v:false};'));
  assert(r.call('main', [{}]));
  const empty = d.present([]);
  const s = await createRuntime(build(empty.source('nothing', empty.always), 'export fn main = () -> nothing {};'));
  assert(s.call('main', [{}]));
});
