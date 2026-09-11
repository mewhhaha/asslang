import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceAlgebra, compile, compileSources, checkSources, createCompiler, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';
const d = createEvidenceAlgebra(['a', 'b', 'c']), [a, b, c] = d.atoms.map(n => d.atom(n));
const bindings = [{ atom: 'p', value: d.any([a, b]) }, { atom: 'q', value: d.any([a, c]) }];
const pub = createEvidenceAlgebra(['p', 'q']), p = pub.atom('p'), q = pub.atom('q');
const condition = pub.residual(p, pub.all([p, q]));
const translated = d.substitute(condition, bindings.filter(b => pub.inspect(condition).support.includes(b.atom)));
const gen = d.source('additional', translated);
const modes = [false, true].flatMap(simd => [false, true].flatMap(reductionFusion =>
  [false, true].map(memoizeReductions => ({ simd, reductionFusion, memoizeReductions }))));
const files = (g, source) => [g, { name: 'app.ass', source }];
const build = (g, source, options) => compileSources(files(g, source), options);

test('transport audit licenses residual translation but not arbitrary private observability', () => {
  assert(d.auditTransport(bindings).preservesImplication);
  assert.equal(translated, d.residual(bindings[0].value, d.all(bindings.map(b => b.value))));
  const hidden = pub.abstract(a, bindings);
  assert.equal(hidden.exact, false); // a alone is hidden by the two disjunctive views.
});

test('constant true, constant false, empty and duplicate meanings have different lifting semantics', () => {
  assert(d.auditTransport([]).preservesImplication);
  assert(d.auditTransport([{ atom: 'fixed', value: d.always }]).preservesImplication);
  const impossible = [{ atom: 'fixed', value: d.never }];
  assert(!d.auditTransport(impossible).preservesImplication);
  assert.equal(d.liftEvidence(impossible, [], ['fixed']), null);
  assert.deepEqual(d.liftEvidence([], ['b'], []), { facts: ['b'], added: [], cost: 0 });
  assert.throws(() => d.liftEvidence([{ atom: 'fixed', value: d.always }], [], []), /cannot drop/);
  assert(!d.auditTransport([{ atom: 'p', value: a }, { atom: 'q', value: a }]).preservesImplication);
  const empty = createEvidenceAlgebra([]);
  assert(empty.auditTransport([]).preservesImplication);
  assert.deepEqual(empty.liftEvidence([], [], []), { facts: [], added: [], cost: 0 });
});

test('lifts preserve private evidence, exact public flags, zero-cost tie minimality and sunk prices', () => {
  const prices = [{ atom: 'a', cost: 3 }, { atom: 'b', cost: 2 }, { atom: 'c', cost: 2 }];
  assert.deepEqual(d.liftEvidence(bindings, [], ['p'], prices), { facts: ['b'], added: ['b'], cost: 2 });
  assert.deepEqual(d.liftEvidence(bindings, ['b'], ['p', 'q'], prices), { facts: ['b', 'c'], added: ['c'], cost: 2 });
  assert.deepEqual(d.liftEvidence(bindings, ['a'], ['p', 'q'], prices), { facts: ['a'], added: [], cost: 0 });
  assert.throws(() => d.liftEvidence(bindings, ['a'], ['p'], prices), /cannot drop/);
  const free = d.atoms.map(atom => ({ atom, cost: 0 }));
  assert.deepEqual(d.liftEvidence(bindings, [], ['p', 'q'], free), { facts: ['a'], added: ['a'], cost: 0 });
  assert.deepEqual(d.liftEvidence([{ atom: 'either', value: d.any([a, b]) }], [], ['either']), { facts: ['b'], added: ['b'], cost: 1 });
});

test('foreign and forged handles, collisions, malformed and sparse bindings are rejected', () => {
  const foreign = createEvidenceAlgebra(['a']).atom('a');
  for (const value of [foreign, {}, { ...a }, null, 1, []]) {
    assert.throws(() => d.auditTransport([{ atom: 'view', value }]), TypeError);
    assert.throws(() => d.liftEvidence([{ atom: 'view', value }], [], []), TypeError);
  }
  for (const bs of [null, {}, new Array(1), [null], [bindings[0], bindings[0]]]) {
    assert.throws(() => d.auditTransport(bs)); assert.throws(() => d.liftEvidence(bs, [], []));
  }
  for (const atom of ['', 'do', 'x.y', 'x; export fn bad', 'x'.repeat(65), null])
    assert.throws(() => d.auditTransport([{ atom, value: a }]), TypeError);
  assert.throws(() => d.auditTransport(Array(129).fill(bindings[0])), RangeError);
});

test('invalid valuations, downward requests and prices fail without changing a session', () => {
  const before = d.stats.nodes;
  for (const values of [null, {}, new Array(1), ['unknown'], ['a', 'a']])
    assert.throws(() => d.liftEvidence(bindings, values, []), TypeError);
  for (const values of [null, {}, new Array(1), ['unknown'], ['p', 'p']])
    assert.throws(() => d.liftEvidence(bindings, [], values), TypeError);
  for (const prices of [null, [null], new Array(1), [{ atom: 'unknown', cost: 1 }],
    [{ atom: 'a', cost: 1 }, { atom: 'a', cost: 2 }],
    ...[-1, 0.5, Infinity, NaN, 1e9 + 1, null, '1'].map(cost => [{ atom: 'a', cost }])])
    assert.throws(() => d.liftEvidence(bindings, [], ['p', 'q'], prices));
  assert.equal(d.stats.nodes, before);
});

test('work and workspace limits throw rather than return false lawfulness or false infeasibility', () => {
  const tiny = createEvidenceAlgebra(['a'], { maxNodes: 3 }), a = tiny.atom('a'), bs = [{ atom: 'p', value: a }];
  assert.throws(() => tiny.auditTransport(bs), /workspace node limit/);
  assert.throws(() => tiny.liftEvidence(bs, [], []), /workspace node limit/);
  assert.equal(tiny.stats.nodes, 3); assert.equal(tiny.atom('a'), a);
  const short = createEvidenceAlgebra(['a'], { maxWork: 1 }), atom = short.atom('a');
  assert.throws(() => short.auditTransport([{ atom: 'p', value: atom }]), /work limit/);
  assert.throws(() => short.liftEvidence([{ atom: 'p', value: atom }], [], ['p']), /work limit/);
  assert.equal(short.stats.nodes, 3); assert(short.evaluate(atom, ['a']));
});

test('JSON outputs are frozen detached snapshots and accessor inputs are captured once', () => {
  const input = bindings.map(b => ({ ...b })), initial = [], target = ['p', 'q'];
  const result = d.liftEvidence(input, initial, target), audit = d.auditTransport(input);
  input[0].value = d.never; initial.push('c'); target.pop();
  assert.deepEqual(result.facts, ['a']); assert(audit.preservesImplication); assert(!Object.isFrozen(input));
  assert.throws(() => result.facts.push('b'), TypeError); assert.throws(() => result.cost = 9, TypeError);
  const bad = d.auditTransport([{ atom: 'x', value: a }, { atom: 'y', value: a }]);
  assert.throws(() => bad.obstruction.requested.push('y'), TypeError);
  assert.deepEqual(JSON.parse(JSON.stringify(bad)), bad);
  let atomReads = 0, valueReads = 0, costReads = 0;
  const binding = { get atom() { atomReads++; return atomReads === 1 ? 'view' : 'bad'; },
    get value() { valueReads++; return valueReads === 1 ? a : null; } };
  assert(d.auditTransport([binding]).preservesImplication);
  assert.equal(atomReads, 1); assert.equal(valueReads, 1);
  const priced = d.liftEvidence([{ atom: 'view', value: a }], [], ['view'], [
    { atom: 'a', get cost() { costReads++; return 5; } },
  ]);
  assert.equal(priced.cost, 5); assert.equal(costReads, 1);
});

for (const mode of modes) test(`lawful residual translation executes with handwritten bytes ${JSON.stringify(mode)}`, async () => {
  const app = 'export fn main = (facts:{a:Bool,b:Bool,c:Bool}) -> additional facts;';
  const opts = { ...mode, maxLoopIterations: 0 }, compiled = build(gen, app, opts);
  const direct = compile('export fn main = (facts:{a:Bool,b:Bool,c:Bool}) -> facts.a || facts.c;', opts);
  assert.deepEqual(compiled.bytes, direct.bytes); assert(verifyCertificate(compiled.certificate.steps));
  const r = await createRuntime(compiled);
  for (const a of [false, true]) for (const b of [false, true]) for (const c of [false, true])
    assert.equal(r.call('main', [{ a, b, c }]), a || c);
  assert.equal(compiled.stats.kernelHeapAllocationSites, 0);
});

test('actual conditional guards recheck their guarantee, and projection cannot skip either obligation', async () => {
  const app = `export fn main = (a:Bool) -> (b:Bool) -> (c:Bool) ->
    (require ((a || b) && additional {a,c}) {value:7,other:9}).value;
    export fn lazy = () -> {valid:additional {a:require false true,c:true},value:7}.value;`;
  for (const mode of modes) {
    const r = await createRuntime(build(gen, app, { ...mode, maxLoopIterations: 0 }));
    assert.equal(r.call('main', [true, false, false]), 7);
    assert.throws(() => r.call('main', [false, true, false]), WebAssembly.RuntimeError); // Missing addition.
    assert.throws(() => r.call('main', [false, false, true]), WebAssembly.RuntimeError); // False guarantee.
    assert.equal(r.call('main', [false, true, true]), 7);
    assert.equal(r.call('lazy', [{}]), 7);
  }
});

test('a returned lift is a proposal, not proof that its proposed facts are currently true', async () => {
  const lift = d.liftEvidence(bindings, [], ['p', 'q']);
  assert.deepEqual(lift.added, ['a']);
  // Ordinary source uses CURRENT numeric values, not flags asserted by the plan.
  const r = await createRuntime(build(gen, `export fn main = (a:Num) -> (b:Num) -> (c:Num) ->
    require ((a>=0 || b>=0) && additional {a:a>=0,c:c>=0}) (a+b+c);`));
  assert.equal(r.call('main', [3, -1, -1]), 1);
  assert.throws(() => r.call('main', [-3, -1, -1]), WebAssembly.RuntimeError);
});

test('generated conditional facts retain exact raw loop accounting and post-trap reset', () => {
  const app = `export fn main = (a:Num) -> (b:Num) ->
    additional {a:sum (range a)<0,c:sum (range b)>=0};`;
  for (const mode of modes) for (const maxLoopIterations of [6, 7]) {
    const raw = new WebAssembly.Instance(new WebAssembly.Module(build(gen, app, { ...mode, maxLoopIterations }).bytes)).exports.main;
    if (maxLoopIterations === 6) assert.throws(() => raw(3, 4), WebAssembly.RuntimeError);
    else assert.equal(raw(3, 4), 1);
    assert.equal(raw(1, 1), 1);
  }
});

test('Boolean types, diagnostics, effects, ABI escapes and compiler cache boundaries stay checked', async () => {
  for (const [app, code] of [
    ['export fn main = () -> additional {a:1,c:true};', 'E_TYPE'],
    ['export fn main = () -> additional {a:true};', 'E_TYPE'],
    ['export fn main = () -> additional;', 'E_ABI'],
    ['host fn audit:Num -> Bool; export fn main = (n:Num) -> additional {a:audit n,c:true};', 'E_EFFECT'],
  ]) assert.throws(() => build(gen, app), e => e.code === code);
  const app = '// local\nexport fn main = () -> additional {a:missing,c:true};';
  const result = checkSources(files(gen, app));
  assert.equal(result.diagnostics[0].sourceName, 'app.ass'); assert.equal(result.diagnostics[0].code, 'E_NAME');
  assert.equal(result.diagnostics[0].range.start.offset, app.indexOf('missing'));
  const session = createCompiler(), inputs = files(gen, 'export fn main = () -> additional {a:false,c:true};');
  session.compileSources(inputs).bytes.fill(0);
  const cached = session.compileSources(inputs); assert(cached.cache.hit);
  assert((await createRuntime(cached)).call('main', [{}]));
});

test('transport does not erase causal access restrictions, event domains or stream budgets', async () => {
  const condition = 'additional {a:valid,c:false}';
  const r = await createRuntime(build(gen, `export fn main = (xs:[Num]) -> (valid:Bool) ->
    require (${condition}) (sum (scan xs 0 (s -> x -> s+x)));`, { maxLoopIterations: 3 }));
  assert.equal(r.call('main', [[1, 2, 3], true]), 10);
  assert.throws(() => r.call('main', [[1, 2, 3, 4], true]), WebAssembly.RuntimeError);
  assert.throws(() => build(gen, `export fn main = (xs:[Num]) -> (valid:Bool) ->
    require (${condition}) (at (scan xs 0 (s -> x -> s+x)) 0);`), e => e.code === 'E_CAUSAL_ACCESS');
  assert.throws(() => build(gen, `export fn main = (xs:[Num]) -> (ys:[Num]) -> (valid:Bool) ->
    require (${condition}) (zip xs ys (x -> y -> x+y));`), e => e.code === 'E_DOMAIN');
});

test('128-private/64-public pair interfaces audit and lift symbolically under default budgets', () => {
  const hidden = createEvidenceAlgebra(Array.from({ length: 128 }, (_, i) => `a${i}`));
  const bs = Array.from({ length: 64 }, (_, i) => ({ atom: `p${i}`,
    value: hidden.any([hidden.atom(`a${2*i}`), hidden.atom(`a${2*i+1}`)]) }));
  const before = hidden.stats.nodes, audited = hidden.auditTransport(bs);
  assert(audited.preservesImplication);
  const all = hidden.liftEvidence(bs, [], bs.map(b => b.atom));
  assert.equal(all.cost, 64); assert.equal(all.added.length, 64);
  assert(all.added.every(name => Number(name.slice(1)) % 2 === 1));
  assert.equal(hidden.stats.nodes, before);
});

test('full-size reversed identity, fixed unused facts and billion-price totals remain exact', () => {
  const hidden = createEvidenceAlgebra(Array.from({ length: 128 }, (_, i) => `a${i}`), { maxNodes: 65536, maxWork: 2000000 });
  const bs = hidden.atoms.map((n, i) => ({ atom: `p${i}`, value: hidden.atom(n) })).reverse();
  assert(hidden.auditTransport(bs).preservesImplication);
  const result = hidden.liftEvidence(bs, ['a0'], bs.map(b => b.atom), hidden.atoms.map(atom => ({ atom, cost: 1e9 })));
  assert.equal(result.cost, 127e9); assert.equal(result.facts.length, 128);
  assert.deepEqual(hidden.liftEvidence([{ atom: 'only', value: bs[0].value }], ['a0'], []), { facts: ['a0'], added: [], cost: 0 });
});
