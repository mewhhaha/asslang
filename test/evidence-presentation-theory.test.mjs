import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceAlgebra, compileSources } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';

function monotone(n) {
  const result = [];
  for (let bits = 0; bits < 2 ** (2 ** n); bits++) {
    const truth = Array.from({ length: 2 ** n }, (_, i) => !!(bits & (1 << i)));
    if (truth.every((v, i) => !v || truth.every((w, j) => (i & j) !== i || w))) result.push(truth);
  }
  return result;
}
const names = n => Array.from({ length: n }, (_, i) => `x${i}`);
const facts = (ns, mask) => ns.filter((_, i) => mask & (1 << i));
const mask = (ns, fs) => fs.reduce((s, n) => s | (1 << ns.indexOf(n)), 0);
const below = (x, y) => (x & y) === x;
const implies = (a, b, states) => states.every(s => !a[s] || b[s]);
const raw = (d, t) => d.fromFrontier(t.flatMap((v, i) => v ? [facts(d.atoms, i)] : []));
function read(snapshot, fs) {
  let root = snapshot.root;
  while (root > 1) { const node = snapshot.nodes[root - 2]; root = fs.includes(node.atom) ? node.high : node.low; }
  return root === 1;
}

// All private assignments and image states are explicitly enumerated. No new BDD
// image/closure/audit operation is used in the oracle.
test('all 400 three-private/two-public maps give exact schemas, canonical quotients and Heyting adjunctions', t => {
  const df = monotone(3), pf = monotone(2), d = createEvidenceAlgebra(names(3));
  const inputs = df.map(f => raw(d, f));
  let maps = 0, imageChecks = 0, residualChecks = 0, adjunctions = 0, priceChecks = 0;
  for (let ai = 0; ai < df.length; ai++) for (let bi = 0; bi < df.length; bi++) {
    const before = d.stats.nodes;
    const q = d.present([{ atom: 'p', value: inputs[ai] }, { atom: 'q', value: inputs[bi] }]);
    const views = df[ai].map((v, s) => +v | (+df[bi][s] << 1));
    const states = [...new Set(views)];
    const schema = q.inspectLaws();
    for (let s = 0; s < 4; s++) {
      assert.equal(q.isRealizable(facts(q.atoms, s)), states.includes(s));
      assert.equal(read(schema, facts(q.atoms, s)), states.includes(s)); imageChecks++;
    }
    const contracts = pf.map(f => q.fromFrontier(f.flatMap((v, i) => v ? [facts(q.atoms, i)] : [])));
    const expectedCount = new Set(pf.map(f => states.map(s => +f[s]).join(''))).size;
    assert.equal(new Set(contracts).size, expectedCount);
    for (let a = 0; a < pf.length; a++) {
      const snapshot = q.inspect(contracts[a]);
      for (let s = 0; s < 4; s++) {
        const expected = states.some(v => pf[a][v] && below(v, s));
        assert.equal(read(snapshot, facts(q.atoms, s)), expected);
      }
      for (const prices of [[1, 1], [0, 3], [5, 0]]) {
        const choices = states.filter(s => pf[a][s]).map(s => ({ s, fs: facts(q.atoms, s) }))
          .map(c => ({ ...c, cost: c.fs.reduce((v, n) => v + prices[q.atoms.indexOf(n)], 0) }))
          .sort((a, b) => a.cost - b.cost || a.fs.length - b.fs.length);
        const best = q.minimum(contracts[a], q.atoms.map((atom, i) => ({ atom, cost: prices[i] })));
        if (!choices.length) assert.equal(best, null);
        else {
          assert.equal(best.cost, choices[0].cost); assert.equal(best.facts.length, choices[0].fs.length);
          assert(states.includes(mask(q.atoms, best.facts))); assert(q.evaluate(contracts[a], best.facts));
        }
        priceChecks++;
      }
      for (let b = 0; b < pf.length; b++) {
        assert.equal(contracts[a] === contracts[b], states.every(s => pf[a][s] === pf[b][s]));
        assert.equal(q.entails(contracts[a], contracts[b]), implies(pf[a], pf[b], states));
        const counterexample = q.counterexample(contracts[a], contracts[b]);
        if (implies(pf[a], pf[b], states)) assert.equal(counterexample, null);
        else {
          const c = mask(q.atoms, counterexample); assert(states.includes(c)); assert(pf[a][c] && !pf[b][c]);
        }
        const r = q.residual(contracts[a], contracts[b]);
        const rt = Array.from({ length: 4 }, (_, s) => states.every(v => !below(s, v) || !pf[a][v] || pf[b][v]));
        for (const s of states) { assert.equal(q.evaluate(r, facts(q.atoms, s)), rt[s]); residualChecks++; }
        for (let w = 0; w < pf.length; w++) {
          assert.equal(q.entails(q.all([contracts[w], contracts[a]]), contracts[b]), q.entails(contracts[w], r));
          assert.equal(implies(pf[w].map((v, i) => v && pf[a][i]), pf[b], states), implies(pf[w], rt, states));
          adjunctions++;
        }
      }
    }
    assert.equal(d.stats.nodes, before); maps++;
  }
  t.diagnostic(JSON.stringify({ maps, imageChecks, residualChecks, adjunctions, priceChecks }));
});

test('relative transport and separating formulas agree with all 400 three-private/two-public image maps', t => {
  const df = monotone(3), pf = monotone(2), d = createEvidenceAlgebra(names(3)), e = createEvidenceAlgebra(['p', 'q']);
  const inputs = df.map(f => raw(d, f)), formulas = pf.map(f => raw(e, f));
  let maps = 0, passes = 0, failures = 0, lawRepairs = 0, formulaPairs = 0;
  for (let a = 0; a < df.length; a++) for (let b = 0; b < df.length; b++) {
    const bindings = [{ atom: 'p', value: inputs[a] }, { atom: 'q', value: inputs[b] }];
    const q = d.present(bindings), views = df[a].map((v, s) => +v | (+df[b][s] << 1));
    const states = [...new Set(views)];
    const expected = views.every((view, s) => states.every(v => !below(view, v) ||
      views.some((next, u) => below(s, u) && v === next)));
    const report = q.auditTransport(); assert.equal(report.preservesImplication, expected);
    const outside = d.auditTransport(bindings).preservesImplication;
    if (expected && !outside) lawRepairs++;
    const qs = pf.map(f => q.fromFrontier(f.flatMap((v, s) => v ? [facts(q.atoms, s)] : [])));
    let allCommute = true;
    for (let g = 0; g < pf.length; g++) for (let h = 0; h < pf.length; h++) {
      const r = q.residual(qs[g], qs[h]);
      const sg = views.map(v => pf[g][v]), sh = views.map(v => pf[h][v]);
      for (let s = 0; s < 8; s++) {
        const privateResidual = sg.every((yes, u) => !below(s, u) || !yes || sh[u]);
        const publicResidual = q.evaluate(r, facts(q.atoms, views[s]));
        assert(!publicResidual || privateResidual);
        if (privateResidual !== publicResidual) allCommute = false;
      }
      formulaPairs++;
    }
    assert.equal(allCommute, expected);
    if (expected) { assert.equal(report.obstruction, null); passes++; }
    else {
      const o = report.obstruction, s = mask(d.atoms, o.current), v = mask(d.atoms, o.realizableWitness);
      const target = mask(q.atoms, o.requested);
      assert.equal(views[v], target); assert(below(views[s], target));
      assert(!views.some((r, u) => below(s, u) && r === target));
      const g = e.fromFrontier(o.guarantee), h = e.fromFrontier(o.target);
      const sg = d.substitute(g, bindings.filter(b => e.inspect(g).support.includes(b.atom)));
      const sh = d.substitute(h, bindings.filter(b => e.inspect(h).support.includes(b.atom)));
      assert(d.evaluate(d.residual(sg, sh), o.current));
      assert(!q.evaluate(q.residual(q.fromFrontier(o.guarantee), q.fromFrontier(o.target)), o.view));
      failures++;
    }
    maps++;
  }
  t.diagnostic(JSON.stringify({ maps, passes, failures, lawRepairs, formulaPairs }));
});

test('all 216 two-private/three-public maps check multi-bit image covers rather than one-bit guesses', t => {
  const tf = monotone(2), d = createEvidenceAlgebra(['a', 'b']), hs = tf.map(f => raw(d, f));
  let maps = 0, passes = 0;
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) {
    const bs = [a, b, c].map((i, j) => ({ atom: `p${j}`, value: hs[i] }));
    const q = d.present(bs), views = Array.from({ length: 4 }, (_, s) => +tf[a][s] | (+tf[b][s] << 1) | (+tf[c][s] << 2));
    const image = [...new Set(views)];
    const expected = views.every((v, s) => image.every(t => !below(v, t) || views.some((w, u) => below(s, u) && w === t)));
    assert.equal(q.auditTransport().preservesImplication, expected);
    for (let s = 0; s < 8; s++) assert.equal(q.isRealizable(facts(q.atoms, s)), image.includes(s));
    maps++; passes += +expected;
  }
  t.diagnostic(JSON.stringify({ maps, passes }));
});

test('compiled public and private residuals match image semantics for every two-private/two-public map', async t => {
  const fs = monotone(2), d = createEvidenceAlgebra(['a', 'b']), hs = fs.map(f => raw(d, f));
  let programs = 0, evaluations = 0;
  for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) {
    const q = d.present([{ atom: 'p', value: hs[x] }, { atom: 'q', value: hs[y] }]);
    const image = [...new Set(Array.from({ length: 4 }, (_, s) => +fs[x][s] | (+fs[y][s] << 1)))];
    const cs = fs.map(f => q.fromFrontier(f.flatMap((v, s) => v ? [facts(q.atoms, s)] : [])));
    for (let g = 0; g < 6; g++) for (let h = 0; h < 6; h++) {
      const r = q.residual(cs[g], cs[h]);
      const source = `export fn publicValue = (p:Bool) -> (q:Bool) -> publicGate {p,q};
        export fn privateValue = (a:Bool) -> (b:Bool) -> privateGate {a,b};`;
      const run = await createRuntime(compileSources([q.source('publicGate', r), q.sourcePrivate('privateGate', r), { name: 'app.ass', source }], { maxLoopIterations: 0 }));
      for (let s = 0; s < 4; s++) {
        if (!image.includes(s)) assert.throws(() => run.call('publicValue', [!!(s & 1), !!(s & 2)]), WebAssembly.RuntimeError);
        else assert.equal(run.call('publicValue', [!!(s & 1), !!(s & 2)]), image.every(t => !below(s, t) || !fs[g][t] || fs[h][t]));
        const v = +fs[x][s] | (+fs[y][s] << 1);
        assert.equal(run.call('privateValue', [!!(s & 1), !!(s & 2)]), image.every(t => !below(v, t) || !fs[g][t] || fs[h][t]));
        evaluations += 2;
      }
      programs++;
    }
  }
  t.diagnostic(JSON.stringify({ programs, evaluations }));
});
