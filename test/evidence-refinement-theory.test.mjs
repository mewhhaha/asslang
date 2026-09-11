import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceAlgebra } from '../src/compiler.mjs';

function functions(n) {
  const result = [];
  for (let f = 0; f < 2 ** (2 ** n); f++) {
    const table = Array.from({ length: 2 ** n }, (_, s) => !!(f & (1 << s)));
    if (table.every((v, s) => !v || table.every((w, t) => (s & t) !== s || w))) result.push(table);
  }
  return result;
}
const support = (names, mask) => names.filter((_, i) => mask & (1 << i));
const contract = (d, table) => d.fromFrontier(table.flatMap((yes, mask) => yes ? [support(d.atoms, mask)] : []));
const selectedMask = ids => ids.reduce((m, i) => m | (1 << i), 0);
const size = m => { let n = 0; for (; m; m &= m - 1) n++; return n; };
// Enumerate ordered pairs and candidate subsets; no production abstraction,
// BDD minimization, or witness-guided optimization is used to find the optimum.
function oracle(targets, retained, candidates, costs) {
  const universe = Array.from({ length: 1 << candidates.length }, (_, m) => m);
  const feasible = universe.filter(m => targets.every(f => f.every((positive, p) => !positive || f.every((negative, n) =>
    negative || retained.some(r => r[p] && !r[n]) || candidates.some((c, i) => (m & (1 << i)) && c[p] && !c[n])))));
  const price = m => costs.reduce((sum, c, i) => sum + ((m & (1 << i)) ? c : 0), 0);
  feasible.sort((a, b) => price(a) - price(b) || size(a) - size(b));
  return { feasible, price, cost: feasible.length ? price(feasible[0]) : null, count: feasible.length ? size(feasible[0]) : null };
}
function checkWitnesses(d, plan, goals, retained, candidates) {
  const number = facts => selectedMask(facts.map(n => d.atoms.indexOf(n)));
  for (const w of plan.separations) {
    const p = number(w.satisfying), n = number(w.failing), f = goals.find(g => g.name === w.target).table;
    assert(f[p]); assert(!f[n]); assert(retained.every(r => !r[p] || r[n]));
    assert.deepEqual(w.separates, candidates.flatMap((c, i) => c[p] && !c[n] ? [i] : []));
  }
}

test('all 7,776 two-private-atom target pairs, base summaries and candidate pairs attain exact costs', t => {
  const tables = functions(2), d = createEvidenceAlgebra(['a', 'b']);
  const handles = tables.map(f => contract(d, f));
  let cases = 0, feasible = 0, impossible = 0, witnesses = 0;
  for (let r = 0; r < 6; r++) for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++)
    for (let f = 0; f < 6; f++) for (let g = 0; g < 6; g++) {
      const goals = [{ name: 'first', value: handles[f], table: tables[f] }, { name: 'second', value: handles[g], table: tables[g] }];
      const costs = [(a + f) % 4, (b + g) % 4];
      const options = { retained: [{ atom: 'base', value: handles[r] }], candidates: [
        { atom: 'x', value: handles[a], cost: costs[0] }, { atom: 'y', value: handles[b], cost: costs[1] },
      ] };
      const expected = oracle([tables[f], tables[g]], [tables[r]], [tables[a], tables[b]], costs);
      const before = d.stats.nodes, plan = d.refine(goals, options);
      assert.equal(d.stats.nodes, before);
      assert.equal(plan.complete, expected.feasible.length > 0);
      assert.equal(plan.minimumCost, expected.cost); assert.equal(plan.additionalCount, expected.count);
      if (plan.complete) { assert(expected.feasible.includes(selectedMask(plan.selected))); feasible++; }
      else { assert(plan.separations.some(w => !w.separates.length)); impossible++; }
      checkWitnesses(d, plan, goals, [tables[r]], [tables[a], tables[b]]);
      assert(d.verifyRefinement(goals, options, JSON.parse(JSON.stringify(plan))));
      witnesses += plan.separations.length; cases++;
    }
  assert.equal(cases, 7776);
  t.diagnostic(JSON.stringify({ cases, feasible, impossible, witnesses }));
});

test('seeded three-atom multi-target cases agree with exhaustive subset selection', t => {
  const tables = functions(3), d = createEvidenceAlgebra(['a', 'b', 'c']), handles = tables.map(f => contract(d, f));
  let seed = 0x8d7184c;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  let cases = 0, feasible = 0, subsets = 0;
  for (let trial = 0; trial < 250; trial++) {
    const goalIds = Array.from({ length: 1 + rand() % 3 }, () => rand() % tables.length);
    const retainedIds = Array.from({ length: rand() % 3 }, () => rand() % tables.length);
    const candidateIds = Array.from({ length: 1 + rand() % 6 }, () => rand() % tables.length);
    const costs = candidateIds.map(() => rand() % 8);
    const goals = goalIds.map((g, i) => ({ name: `g${i}`, value: handles[g], table: tables[g] }));
    const options = { retained: retainedIds.map((v, i) => ({ atom: `r${i}`, value: handles[v] })),
      candidates: candidateIds.map((v, i) => ({ atom: `c${i}`, value: handles[v], cost: costs[i] })) };
    const expected = oracle(goalIds.map(i => tables[i]), retainedIds.map(i => tables[i]), candidateIds.map(i => tables[i]), costs);
    const plan = d.refine(goals, options);
    assert.equal(plan.complete, expected.feasible.length > 0);
    assert.equal(plan.minimumCost, expected.cost); assert.equal(plan.additionalCount, expected.count);
    if (plan.complete) { assert(expected.feasible.includes(selectedMask(plan.selected))); feasible++; }
    checkWitnesses(d, plan, goals, retainedIds.map(i => tables[i]), candidateIds.map(i => tables[i]));
    cases++; subsets += 2 ** candidateIds.length;
  }
  t.diagnostic(JSON.stringify({ cases, feasible, subsets }));
});

test('an exact generating interface represents all positive client formulas, but not residuals automatically', () => {
  const d = createEvidenceAlgebra(['a', 'b']), a = d.atom('a'), b = d.atom('b'), ab = d.all([a, b]);
  const goals = [{ name: 'one', value: a }, { name: 'both', value: ab }];
  const retained = [{ atom: 'x', value: a }, { atom: 'y', value: ab }];
  const plan = d.refine(goals, { retained, candidates: [{ atom: 'missing', value: b }] });
  assert.deepEqual(plan.selected, []);
  const e = createEvidenceAlgebra(['x', 'y']);
  for (const table of functions(2)) {
    const publicContract = contract(e, table);
    const instantiated = d.substitute(publicContract, retained.filter(v => e.inspect(publicContract).support.includes(v.atom)));
    assert(e.abstract(instantiated, retained).exact);
  }
  const residual = d.residual(a, ab);
  assert.equal(residual, b); assert(!e.abstract(residual, retained).exact);
  const extended = d.refine([...goals, { name: 'residual', value: residual }], { retained, candidates: [{ atom: 'missing', value: b }] });
  assert.deepEqual(extended.selected, [0]);
});

test('opposite-direction flag differences are not separators for monotone interfaces', () => {
  const d = createEvidenceAlgebra(['a', 'b']), a = d.atom('a'), b = d.atom('b');
  const goals = [{ name: 'target', value: a }];
  const options = { retained: [{ atom: 'some', value: d.any([a, b]) }], candidates: [{ atom: 'opposite', value: b, cost: 0 }] };
  const plan = d.refine(goals, options);
  assert(!plan.complete);
  const w = plan.separations.find(w => !w.separates.length);
  assert.deepEqual(w.satisfying, ['a']); assert.deepEqual(w.failing, ['b']);
  assert(!d.evaluate(b, w.satisfying) && d.evaluate(b, w.failing));
  const wrong = structuredClone(plan); wrong.separations[0].separates = [0];
  assert(!d.verifyRefinement(goals, options, wrong));
});
