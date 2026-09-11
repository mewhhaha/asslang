import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceAlgebra } from '../src/compiler.mjs';

// Complete truth tables, not the new relational BDD/quantifier algorithm.
function functions(n) {
  const tables = [];
  for (let code = 0; code < 2 ** (2 ** n); code++) {
    const f = Array.from({ length: 2 ** n }, (_, s) => !!(code & (1 << s)));
    if (f.every((v, s) => !v || f.every((w, t) => (s & t) !== s || w))) tables.push(f);
  }
  return tables;
}
const subset = (s, t) => (s & t) === s;
const facts = (names, mask) => names.filter((_, i) => mask & (1 << i));
const mask = (names, input) => input.reduce((m, n) => m | (1 << names.indexOf(n)), 0);
const contract = (d, table) => d.fromFrontier(table.flatMap((v, s) => v ? [facts(d.atoms, s)] : []));
const pull = (d, p, f, bindings) => d.substitute(f, bindings.filter(b => p.inspect(f).support.includes(b.atom)));
function* tuples(size, n, prefix = []) {
  if (!n) { yield prefix; return; }
  for (let i = 0; i < size; i++) yield* tuples(size, n - 1, [...prefix, i]);
}
function views(tables) {
  return Array.from({ length: 8 }, (_, s) => tables.reduce((m, f, j) => m | (+f[s] << j), 0));
}
function lawful(view, m) {
  for (let s = 0; s < view.length; s++) for (let t = 0; t < 2 ** m; t++)
    if (subset(view[s], t) && !view.some((v, u) => subset(s, u) && v === t)) return false;
  return true;
}

test('all interfaces of three private atoms and zero through three public atoms match upper-cone semantics', t => {
  const tables = functions(3), d = createEvidenceAlgebra(['a', 'b', 'c']), fs = tables.map(f => contract(d, f));
  let maps = 0, passes = 0, failures = 0, replayed = 0;
  for (let m = 0; m <= 3; m++) {
    const p = createEvidenceAlgebra(['x', 'y', 'z'].slice(0, m));
    for (const ids of tuples(tables.length, m)) {
      const binding = ids.map((id, j) => ({ atom: p.atoms[j], value: fs[id] }));
      const v = views(ids.map(i => tables[i])), before = d.stats.nodes;
      const result = d.auditTransport(binding);
      assert.equal(d.stats.nodes, before);
      assert.equal(result.preservesImplication, lawful(v, m));
      if (result.preservesImplication) { assert.equal(result.obstruction, null); passes++; }
      else {
        const w = result.obstruction, s = mask(d.atoms, w.current), q = mask(p.atoms, w.requested);
        assert.deepEqual(w.view, facts(p.atoms, v[s]));
        assert(subset(v[s], q)); assert.equal(w.requested.length, w.view.length + 1);
        assert(!v.some((value, u) => subset(s, u) && value === q));
        assert.equal(d.liftEvidence(binding, w.current, w.requested), null);
        // Reconstruct positive public A=up(q), B=up(q) minus {q}. Replay the
        // semantic failure using only the OLD residual/substitute implementation.
        const A = p.all(w.requested.map(n => p.atom(n)));
        const B = p.all([A, p.any(p.atoms.filter(n => !w.requested.includes(n)).map(n => p.atom(n)))]);
        const publicThenPrivate = pull(d, p, p.residual(A, B), binding);
        const privateThenResidual = d.residual(pull(d, p, A, binding), pull(d, p, B, binding));
        assert(!d.evaluate(publicThenPrivate, w.current));
        assert(d.evaluate(privateThenResidual, w.current));
        failures++; replayed++;
      }
      maps++;
    }
  }
  assert.equal(maps, 8421);
  t.diagnostic(JSON.stringify({ maps, passes, failures, replayed }));
});

test('the global audit is equivalent to residual commutation for every pair of two-public-atom contracts', t => {
  const tables = functions(3), d = createEvidenceAlgebra(['a', 'b', 'c']), fs = tables.map(f => contract(d, f));
  const p = createEvidenceAlgebra(['x', 'y']), publicContracts = functions(2).map(f => contract(p, f));
  let maps = 0, pairs = 0;
  for (const ids of tuples(tables.length, 2)) {
    const binding = ids.map((id, j) => ({ atom: p.atoms[j], value: fs[id] }));
    let allPreserved = true;
    for (const a of publicContracts) for (const b of publicContracts) {
      const left = pull(d, p, p.residual(a, b), binding);
      const right = d.residual(pull(d, p, a, binding), pull(d, p, b, binding));
      assert(d.entails(left, right)); // The unconditional one-sided guarantee.
      allPreserved &&= left === right;
      pairs++;
    }
    assert.equal(d.auditTransport(binding).preservesImplication, allPreserved); maps++;
  }
  assert.equal(pairs, 14400);
  t.diagnostic(JSON.stringify({ maps, pairs }));
});

test('minimum exact lifts agree with brute force for every small map and compatible request', t => {
  const tables = functions(3), d = createEvidenceAlgebra(['a', 'b', 'c']), fs = tables.map(f => contract(d, f));
  const publicNames = ['x', 'y'];
  let requests = 0, impossible = 0;
  for (const ids of tuples(tables.length, 2)) {
    const binding = ids.map((id, j) => ({ atom: publicNames[j], value: fs[id] })), v = views(ids.map(i => tables[i]));
    for (let s = 0; s < 8; s++) for (let q = 0; q < 4; q++) {
      if (!subset(v[s], q)) continue;
      for (const costs of [[1, 1, 1], [0, 3, 2]]) {
        const candidates = Array.from({ length: 8 }, (_, u) => u).filter(u => subset(s, u) && v[u] === q)
          .map(u => ({ u, added: facts(d.atoms, u & ~s), price: costs.reduce((n, c, i) => n + ((u & ~s & (1 << i)) ? c : 0), 0) }))
          .sort((a, b) => a.price - b.price || a.added.length - b.added.length);
        const before = d.stats.nodes;
        const result = d.liftEvidence(binding, facts(d.atoms, s), facts(publicNames, q), costs.map((cost, i) => ({ atom: d.atoms[i], cost })));
        assert.equal(d.stats.nodes, before);
        if (!candidates.length) { assert.equal(result, null); impossible++; }
        else {
          assert.equal(result.cost, candidates[0].price); assert.equal(result.added.length, candidates[0].added.length);
          const u = mask(d.atoms, result.facts);
          assert(subset(s, u)); assert.equal(v[u], q); assert.deepEqual(result.added, facts(d.atoms, u & ~s));
        }
        requests++;
      }
    }
  }
  t.diagnostic(JSON.stringify({ requests, impossible }));
});

test('lawful interfaces compose, but adding a redundant output can destroy lawfulness', t => {
  const d = createEvidenceAlgebra(['a', 'b']), p = createEvidenceAlgebra(['x', 'y']);
  const df = functions(2).map(f => contract(d, f)), pf = functions(2).map(f => contract(p, f));
  const maps = [...tuples(6, 2)]; let compositions = 0;
  for (const first of maps) {
    const f = first.map((id, j) => ({ atom: p.atoms[j], value: df[id] }));
    if (!d.auditTransport(f).preservesImplication) continue;
    for (const second of maps) {
      const g = second.map((id, j) => ({ atom: ['u', 'v'][j], value: pf[id] }));
      if (!p.auditTransport(g).preservesImplication) continue;
      const composite = g.map(({ atom, value }) => ({ atom, value: pull(d, p, value, f) }));
      assert(d.auditTransport(composite).preservesImplication); compositions++;
    }
  }
  const a = d.atom('a');
  assert(d.auditTransport([{ atom: 'x', value: a }]).preservesImplication);
  assert(!d.auditTransport([{ atom: 'x', value: a }, { atom: 'y', value: a }]).preservesImplication);
  t.diagnostic(JSON.stringify({ compositions }));
});

test('global surjectivity does not replace lifting from every current private state', () => {
  const d = createEvidenceAlgebra(['a', 'b', 'c']), [a, b, c] = d.atoms.map(n => d.atom(n));
  const bindings = [{ atom: 'p', value: d.any([a, d.all([b, c])]) }, { atom: 'q', value: b }];
  const observed = new Set(Array.from({ length: 8 }, (_, s) => bindings.reduce((m, b, j) => m | (+d.evaluate(b.value, facts(d.atoms, s)) << j), 0)));
  assert.equal(observed.size, 4);
  const audit = d.auditTransport(bindings);
  assert(!audit.preservesImplication);
  assert.deepEqual(audit.obstruction, { current: ['c'], view: [], requested: ['q'] });
  assert.equal(d.liftEvidence(bindings, ['c'], ['q']), null);
  assert.deepEqual(d.liftEvidence(bindings, [], ['q']).facts, ['b']);
});

test('exact public extensions compose, but sequentially cheapest lifts need not be globally cheapest', () => {
  const d = createEvidenceAlgebra(['a', 'b', 'c']), [a, b, c] = d.atoms.map(n => d.atom(n));
  const bindings = [{ atom: 'p', value: d.any([a, b]) }, { atom: 'q', value: d.any([a, c]) }];
  const prices = [{ atom: 'a', cost: 3 }, { atom: 'b', cost: 2 }, { atom: 'c', cost: 2 }];
  assert(d.auditTransport(bindings).preservesImplication);
  const first = d.liftEvidence(bindings, [], ['p'], prices);
  const second = d.liftEvidence(bindings, first.facts, ['p', 'q'], prices);
  const direct = d.liftEvidence(bindings, [], ['p', 'q'], prices);
  assert.deepEqual(first.facts, ['b']); assert.deepEqual(second.facts, ['b', 'c']);
  assert.equal(first.cost + second.cost, 4); assert.equal(direct.cost, 3); assert.deepEqual(direct.facts, ['a']);
});

test('adding summaries cannot repair a failed transport audit, even when all private facts become observable', t => {
  const tables = functions(3), d = createEvidenceAlgebra(['a', 'b', 'c']), fs = tables.map(f => contract(d, f));
  let extensions = 0;
  for (const ids of tuples(20, 2)) {
    const base = ids.map((id, j) => ({ atom: ['x', 'y'][j], value: fs[id] }));
    const audit = d.auditTransport(base);
    if (audit.preservesImplication) continue;
    for (const value of fs) {
      const extended = [...base, { atom: 'z', value }];
      assert(!d.auditTransport(extended).preservesImplication);
      const w = audit.obstruction;
      const requested = [...w.requested, ...(d.evaluate(value, w.current) ? ['z'] : [])];
      assert.equal(d.liftEvidence(extended, w.current, requested), null);
      extensions++;
    }
  }
  const h = createEvidenceAlgebra(['a', 'b']), a = h.atom('a'), b = h.atom('b');
  const bindings = [{ atom: 'x', value: a }, { atom: 'y', value: a }, { atom: 'fullA', value: a }, { atom: 'fullB', value: b }];
  const visible = createEvidenceAlgebra(bindings.map(b => b.atom));
  for (const f of functions(2)) assert(visible.abstract(contract(h, f), bindings).exact);
  assert(!h.auditTransport(bindings).preservesImplication);
  t.diagnostic(JSON.stringify({ persistentFailedExtensions: extensions }));
});
