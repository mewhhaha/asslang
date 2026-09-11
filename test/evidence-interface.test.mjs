import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceAlgebra, compile, compileSources, checkSources, createCompiler, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';
const modes = [false, true].flatMap(simd => [false, true].flatMap(reductionFusion =>
  [false, true].map(memoizeReductions => ({ simd, reductionFusion, memoizeReductions }))));
const hidden = createEvidenceAlgebra(['leftValid', 'rightValid', 'reviewed']);
const [left, right, review] = hidden.atoms.map(n => hidden.atom(n)), target = hidden.all([left, right]);
const publicView = createEvidenceAlgebra(['someValid', 'reviewedPair']);
const meanings = [{ atom: 'someValid', value: hidden.any([left, right]) }, { atom: 'reviewedPair', value: hidden.all([target, review]) }];
const result = publicView.abstract(target, meanings);
const pull = (d, f, mapping = meanings) => hidden.substitute(f, mapping.filter(b => d.inspect(f).support.includes(b.atom)));
const source = hidden.source('accept', pull(publicView, result.sufficient));
const files = (g, source) => [g, { name: 'app.ass', source }];
const build = (g, source, options) => compileSources(files(g, source), options);

test('coarse interface returns a genuine necessity/sufficiency gap and exact refinement repairs it', () => {
  assert.equal(result.necessary, publicView.atom('someValid'));
  assert.equal(result.sufficient, publicView.atom('reviewedPair'));
  assert.equal(result.exact, false);
  assert(hidden.entails(pull(publicView, result.sufficient), target));
  assert(hidden.entails(target, pull(publicView, result.necessary)));
  assert(!hidden.entails(pull(publicView, result.necessary), target));
  const refined = createEvidenceAlgebra(['someValid', 'reviewedPair', 'pairValid']);
  const bindings = [...meanings, { atom: 'pairValid', value: target }];
  const improved = refined.abstract(target, bindings);
  assert(improved.exact); assert.equal(improved.obstruction, null);
  assert.equal(pull(refined, improved.necessary, bindings), target);
  assert.equal(pull(refined, improved.sufficient, bindings), target);
  assert.notEqual(improved.necessary, improved.sufficient); // Unreachable public valuations differ.
});

test('empty vocabularies, unused private atoms, constants and self-session mappings are explicit', () => {
  const empty = createEvidenceAlgebra([]), p = createEvidenceAlgebra(['public']);
  assert(empty.abstract(empty.always, []).exact);
  assert(empty.abstract(empty.never, []).exact);
  const lost = empty.abstract(left, []);
  assert.equal(lost.necessary, empty.always); assert.equal(lost.sufficient, empty.never); assert(!lost.exact);
  const constTrue = p.abstract(empty.always, [{ atom: 'public', value: empty.always }]);
  assert(constTrue.exact); assert.equal(constTrue.necessary, p.atom('public'));
  const local = createEvidenceAlgebra(['x', 'y']), x = local.atom('x'), y = local.atom('y');
  const f = local.all([x, y]);
  const swapped = local.abstract(f, [{ atom: 'x', value: y }, { atom: 'y', value: x }]);
  assert.equal(swapped.necessary, f); assert.equal(swapped.sufficient, f); assert(swapped.exact);
});

test('bindings belong to the private session, are complete and cannot forge contract handles', () => {
  const other = createEvidenceAlgebra(['leftValid']), foreign = other.atom('leftValid');
  for (const target of [null, {}, { ...left }, 1, [], undefined])
    assert.throws(() => publicView.abstract(target, meanings), TypeError);
  for (const bindings of [null, {}, [], new Array(2), [null], [meanings[0]],
    [meanings[0], meanings[0]], [...meanings, meanings[0]],
    [{ atom: 'unknown', value: left }, meanings[1]],
    [{ atom: 'someValid', value: foreign }, meanings[1]],
    [{ atom: 'someValid', value: {} }, meanings[1]],
    [{ atom: 'someValid', value: publicView.atom('someValid') }, meanings[1]]])
    assert.throws(() => publicView.abstract(target, bindings));
  const identicalNames = createEvidenceAlgebra(['leftValid']);
  assert(identicalNames.abstract(left, [{ atom: 'leftValid', value: left }]).exact);
});

test('results are immutable, snapshots are independent, and each binding property is captured once', () => {
  const mapping = [...meanings.map(b => ({ ...b }))];
  const p = publicView.abstract(target, mapping);
  mapping[0].atom = 'changed'; mapping[0].value = hidden.never;
  assert.equal(p.necessary, publicView.atom('someValid'));
  assert(!Object.isFrozen(mapping));
  for (const mutate of [() => p.exact = true, () => p.obstruction.satisfying.push('other'),
    () => p.obstruction.failingView.push('other'), () => p.sufficient.kind = 'fake'])
    assert.throws(mutate, TypeError);
  let atomReads = 0, valueReads = 0;
  const e = createEvidenceAlgebra(['shown']);
  const binding = { get atom() { atomReads++; return atomReads === 1 ? 'shown' : 'bad'; },
    get value() { valueReads++; return valueReads === 1 ? left : {}; } };
  assert(e.abstract(left, [binding]).exact);
  assert.equal(atomReads, 1); assert.equal(valueReads, 1);
});

test('public work/node failures roll back and never consume private-session capacity', () => {
  for (const maxWork of [1, 20, 50, 100]) {
    const p = createEvidenceAlgebra(publicView.atoms, { maxWork });
    const existing = p.atom('someValid'), before = p.stats.nodes, privateBefore = hidden.stats.nodes;
    assert.throws(() => p.abstract(target, meanings), /work limit/);
    assert.equal(p.stats.nodes, before); assert.equal(hidden.stats.nodes, privateBefore);
    assert(p.evaluate(existing, ['someValid']));
    assert.equal(p.all([existing]), existing);
  }
  const tiny = createEvidenceAlgebra(publicView.atoms, { maxNodes: 5 });
  const existing = tiny.atom('someValid'), before = tiny.stats.nodes;
  assert.throws(() => tiny.abstract(target, meanings), /workspace node limit/);
  assert.equal(tiny.stats.nodes, before); assert.equal(tiny.atom('someValid'), existing);
  const full = createEvidenceAlgebra(['p'], { maxNodes: 4 });
  const atom = full.atom('p');
  assert.equal(full.abstract(left, [{ atom: 'p', value: left }]).necessary, atom);
  const exhausted = createEvidenceAlgebra(['a', 'b', 'c'], { maxNodes: 8 });
  const [a, b, c] = exhausted.atoms.map(n => exhausted.atom(n));
  exhausted.all([a, b]); exhausted.any([a, b]); exhausted.any([b, c]);
  assert.equal(exhausted.stats.nodes, 8);
  assert.throws(() => exhausted.abstract(left, exhausted.atoms.map(atom => ({ atom, value: left }))),
    error => error.message === 'Evidence node limit exceeded');
  assert.equal(exhausted.stats.nodes, 8); assert.equal(exhausted.atom('a'), a);

});

for (const mode of modes) test(`computed public contracts guard current private data ${JSON.stringify(mode)}`, async () => {
  const app = `export fn acceptPair = (a:Num) -> (b:Num) -> (reviewed:Bool) ->
    require (accept {leftValid:a>=0,rightValid:b>=0,reviewed}) {sum:a+b,first:a};`;
  const c = build(source, app, { ...mode, maxLoopIterations: 0 }), r = await createRuntime(c);
  assert(verifyCertificate(c.certificate.steps));
  assert.deepEqual(r.call('acceptPair', [3, 4, true]), { sum: 7, first: 3 });
  assert.throws(() => r.call('acceptPair', [-3, 4, true]), WebAssembly.RuntimeError);
  assert.throws(() => r.call('acceptPair', [3, 4, false]), WebAssembly.RuntimeError);
  assert.deepEqual(r.call('acceptPair', [1, 2, true]), { sum: 3, first: 1 });
  const direct = `export fn acceptPair = (a:Num) -> (b:Num) -> (reviewed:Bool) ->
    require (a>=0 && (b>=0 && reviewed)) {sum:a+b,first:a};`;
  assert.deepEqual(c.bytes, compile(direct, { ...mode, maxLoopIterations: 0 }).bytes);
});

test('necessary-only admission really is unsafe; more informative interfaces avoid conservative refusal', async () => {
  const necessary = hidden.source('necessary', pull(publicView, result.necessary));
  const exactSource = hidden.source('exact', target);
  const app = `export fn wrong = (a:Num) -> (b:Num) ->
      require (necessary {leftValid:a>=0,rightValid:b>=0}) (a+b);
    export fn precise = (a:Num) -> (b:Num) ->
      require (exact {leftValid:a>=0,rightValid:b>=0}) (a+b);`;
  const r = await createRuntime(compileSources([necessary, exactSource, { name: 'app.ass', source: app }]));
  assert.equal(r.call('wrong', [-3, 4]), 1); // Deliberate counterexample to using a necessary condition as proof.
  assert.throws(() => r.call('precise', [-3, 4]), WebAssembly.RuntimeError);
  assert.equal(r.call('precise', [3, 4]), 7);
});

test('public predicates require only abstract fields but those fields must be authentic current summaries', async () => {
  const generated = publicView.source('publicGate', result.sufficient);
  assert.deepEqual(generated.support, ['reviewedPair']);
  const r = await createRuntime(build(generated, 'export fn main = (summary:Bool) -> publicGate {reviewedPair:summary};'));
  assert.equal(r.call('main', [true]), true);
  assert.equal(r.call('main', [false]), false);
  // A predicate over flags is not a capability or proof that a hidden value was validated.
  assert.equal(publicView.evaluate(result.sufficient, ['reviewedPair']), true);
});

test('fact loops use the same raw invocation budget and recover after exhaustion', () => {
  const app = `export fn main = (a:Num) -> (b:Num) ->
    accept {leftValid:sum (range a)>=0,rightValid:sum (range b)>=0,reviewed:true};`;
  for (const mode of modes) for (const maxLoopIterations of [6, 7]) {
    const c = build(source, app, { ...mode, maxLoopIterations });
    const raw = new WebAssembly.Instance(new WebAssembly.Module(c.bytes)).exports.main;
    if (maxLoopIterations === 6) assert.throws(() => raw(3, 4), WebAssembly.RuntimeError);
    else assert.equal(raw(3, 4), 1);
    assert.equal(raw(1, 1), 1);
  }
});

test('unused guards stay lazy and projecting results cannot bypass required facts', async () => {
  for (const mode of modes) {
    const c = build(source, `export fn skip = () ->
      {valid:accept {leftValid:require false true,rightValid:true,reviewed:true},value:7}.value;
      export fn guard = (reviewed:Bool) ->
      (require (accept {leftValid:true,rightValid:true,reviewed}) {value:7,other:9}).value;`, mode);
    const r = await createRuntime(c);
    assert.equal(r.call('skip', [{}]), 7); assert.equal(r.call('guard', [true]), 7);
    assert.throws(() => r.call('guard', [false]), WebAssembly.RuntimeError);
  }
});

test('source-local errors, fact types, effects and compiler cache isolation remain ordinary', async () => {
  for (const [app, code] of [
    ['export fn main = () -> accept {leftValid:1,rightValid:true,reviewed:true};', 'E_TYPE'],
    ['export fn main = () -> accept {leftValid:true,rightValid:true};', 'E_TYPE'],
    ['host fn audit:Num -> Bool; export fn main = (n:Num) -> accept {leftValid:audit n,rightValid:true,reviewed:true};', 'E_EFFECT'],
    ['export fn main = () -> accept;', 'E_ABI'],
  ]) assert.throws(() => build(source, app), e => e.code === code, app);
  const app = '// local\nexport fn main = () -> accept {leftValid:missing,rightValid:true,reviewed:true};';
  const checked = checkSources(files(source, app));
  assert.equal(checked.diagnostics[0].code, 'E_NAME'); assert.equal(checked.diagnostics[0].sourceName, 'app.ass');
  assert.equal(checked.diagnostics[0].range.start.offset, app.indexOf('missing'));
  const session = createCompiler(), sources = files(source, 'export fn main = (reviewed:Bool) -> accept {leftValid:true,rightValid:true,reviewed};');
  const first = session.compileSources(sources); first.bytes.fill(0);
  const cached = session.compileSources(sources); assert(cached.cache.hit);
  assert.equal((await createRuntime(cached)).call('main', [true]), true);
});

test('generated guards preserve sequential streams and do not align unrelated event domains', async () => {
  const generated = publicView.source('checkReview', result.sufficient);
  const app = `export fn main = (xs:[Num]) -> (reviewed:Bool) ->
    require (checkReview {reviewedPair:reviewed}) (sum (scan xs 0 (s -> x -> s+x)));`;
  const r = await createRuntime(build(generated, app, { maxLoopIterations: 3 }));
  assert.equal(r.call('main', [[1, 2, 3], true]), 10);
  assert.throws(() => r.call('main', [[1, 2, 3], false]), WebAssembly.RuntimeError);
  assert.throws(() => r.call('main', [[1, 2, 3, 4], true]), WebAssembly.RuntimeError);
  assert.throws(() => build(generated, `export fn main = (xs:[Num]) -> (reviewed:Bool) ->
    require (checkReview {reviewedPair:reviewed}) (at (scan xs 0 (s -> x -> s+x)) 0);`), e => e.code === 'E_CAUSAL_ACCESS');
  assert.throws(() => build(generated, `export fn main = (xs:[Num]) -> (ys:[Num]) -> (reviewed:Bool) ->
    require (checkReview {reviewedPair:reviewed}) (zip xs ys (x -> y -> x+y));`), e => e.code === 'E_DOMAIN');
});

test('early elimination keeps 96 private variables symbolic and the inferred 48-atom interface executes', async () => {
  const d = createEvidenceAlgebra(Array.from({ length: 96 }, (_, i) => `x${i}`));
  const pairs = Array.from({ length: 48 }, (_, i) => d.any([d.atom(`x${2*i}`), d.atom(`x${2*i+1}`)]));
  const f = d.all(pairs), e = createEvidenceAlgebra(Array.from({ length: 48 }, (_, i) => `p${i}`));
  const before = d.stats.nodes;
  const p = e.abstract(f, pairs.map((value, i) => ({ atom: `p${i}`, value })));
  assert(p.exact); assert.equal(d.stats.nodes, before);
  assert.equal(e.inspect(p.sufficient).decisionNodes, 48);
  assert.equal(p.necessary, p.sufficient);
  const shape = `{${e.atoms.map(n => `${n}:Bool`).join(',')}}`;
  const r = await createRuntime(build(e.source('large', p.sufficient), `export fn main = (facts:${shape}) -> large facts;`, { maxLoopIterations: 0 }));
  const facts = Object.fromEntries(e.atoms.map(n => [n, true]));
  assert.equal(r.call('main', [facts]), true); facts.p0 = false; assert.equal(r.call('main', [facts]), false);
});

test('128-atom identity transport and reversed atom order remain bounded and exact', () => {
  const d = createEvidenceAlgebra(Array.from({ length: 128 }, (_, i) => `d${i}`), { maxNodes: 65536, maxWork: 2000000 });
  const e = createEvidenceAlgebra(Array.from({ length: 128 }, (_, i) => `e${i}`), { maxNodes: 65536, maxWork: 2000000 });
  const atoms = d.atoms.map(n => d.atom(n)), f = d.all(atoms);
  const p = e.abstract(f, atoms.map((value, i) => ({ atom: `e${127-i}`, value })));
  assert(p.exact); assert.equal(e.inspect(p.necessary).decisionNodes, 128);
  assert.equal(e.minimum(p.sufficient).cost, 128);
});
