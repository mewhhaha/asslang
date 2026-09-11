import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceAlgebra, compile, compileSources, checkSources, createCompiler, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';
const d = createEvidenceAlgebra(['a', 'b', 'c']);
const [a, b, c] = d.atoms.map(n => d.atom(n));
const targets = [{ name: 'first', value: d.all([a, b]) }, { name: 'second', value: d.all([a, c]) }];
const retained = [{ atom: 'left', value: b }, { atom: 'right', value: c }];
const candidates = [{ atom: 'shared', value: a, cost: 3 }, { atom: 'first', value: targets[0].value, cost: 2 }, { atom: 'second', value: targets[1].value, cost: 2 }];
const options = { retained, candidates }, plan = d.refine(targets, options);
const bindings = [...retained, ...plan.selected.map(i => candidates[i])];
const publicView = createEvidenceAlgebra(bindings.map(v => v.atom));
const inferred = targets.map(t => publicView.abstract(t.value, bindings));
const generated = publicView.source('accept', publicView.all(inferred.map(t => t.sufficient)));
const modes = [false, true].flatMap(simd => [false, true].flatMap(reductionFusion =>
  [false, true].map(memoizeReductions => ({ simd, reductionFusion, memoizeReductions }))));
const files = (g, source) => [g, { name: 'app.ass', source }];
const build = (g, source, opts) => compileSources(files(g, source), opts);

test('joint refinement beats the union of individually cheapest interfaces', () => {
  assert.equal(plan.minimumCost, 3); assert.equal(plan.additionalCount, 1); assert.deepEqual(plan.selected, [0]);
  const separate = new Set(targets.flatMap(t => d.refine([t], options).selected));
  assert.equal([...separate].reduce((sum, i) => sum + candidates[i].cost, 0), 4);
  assert.deepEqual(plan.separations.map(w => w.separates), [[0, 1], [0, 2]]);
  assert.equal(plan.oracleCalls, 5);
  assert(inferred.every(i => i.exact));
  assert(d.verifyRefinement(targets, options, plan));
});

test('forged witnesses, missing cost lower bounds and suboptimal exact interfaces are rejected', () => {
  const mutations = [
    p => p.schemaVersion = 2, p => p.minimumCost = 4, p => p.additionalCount = 2,
    p => p.selected = [1], p => p.selected = [0, 0], p => p.selected = [-1], p => p.selected = [99],
    p => p.selected = [1, 0], p => p.separations.pop(),
    p => p.separations[0].target = 'missing', p => p.separations[0].satisfying = ['b'],
    p => p.separations[0].failing = ['a', 'b'], p => p.separations[0].satisfying.push('unknown'),
    p => p.separations[0].satisfying = ['a', 'a'], p => p.separations[0].separates = [0],
    p => p.separations[0].separates = [0, 1, 2], p => p.separations[0].separates = [1, 0],
    p => p.separations[0].separates = [0, 0], p => p.separations[0].separates = new Array(1),
    p => { p.selected = [1, 2]; p.minimumCost = 4; p.additionalCount = 2; },
    p => { p.complete = false; p.selected = []; p.minimumCost = null; p.additionalCount = null; },
  ];
  for (const mutate of mutations) { const fake = structuredClone(plan); mutate(fake); assert.equal(d.verifyRefinement(targets, options, fake), false); }
  for (const fake of [null, {}, [], { ...plan, separations: new Array(1) }, { ...plan, separations: [null] },
    { ...plan, separations: Array(1025).fill(plan.separations[0]) }, { ...plan, selected: new Array(1) }])
    assert.equal(d.verifyRefinement(targets, options, fake), false);
  const diagnostic = structuredClone(plan); diagnostic.oracleCalls = 999;
  assert(d.verifyRefinement(targets, options, diagnostic)); // Diagnostic count is not part of the proof.
});

test('verification accepts an alternative optimum and rejects redundant zero-cost additions', () => {
  const simple = [{ name: 'target', value: a }];
  const opts = { candidates: [{ atom: 'one', value: a, cost: 0 }, { atom: 'two', value: a, cost: 0 }] };
  const p = d.refine(simple, opts);
  assert.equal(p.minimumCost, 0); assert.equal(p.additionalCount, 1);
  const other = structuredClone(p); other.selected = [1 - p.selected[0]];
  assert(d.verifyRefinement(simple, opts, other));
  other.selected = [0, 1]; other.additionalCount = 2;
  assert(!d.verifyRefinement(simple, opts, other));
});

test('certificate checking uses current prices, meanings and targets', () => {
  const cheaper = { retained, candidates: candidates.map((v, i) => ({ ...v, cost: i ? 1 : 3 })) };
  assert(!d.verifyRefinement(targets, cheaper, plan));
  const p = d.refine(targets, cheaper);
  assert.equal(p.minimumCost, 2); assert.deepEqual(p.selected, [1, 2]);
  assert(!d.verifyRefinement(targets, { retained, candidates: [{ ...candidates[0], value: b }, ...candidates.slice(1)] }, plan));
  assert(!d.verifyRefinement([{ name: 'changed', value: a }, targets[1]], options, plan));
});

test('an impossible repair has a witnessed empty clause, never a claimed price', () => {
  const opts = { retained, candidates: [{ atom: 'wrong', value: b, cost: 0 }] };
  const p = d.refine(targets, opts);
  assert.equal(p.complete, false); assert.equal(p.minimumCost, null); assert.equal(p.additionalCount, null);
  assert.deepEqual(p.selected, []); assert(p.separations.some(w => w.separates.length === 0));
  assert(d.verifyRefinement(targets, opts, p));
  const changed = { ...p, separations: [] }; assert(!d.verifyRefinement(targets, opts, changed));
});

test('empty targets, constants, empty vocabularies and already exact interfaces cost zero', () => {
  const empty = createEvidenceAlgebra([]);
  const p = empty.refine([{ name: 'yes', value: empty.always }, { name: 'no', value: empty.never }], { candidates: [] });
  assert(p.complete); assert.equal(p.minimumCost, 0); assert.deepEqual(p.selected, []);
  assert(empty.verifyRefinement([{ name: 'yes', value: empty.always }, { name: 'no', value: empty.never }], { candidates: [] }, p));
  assert(d.refine([], options).complete);
  const known = d.refine(targets, { retained: [...retained, { atom: 'already', value: a }], candidates: [] });
  assert.equal(known.minimumCost, 0); assert.equal(known.additionalCount, 0);
});

test('goals and summary handles must be authentic and private-owned', () => {
  const foreign = createEvidenceAlgebra(['a']).atom('a');
  for (const value of [foreign, {}, { ...a }, 1, null]) {
    assert.throws(() => d.refine([{ name: 'goal', value }], { candidates: [] }), TypeError);
    assert.throws(() => d.refine(targets, { candidates: [{ atom: 'new', value }] }), TypeError);
    assert.throws(() => d.verifyRefinement(targets, { retained: [{ atom: 'new', value }], candidates: [] }, plan), TypeError);
  }
});

test('malformed inputs, naming collisions, costs and request limits are rejected', () => {
  for (const goals of [null, {}, new Array(1), [null], [targets[0], targets[0]]]) assert.throws(() => d.refine(goals, options));
  for (const opts of [undefined, null, [], {}, { candidates: null }, { candidates: new Array(1) },
    { retained: null, candidates: [] }, { retained: new Array(1), candidates: [] }, { candidates: [null] },
    { candidates: [{ atom: 'left', value: a }], retained }, { candidates: [candidates[0], candidates[0]] },
    ...[-1, 0.5, NaN, Infinity, 1e9 + 1, '1', null].map(cost => ({ candidates: [{ atom: 'n', value: a, cost }] }))])
    assert.throws(() => d.refine(targets, opts));
  for (const name of ['', 'do', 'perform', 'a.b', 'x; export fn injected', 'x'.repeat(65), null]) {
    assert.throws(() => d.refine([{ name, value: a }], { candidates: [] }), TypeError);
    assert.throws(() => d.refine(targets, { candidates: [{ atom: name, value: a }] }), TypeError);
  }
  assert.throws(() => d.refine(Array(9).fill(targets[0]), options), RangeError);
  assert.throws(() => d.refine(targets, { candidates: Array(65).fill(candidates[0]) }), RangeError);
  assert.throws(() => d.refine(targets, { retained: Array.from({ length: 128 }, (_, i) => ({ atom: `r${i}`, value: a })), candidates }), RangeError);
  for (const maxRounds of [0, 1025, 0.5, null]) assert.throws(() => d.refine(targets, { ...options, maxRounds }), RangeError);
  for (const maxVerificationWork of [0, 2000001, 0.5, null]) assert.throws(() => d.refine(targets, { ...options, maxVerificationWork }), RangeError);
});

test('round and independent verification budget failures never return approximate optima', () => {
  const before = d.stats.nodes;
  assert.throws(() => d.refine(targets, { ...options, maxRounds: 1 }), /round limit/);
  assert.throws(() => d.refine(targets, { ...options, maxVerificationWork: 1 }), /verification work/);
  assert.throws(() => d.verifyRefinement(targets, { ...options, maxVerificationWork: 1 }, plan), /verification work/);
  assert.equal(d.stats.nodes, before); assert(d.evaluate(a, ['a']));
  assert.deepEqual(d.refine(targets, options).selected, [0]);
});

test('temporary BDD resource failures do not mutate the private session', () => {
  const tiny = createEvidenceAlgebra(['a'], { maxNodes: 4 }), atom = tiny.atom('a');
  const before = tiny.stats.nodes;
  assert.throws(() => tiny.refine([{ name: 'goal', value: atom }], { candidates: [{ atom: 'one', value: atom }, { atom: 'two', value: atom }] }), /node limit/);
  assert.equal(tiny.stats.nodes, before); assert.equal(tiny.atom('a'), atom);
  const work = createEvidenceAlgebra(['a'], { maxWork: 1 }), wa = work.atom('a');
  assert.throws(() => work.refine([{ name: 'goal', value: wa }], { candidates: [{ atom: 'new', value: wa }] }), /work limit/);
  assert(work.evaluate(wa, ['a']));
});

test('snapshots are immutable and input record fields are captured once', () => {
  let reads = {};
  function once(record, prefix) {
    const result = {};
    for (const [key, value] of Object.entries(record)) Object.defineProperty(result, key, { get() {
      const name = `${prefix}.${key}`; reads[name] = (reads[name] ?? 0) + 1;
      return reads[name] === 1 ? value : null;
    } });
    return result;
  }
  const inputs = [{ name: 'goal', value: a }], opts = { candidates: [{ atom: 'new', value: a, cost: 7 }] };
  const p = d.refine([once(inputs[0], 'g')], once({ candidates: [once(opts.candidates[0], 'c')] }, 'o'));
  assert(Object.values(reads).every(n => n === 1)); assert.equal(p.minimumCost, 7);
  const original = d.refine(inputs, opts); inputs[0].name = 'changed'; opts.candidates[0].cost = 9;
  assert.equal(original.minimumCost, 7); assert(!Object.isFrozen(opts));
  for (const mutate of [() => original.selected.push(3), () => original.separations[0].satisfying.push('b'),
    () => original.separations[0].separates.push(2), () => original.minimumCost = 99]) assert.throws(mutate, TypeError);
});

for (const mode of modes) test(`selected interface guards current data without changing Wasm lowering ${JSON.stringify(mode)}`, async () => {
  const source = `export fn main = (a:Num) -> (b:Num) -> (c:Num) ->
    require (accept {shared:a>=0,left:b>=0,right:c>=0}) {first:b,second:c,sum:b+c};`;
  const opts = { ...mode, maxLoopIterations: 0 };
  const compiled = build(generated, source, opts);
  const hand = compile(`export fn main = (a:Num) -> (b:Num) -> (c:Num) ->
    require (b>=0 && (c>=0 && a>=0)) {first:b,second:c,sum:b+c};`, opts);
  assert.deepEqual(compiled.bytes, hand.bytes); assert(verifyCertificate(compiled.certificate.steps));
  const r = await createRuntime(compiled);
  assert.deepEqual(r.call('main', [1, 3, 4]), { first: 3, second: 4, sum: 7 });
  for (const args of [[-1, 3, 4], [1, -3, 4], [1, 3, -4]]) assert.throws(() => r.call('main', args), WebAssembly.RuntimeError);
  assert.deepEqual(r.call('main', [0, 3, 4]), { first: 3, second: 4, sum: 7 });
  assert.equal(compiled.stats.kernelHeapAllocationSites, 0);
});

test('projected results cannot bypass sibling requirements and unused checks stay lazy', async () => {
  for (const mode of modes) {
    const r = await createRuntime(build(generated, `export fn projected = (right:Bool) ->
      (require (accept {left:true,right,shared:true}) {first:7,second:9}).first;
      export fn lazy = () -> {valid:accept {left:require false true,right:true,shared:true},value:7}.value;`, mode));
    assert.equal(r.call('projected', [true]), 7); assert.throws(() => r.call('projected', [false]), WebAssembly.RuntimeError);
    assert.equal(r.call('lazy', [{}]), 7);
  }
});

test('generated public flags are not authenticated private evidence', async () => {
  const r = await createRuntime(build(generated, 'export fn main = (view:{left:Bool,right:Bool,shared:Bool}) -> accept view;'));
  assert(r.call('main', [{ left: true, right: true, shared: true }]));
  assert(!r.call('main', [{ left: true, right: true, shared: false }]));
  // Passing three true flags says nothing about the inputs that allegedly produced them.
  // The real example computes each meaning on the current numeric inputs.
});

test('fact loops retain one exact raw invocation allowance across all lowering modes', () => {
  const source = 'export fn main = (a:Num) -> (b:Num) -> accept {left:sum (range a)>=0,right:sum (range b)>=0,shared:true};';
  for (const mode of modes) for (const maxLoopIterations of [6, 7]) {
    const compiled = build(generated, source, { ...mode, maxLoopIterations });
    const main = new WebAssembly.Instance(new WebAssembly.Module(compiled.bytes)).exports.main;
    if (maxLoopIterations === 6) assert.throws(() => main(3, 4), WebAssembly.RuntimeError);
    else assert.equal(main(3, 4), 1);
    assert.equal(main(1, 1), 1);
  }
});

test('normal typing, source locations, effects, ABI and cache isolation still apply', async () => {
  for (const [source, code] of [
    ['export fn main = () -> accept {left:1,right:true,shared:true};', 'E_TYPE'],
    ['export fn main = () -> accept {left:true,right:true};', 'E_TYPE'],
    ['export fn main = () -> accept;', 'E_ABI'],
    ['host fn audit:Num -> Bool; export fn main = (n:Num) -> accept {left:audit n,right:true,shared:true};', 'E_EFFECT'],
  ]) assert.throws(() => build(generated, source), e => e.code === code);
  const source = '// local\nexport fn main = () -> accept {left:missing,right:true,shared:true};';
  const result = checkSources(files(generated, source));
  assert.equal(result.diagnostics[0].code, 'E_NAME'); assert.equal(result.diagnostics[0].sourceName, 'app.ass');
  assert.equal(result.diagnostics[0].range.start.offset, source.indexOf('missing'));
  const session = createCompiler(), sources = files(generated, 'export fn main = () -> accept {left:true,right:true,shared:true};');
  session.compileSources(sources).bytes.fill(0);
  const cached = session.compileSources(sources); assert(cached.cache.hit);
  assert((await createRuntime(cached)).call('main', [{}]));
});

test('causal access, event provenance and stream iteration budgets are preserved', async () => {
  const condition = 'accept {left:true,right:true,shared:valid}';
  const source = `export fn main = (xs:[Num]) -> (valid:Bool) -> require (${condition}) (sum (scan xs 0 (s -> x -> s+x)));`;
  const r = await createRuntime(build(generated, source, { maxLoopIterations: 3 }));
  assert.equal(r.call('main', [[1, 2, 3], true]), 10);
  assert.throws(() => r.call('main', [[1, 2, 3, 4], true]), WebAssembly.RuntimeError);
  assert.throws(() => build(generated, `export fn main = (xs:[Num]) -> (valid:Bool) -> require (${condition}) (at (scan xs 0 (s -> x -> s+x)) 0);`), e => e.code === 'E_CAUSAL_ACCESS');
  assert.throws(() => build(generated, `export fn main = (xs:[Num]) -> (ys:[Num]) -> (valid:Bool) -> require (${condition}) (zip xs ys (x -> y -> x+y));`), e => e.code === 'E_DOMAIN');
});

test('48 summaries over 96 private atoms are refined symbolically with a linear witness family', async () => {
  const d = createEvidenceAlgebra(Array.from({ length: 96 }, (_, i) => `a${i}`));
  const pairs = Array.from({ length: 48 }, (_, i) => d.all([d.atom(`a${2*i}`), d.atom(`a${2*i+1}`)]));
  const f = d.any(pairs), targets = [{ name: 'ready', value: f }];
  const candidates = pairs.map((value, i) => ({ atom: `p${i}`, value, cost: 1 }));
  const before = d.stats.nodes, p = d.refine(targets, { candidates });
  assert(p.complete); assert.equal(p.minimumCost, 48); assert.equal(p.selected.length, 48);
  assert.equal(p.separations.length, 48); assert(p.separations.every(w => w.separates.length === 1));
  assert.equal(p.oracleCalls, 49); assert.equal(d.stats.nodes, before);
  const e = createEvidenceAlgebra(candidates.map(c => c.atom)), exact = e.abstract(f, candidates);
  assert(exact.exact); assert.equal(e.inspect(exact.sufficient).decisionNodes, 48);
  const shape = `{${e.atoms.map(n => `${n}:Bool`).join(',')}}`;
  const r = await createRuntime(build(e.source('large', exact.sufficient), `export fn main = (v:${shape}) -> large v;`, { maxLoopIterations: 0 }));
  const flags = Object.fromEntries(e.atoms.map(n => [n, false])); assert(!r.call('main', [flags]));
  flags.p47 = true; assert(r.call('main', [flags]));
});

test('the highest candidate bit, large exact prices and maximum retained vocabulary work', () => {
  const options = { candidates: Array.from({ length: 64 }, (_, i) => ({ atom: `v${i}`, value: a, cost: i === 63 ? 1 : 1000000000 })) };
  const p = d.refine([{ name: 'goal', value: a }], options);
  assert.deepEqual(p.selected, [63]); assert(d.verifyRefinement([{ name: 'goal', value: a }], options, p));
  const many = createEvidenceAlgebra(Array.from({ length: 24 }, (_, i) => `a${i}`));
  const atoms = many.atoms.map(n => many.atom(n)), all = many.any(atoms);
  const candidates = atoms.map((value, i) => ({ atom: `p${i}`, value, cost: 1000000000 }));
  const expensive = many.refine([{ name: 'goal', value: all }], { candidates });
  assert.equal(expensive.minimumCost, 24e9);
  const retained = Array.from({ length: 128 }, (_, i) => ({ atom: `r${i}`, value: a }));
  const known = d.refine([{ name: 'goal', value: a }], { retained, candidates: [] });
  assert(known.complete); assert.equal(known.minimumCost, 0);
});
