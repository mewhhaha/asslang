import test from 'node:test';
import assert from 'node:assert/strict';
import { residualEvidence, evidenceResidualSource, runEvidenceResidualExample } from '../examples/interop/evidence-residual.mjs';
import { compile } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';

const subset = (a, b) => a.every(i => b.includes(i));
const holds = (family, s) => family.some(a => subset(a, s));
const union = (a, b) => [...new Set([...a, ...b])].sort((x, y) => x - y);
const key = a => a.reduce((n, i) => n + 2 ** i, 0);
function minimal(sets) {
  const unique = [...new Map(sets.map(s => [key(s), s])).values()];
  return unique.filter(s => !unique.some(t => t !== s && subset(t, s))).sort((a, b) => key(a) - key(b));
}
const meet = (a, b) => minimal(a.flatMap(x => b.map(y => union(x, y))));
const join = (a, b) => minimal([...a, ...b]);
const included = (a, b) => a.every(x => holds(b, x));
const states = Array.from({ length: 8 }, (_, s) => [0, 1, 2].filter(i => s & (1 << i)));
const antichains = Array.from({ length: 256 }, (_, f) => states.filter((_, i) => f & (1 << i)))
  .filter(f => minimal(f).length === f.length);
const result = (a, b) => residualEvidence(3, a, b);

test('every three-label residual equals universal extension semantics and the antichain difference formula', t => {
  assert.equal(antichains.length, 20);
  let pairs = 0, memberships = 0;
  for (const guarantee of antichains) for (const target of antichains) {
    const actual = result(guarantee, target);
    let formula = [[]];
    for (const b of guarantee)
      formula = meet(formula, minimal(target.map(a => a.filter(i => !b.includes(i)))));
    assert.deepEqual(actual, formula);
    for (const s of states) {
      // Quantify over extensions directly, rather than mirroring the helper's unions.
      const expected = states.every(t => !subset(s, t) || !holds(guarantee, t) || holds(target, t));
      assert.equal(holds(actual, s), expected); memberships++;
    }
    pairs++;
  }
  t.diagnostic(JSON.stringify({ antichains: antichains.length, pairs, memberships }));
});

test('adjunction, currying and uncertainty law hold for all three-label family triples', t => {
  let triples = 0;
  const cached = new Map();
  const residual = (a, b) => {
    const k = JSON.stringify([a, b]);
    if (!cached.has(k)) cached.set(k, result(a, b));
    return cached.get(k);
  };
  for (const u of antichains) for (const v of antichains) for (const w of antichains) {
    assert.equal(included(meet(w, u), v), included(w, residual(u, v)));
    assert.deepEqual(residual(meet(u, w), v), residual(u, residual(w, v)));
    assert.deepEqual(residual(join(u, w), v), meet(residual(u, v), residual(w, v)));
    triples++;
  }
  assert.equal(triples, 8000); t.diagnostic(JSON.stringify({ triples }));
});

test('uncertain promises require universal rather than existential completion', () => {
  assert.deepEqual(residualEvidence(2, [[0], [1]], [[0, 1]]), [[0, 1]]);
  assert.deepEqual(residualEvidence(2, [[0]], [[0, 1]]), [[1]]);
  // Material implication accepts the empty snapshot, but fails in extension {0}.
  assert.equal(!holds([[0]], []) || holds([[0, 1]], []), true);
  assert.equal(holds(residualEvidence(2, [[0]], [[0, 1]]), []), false);
});

test('empty, impossible, redundant and reordered families have explicit semantics', () => {
  assert.deepEqual(residualEvidence(0, [], []), [[]]);
  assert.deepEqual(residualEvidence(0, [[]], []), []);
  assert.deepEqual(residualEvidence(0, [[]], [[]]), [[]]);
  assert.deepEqual(residualEvidence(3, [[2], [1], [1, 2], [1]], [[2, 0], [0, 1]]), [[0]]);
  assert.deepEqual(residualEvidence(3, [[]], [[0, 1], [0, 2]]), [[0, 1], [0, 2]]);
});

test('the teaching helper validates bounds, sparse arrays, indices and immutable snapshots', () => {
  for (const n of [-1, 9, 1.5, NaN, Infinity, '3', null])
    assert.throws(() => residualEvidence(n, [], []), RangeError);
  for (const family of [null, {}, new Array(1), [null], [new Array(1)], [[-1]], [[3]], [[0, 0]], [['0']], [[0, 1, 2, 3]]]) {
    assert.throws(() => residualEvidence(3, family, []), TypeError);
    assert.throws(() => residualEvidence(3, [], family), TypeError);
  }
  assert.throws(() => residualEvidence(8, Array(257).fill([]), []), RangeError);
  const guarantee = [[1], [2]], target = [[0, 1], [0, 2]];
  const actual = residualEvidence(3, guarantee, target);
  guarantee[0][0] = 0; target[0].push(2);
  assert.deepEqual(actual, [[0]]); assert(!Object.isFrozen(guarantee));
  assert.throws(() => actual[0].push(1), TypeError);
  assert.throws(() => actual.push([1]), TypeError);
  const all = Array.from({ length: 256 }, (_, s) => Array.from({ length: 8 }, (_, i) => i).filter(i => s & (1 << i)));
  assert.deepEqual(residualEvidence(8, all, [all.at(-1)]), [all.at(-1)]);
});

test('the compiled guard rechecks guarantees, additions and coherence in all lowering modes', async t => {
  let configurations = 0, flagAssignments = 0;
  for (const simd of [false, true]) for (const reductionFusion of [false, true]) for (const memoizeReductions of [false, true]) {
    const runtime = await createRuntime(compile(evidenceResidualSource, { simd, reductionFusion, memoizeReductions, maxLoopIterations: 0 }));
    for (const e0 of [false, true]) for (const e1 of [false, true]) for (const e2 of [false, true]) {
      if (e0 && (e1 || e2)) assert.equal(runtime.call('flags', [e0, e1, e2]), true);
      else assert.throws(() => runtime.call('flags', [e0, e1, e2]), WebAssembly.RuntimeError);
      flagAssignments++;
    }
    const good = { a: { raw: 3, summary: 9 }, b: { raw: 3, summary: 9 }, c: { summary: 9 } };
    assert.deepEqual(runtime.call('values', [good]), { input: 3, output: 9 });
    const wrongEvidence = structuredClone(good); wrongEvidence.b.raw = -3;
    assert.throws(() => runtime.call('values', [wrongEvidence]), WebAssembly.RuntimeError);
    const falsePromise = structuredClone(good); falsePromise.c.summary = 10;
    assert.throws(() => runtime.call('values', [falsePromise]), WebAssembly.RuntimeError);
    const incoherent = structuredClone(good); incoherent.b.summary = 10;
    assert.throws(() => runtime.call('values', [incoherent]), WebAssembly.RuntimeError);
    assert.deepEqual(runtime.call('values', [good]), { input: 3, output: 9 }); configurations++;
  }
  t.diagnostic(JSON.stringify({ configurations, flagAssignments }));
});

test('the executable residual example consumes a verified descent frontier', async () => {
  const result = await runEvidenceResidualExample();
  assert.deepEqual(result.target, [[0, 1], [0, 2]]);
  assert.deepEqual(result.additional, [[0]]);
  assert.deepEqual(result.values, { input: 3, output: 9 });
});
