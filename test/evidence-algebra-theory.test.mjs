import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceAlgebra } from '../src/compiler.mjs';
import { residualEvidence } from '../examples/interop/evidence-residual.mjs';

const subsets = n => Array.from({ length: 2 ** n }, (_, mask) =>
  Array.from({ length: n }, (_, i) => i).filter(i => mask & (1 << i)));
const below = (a, b) => a.every(i => b.includes(i));
function antichains(n) {
  const terms = subsets(n);
  return subsets(terms.length).map(ids => ids.map(i => terms[i]))
    .filter(f => !f.some((s, i) => f.some((t, j) => i !== j && below(t, s))));
}
const families = antichains(3), points = subsets(3), names = ['x', 'y', 'z'];
const holds = (family, s) => family.some(t => below(t, s));
const named = f => f.map(s => s.map(i => names[i]));

// Read snapshots as an independent decision evaluator, not manager.evaluate.
function read(snapshot, facts) {
  let id = snapshot.root;
  while (id > 1) { const n = snapshot.nodes[id - 2]; id = facts.includes(n.atom) ? n.high : n.low; }
  return id === 1;
}

test('all 20 three-atom contracts have canonical semantics and valid reduced ordered snapshots', t => {
  const d = createEvidenceAlgebra(names), fs = families.map(f => d.fromFrontier(named(f)));
  assert.equal(fs.length, 20); assert.equal(new Set(fs).size, 20);
  for (let i = 0; i < fs.length; i++) {
    const snapshot = d.inspect(fs[i]), triples = new Set();
    snapshot.nodes.forEach((n, j) => {
      assert.notEqual(n.low, n.high);
      assert(n.low < j + 2 && n.high < j + 2);
      for (const child of [n.low, n.high]) if (child > 1)
        assert(names.indexOf(snapshot.nodes[child - 2].atom) > names.indexOf(n.atom));
      assert(!triples.has(JSON.stringify(n))); triples.add(JSON.stringify(n));
    });
    assert.equal(d.fromFrontier(named([...families[i]].reverse())), fs[i]);
    for (const s of points) {
      const expected = holds(families[i], s), facts = s.map(i => names[i]);
      assert.equal(d.evaluate(fs[i], facts), expected);
      assert.equal(read(snapshot, facts), expected);
    }
  }
  t.diagnostic('20 canonical monotone functions, 160 truth assignments and independent snapshot evaluations');
});

test('all 400 pairs agree on entailment, separating assignments and exact Heyting residuals', t => {
  const d = createEvidenceAlgebra(names), fs = families.map(f => d.fromFrontier(named(f)));
  let witnesses = 0;
  for (let a = 0; a < fs.length; a++) for (let b = 0; b < fs.length; b++) {
    const implication = points.every(s => !holds(families[a], s) || holds(families[b], s));
    assert.equal(d.entails(fs[a], fs[b]), implication);
    const witness = d.counterexample(fs[a], fs[b]);
    if (implication) assert.equal(witness, null);
    else {
      assert(d.evaluate(fs[a], witness)); assert(!d.evaluate(fs[b], witness)); assert(Object.isFrozen(witness)); witnesses++;
    }
    const residual = d.residual(fs[a], fs[b]);
    // Previous enumerative implementation is a different algorithm and representation.
    const independent = residualEvidence(3, families[a], families[b]);
    for (const s of points) assert.equal(d.evaluate(residual, s.map(i => names[i])), holds(independent, s));
    assert.equal(residual, d.fromFrontier(named(independent)));
  }
  t.diagnostic(`400 pairs, 3,200 residual valuations, ${witnesses} separating assignments`);
});

test('8,000 adjunction cases validate that inferred missing evidence is principal', () => {
  const d = createEvidenceAlgebra(names), fs = families.map(f => d.fromFrontier(named(f)));
  for (const g of fs) for (const target of fs) {
    const residual = d.residual(g, target);
    for (const w of fs) assert.equal(d.entails(d.all([g, w]), target), d.entails(w, residual));
  }
});

test('tiny square-free prime oracle agrees with sharing, alternatives, and divisibility', t => {
  const primes = [2n, 3n, 5n];
  const encode = s => s.reduce((p, i) => p * primes[i], 1n);
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  const lcm = (a, b) => a / gcd(a, b) * b;
  const minimal = list => [...new Set(list)].filter(n => !list.some(m => n !== m && n % m === 0n));
  const d = createEvidenceAlgebra(names), fs = families.map(f => d.fromFrontier(named(f)));
  for (let i = 0; i < fs.length; i++) for (let j = 0; j < fs.length; j++) {
    const a = families[i].map(encode), b = families[j].map(encode);
    const both = minimal(a.flatMap(x => b.map(y => lcm(x, y)))), either = minimal([...a, ...b]);
    for (const s of points) {
      assert.equal(d.evaluate(d.all([fs[i], fs[j]]), s.map(i => names[i])), both.some(p => encode(s) % p === 0n));
      assert.equal(d.evaluate(d.any([fs[i], fs[j]]), s.map(i => names[i])), either.some(p => encode(s) % p === 0n));
    }
  }
  assert.equal(lcm(2n, 2n), 2n); assert.notEqual(2n * 2n, 2n);
  t.diagnostic('6,400 independent prime/divisibility evaluations; production uses no prime arithmetic');
});

test('weighted minimum agrees with brute force including zero prices for every contract', () => {
  const d = createEvidenceAlgebra(names);
  for (const f of families) for (const prices of [[1, 1, 1], [0, 2, 5], [9, 0, 0], [1e9, 1e9, 1e9]]) {
    const h = d.fromFrontier(named(f)), result = d.minimum(h, names.map((atom, i) => ({ atom, cost: prices[i] })));
    const choices = points.filter(s => holds(f, s)).map(s => ({ s, cost: s.reduce((n, i) => n + prices[i], 0) }))
      .sort((a, b) => a.cost - b.cost || a.s.length - b.s.length);
    if (!choices.length) assert.equal(result, null);
    else {
      assert.equal(result.cost, choices[0].cost); assert.equal(result.facts.length, choices[0].s.length);
      assert(d.evaluate(h, result.facts));
    }
  }
});

test('cross-vocabulary substitution agrees with truth-table composition on 2,400 instantiations', () => {
  const abstract = createEvidenceAlgebra(['a', 'b']), concrete = createEvidenceAlgebra(names);
  const templates = antichains(2).map(f => abstract.fromFrontier(f.map(s => s.map(i => ['a', 'b'][i]))));
  const fs = families.map(f => concrete.fromFrontier(named(f)));
  for (const template of templates) for (const a of fs) for (const b of fs) {
    const replacements = { a, b }, support = abstract.inspect(template).support;
    const instantiated = concrete.substitute(template, support.map(atom => ({ atom, value: replacements[atom] })));
    for (const s of points.map(s => s.map(i => names[i]))) {
      const input = ['a', 'b'].filter(n => concrete.evaluate(replacements[n], s));
      assert.equal(concrete.evaluate(instantiated, s), abstract.evaluate(template, input));
    }
  }
});

test('substitution is simultaneous and associative; residual only transports as a sufficient condition', () => {
  const a = createEvidenceAlgebra(['x', 'y']), b = createEvidenceAlgebra(['p', 'q']), c = createEvidenceAlgebra(['u', 'v']);
  const x = a.atom('x'), y = a.atom('y'), p = b.atom('p'), q = b.atom('q'), u = c.atom('u'), v = c.atom('v');
  const original = a.any([x, y]);
  assert.equal(a.substitute(x, [{ atom: 'x', value: y }]), y);
  const swaps = a.substitute(a.all([x, y]), [{ atom: 'x', value: y }, { atom: 'y', value: x }]);
  assert.equal(swaps, a.all([x, y]));
  const bp = b.all([p, q]);
  const first = b.substitute(original, [{ atom: 'x', value: bp }, { atom: 'y', value: q }]);
  const by = [{ atom: 'p', value: u }, { atom: 'q', value: v }];
  const after = c.substitute(first, by.filter(x => b.inspect(first).support.includes(x.atom)));
  const before = c.substitute(original, [{ atom: 'x', value: c.substitute(bp, by) }, { atom: 'y', value: v }]);
  assert.equal(after, before);
  const residual = a.residual(x, y);
  const specializedOld = c.substitute(residual, [{ atom: 'y', value: u }]);
  assert.equal(specializedOld, u); assert.equal(c.residual(u, u), c.always);
  assert(c.entails(specializedOld, c.residual(u, u))); assert(!c.entails(c.always, specializedOld));
});
