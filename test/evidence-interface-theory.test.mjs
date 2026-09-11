import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceAlgebra } from '../src/compiler.mjs';

// Independent complete truth tables, not the implementation's decision-diagram
// quantification or public/private root comparisons.
function functions(n) {
  const result = [];
  for (let code = 0; code < 2 ** (2 ** n); code++) {
    const table = Array.from({ length: 2 ** n }, (_, s) => !!(code & (1 << s)));
    if (table.every((v, s) => !v || table.every((w, t) => (s & t) !== s || w))) result.push(table);
  }
  return result;
}
const support = (names, mask) => names.filter((_, i) => mask & (1 << i));
const mask = (names, facts) => facts.reduce((m, n) => m | (1 << names.indexOf(n)), 0);
const contract = (d, table) => d.fromFrontier(table.flatMap((yes, m) => yes ? [support(d.atoms, m)] : []));
const replacements = (d, f, meanings) => meanings.filter(b => d.inspect(f).support.includes(b.atom));
const instantiate = (privateAlgebra, publicAlgebra, f, meanings) =>
  privateAlgebra.substitute(f, replacements(publicAlgebra, f, meanings));
const implies = (a, b) => a.every((v, i) => !v || b[i]);

function checkWitness(result, f, views, privateNames, publicNames) {
  const o = result.obstruction;
  const p = mask(privateNames, o.satisfying), n = mask(privateNames, o.failing);
  assert(f[p]); assert(!f[n]); assert.equal(views[p] & views[n], views[p]);
  assert.deepEqual(o.satisfyingView, support(publicNames, views[p]));
  assert.deepEqual(o.failingView, support(publicNames, views[n]));
}

test('all 8,000 private-target/two-summary combinations have exact principal adjoints and loss witnesses', t => {
  const tables = functions(3), abstracts = functions(2);
  assert.equal(tables.length, 20); assert.equal(abstracts.length, 6);
  const d = createEvidenceAlgebra(['a', 'b', 'c']), e = createEvidenceAlgebra(['x', 'y']);
  const fs = tables.map(f => contract(d, f));
  let cases = 0, valuations = 0, adjunctions = 0, exact = 0, obstructions = 0;
  for (let a = 0; a < tables.length; a++) for (let b = 0; b < tables.length; b++) {
    const meanings = [{ atom: 'x', value: fs[a] }, { atom: 'y', value: fs[b] }];
    const views = tables[a].map((yes, s) => +yes | (+tables[b][s] << 1));
    for (let i = 0; i < tables.length; i++) {
      const f = tables[i], before = d.stats.nodes, result = e.abstract(fs[i], meanings);
      assert.equal(d.stats.nodes, before, 'a separate private session is read-only');
      const necessary = [], sufficient = [];
      for (let view = 0; view < 4; view++) {
        necessary.push(f.some((yes, s) => yes && (views[s] & view) === views[s]));
        sufficient.push(f.every((yes, s) => (views[s] & view) !== view || yes));
        assert.equal(e.evaluate(result.necessary, support(e.atoms, view)), necessary[view]);
        assert.equal(e.evaluate(result.sufficient, support(e.atoms, view)), sufficient[view]);
        valuations += 2;
      }
      const expressible = abstracts.some(a => f.every((yes, s) => yes === a[views[s]]));
      assert.equal(result.exact, expressible);
      if (expressible) { assert.equal(result.obstruction, null); exact++; }
      else { checkWitness(result, f, views, d.atoms, e.atoms); obstructions++; }
      for (const a of abstracts) {
        const concrete = views.map(v => a[v]);
        assert.equal(implies(necessary, a), implies(f, concrete));
        assert.equal(implies(concrete, f), implies(a, sufficient));
        adjunctions += 2;
      }
      cases++;
    }
  }
  assert.equal(cases, 8000); assert.equal(valuations, 64000); assert.equal(adjunctions, 96000);
  t.diagnostic(JSON.stringify({ cases, valuations, adjunctions, exact, obstructions }));
});

test('all two-atom observation maps obey both adjoint composition laws', t => {
  const tables = functions(2);
  const d = createEvidenceAlgebra(['a', 'b']), e = createEvidenceAlgebra(['x', 'y']), p = createEvidenceAlgebra(['u', 'v']);
  const df = tables.map(f => contract(d, f)), ef = tables.map(f => contract(e, f));
  let cases = 0;
  for (const x of df) for (const y of df) {
    const first = [{ atom: 'x', value: x }, { atom: 'y', value: y }];
    for (const u of ef) for (const v of ef) {
      const second = [{ atom: 'u', value: u }, { atom: 'v', value: v }];
      const composed = second.map(b => ({ atom: b.atom, value: instantiate(d, e, b.value, first) }));
      for (const f of df) {
        const intermediate = e.abstract(f, first), direct = p.abstract(f, composed);
        assert.equal(p.abstract(intermediate.necessary, second).necessary, direct.necessary);
        assert.equal(p.abstract(intermediate.sufficient, second).sufficient, direct.sufficient);
        cases++;
      }
    }
  }
  assert.equal(cases, 7776); t.diagnostic(JSON.stringify({ compositionCases: cases }));
});

test('the right adjoint commutes with a public residual in all two-atom cases', t => {
  const tables = functions(2), d = createEvidenceAlgebra(['a', 'b']), e = createEvidenceAlgebra(['x', 'y']);
  const df = tables.map(f => contract(d, f)), ef = tables.map(f => contract(e, f));
  let cases = 0;
  for (const x of df) for (const y of df) {
    const meanings = [{ atom: 'x', value: x }, { atom: 'y', value: y }];
    for (const f of df) for (const g of ef) {
      const pulledGuarantee = instantiate(d, e, g, meanings);
      const left = e.abstract(d.residual(pulledGuarantee, f), meanings).sufficient;
      const right = e.residual(g, e.abstract(f, meanings).sufficient);
      assert.equal(left, right); cases++;
    }
  }
  assert.equal(cases, 1296); t.diagnostic(JSON.stringify({ residualCases: cases }));
});

test('projection hides private atoms by exact existential/total cofactors, not name erasure', () => {
  const d = createEvidenceAlgebra(['shown', 'secret']), e = createEvidenceAlgebra(['public']);
  const [shown, secret] = d.atoms.map(n => d.atom(n));
  const meanings = [{ atom: 'public', value: shown }];
  const conjunction = e.abstract(d.all([shown, secret]), meanings);
  assert.equal(conjunction.necessary, e.atom('public')); assert.equal(conjunction.sufficient, e.never);
  const disjunction = e.abstract(d.any([shown, secret]), meanings);
  assert.equal(disjunction.necessary, e.always); assert.equal(disjunction.sufficient, e.atom('public'));
});

test('unreachable public valuations do not invalidate exactness or authenticate arbitrary flags', () => {
  const d = createEvidenceAlgebra(['private']), e = createEvidenceAlgebra(['alwaysTrue', 'alwaysFalse']);
  const meanings = [{ atom: 'alwaysTrue', value: d.always }, { atom: 'alwaysFalse', value: d.never }];
  const t = e.abstract(d.always, meanings), f = e.abstract(d.never, meanings);
  assert(t.exact && f.exact); assert.equal(t.obstruction, null);
  assert.equal(t.necessary, e.atom('alwaysTrue')); assert.equal(t.sufficient, e.always);
  assert.equal(f.necessary, e.never); assert.equal(f.sufficient, e.atom('alwaysFalse'));
  assert(e.evaluate(f.sufficient, ['alwaysFalse'])); // Forged/unreachable flag, NOT a proof of private false.
  assert(!d.evaluate(instantiate(d, e, f.sufficient, meanings), []));
});

test('monotone expressibility can fail even when the separating views are distinct', () => {
  // A private pair satisfying a and not b has view {first}. The failing b-only
  // assignment has view {first,second}; a monotone interface cannot separate it.
  const d = createEvidenceAlgebra(['a', 'b']), e = createEvidenceAlgebra(['first', 'second']);
  const a = d.atom('a'), b = d.atom('b');
  const result = e.abstract(a, [{ atom: 'first', value: d.any([a, b]) }, { atom: 'second', value: b }]);
  assert(!result.exact);
  assert.deepEqual(result.obstruction.satisfyingView, ['first']);
  assert.deepEqual(result.obstruction.failingView, ['first', 'second']);
});

test('actual generated public contracts satisfy both bounds for every two-private-atom interface', async t => {
  // Compile each of the 36 possible two-summary maps and six private targets.
  const { compileSources } = await import('../src/compiler.mjs');
  const { createRuntime } = await import('../src/abi.mjs');
  const tables = functions(2), d = createEvidenceAlgebra(['a', 'b']), e = createEvidenceAlgebra(['x', 'y']);
  const fs = tables.map(f => contract(d, f));
  let programs = 0, evaluations = 0;
  for (let x = 0; x < fs.length; x++) for (let y = 0; y < fs.length; y++) for (let f = 0; f < fs.length; f++) {
    const p = e.abstract(fs[f], [{ atom: 'x', value: fs[x] }, { atom: 'y', value: fs[y] }]);
    const sources = [d.source('viewX', fs[x]), d.source('viewY', fs[y]), d.source('privateTarget', fs[f]),
      e.source('necessary', p.necessary), e.source('sufficient', p.sufficient), { name: 'app.ass', source: `
        export fn main = (a:Bool) -> (b:Bool) -> do {
          let facts={a,b}; let view={x:viewX facts,y:viewY facts};
          {target:privateTarget facts,necessary:necessary view,sufficient:sufficient view}
        };
      ` }];
    const r = await createRuntime(compileSources(sources, { maxLoopIterations: 0 }));
    for (let s = 0; s < 4; s++) {
      const v = r.call('main', [!!(s & 1), !!(s & 2)]);
      assert.equal(v.target, tables[f][s]);
      assert(!v.sufficient || v.target); assert(!v.target || v.necessary);
      if (p.exact) assert(v.necessary === v.target && v.sufficient === v.target);
      evaluations++;
    }
    programs++;
  }
  assert.equal(programs, 216); assert.equal(evaluations, 864);
  t.diagnostic(JSON.stringify({ programs, evaluations }));
});
