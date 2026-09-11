// Shared native HTTP and engine-bundle checks; no browser-side test mocks.
export async function runEvidenceTransportBrowserChecks(compiler, createRuntime, report) {
  const { createEvidenceAlgebra, compileSources } = compiler;
  const assert = (ok, message) => { if (!ok) throw new Error(`Evidence transport: ${message}`); report.checks++; };
  const d = createEvidenceAlgebra(['a', 'b', 'c']), [a, b, c] = d.atoms.map(n => d.atom(n));
  const bs = [{ atom: 'p', value: d.any([a, b]) }, { atom: 'q', value: d.any([a, c]) }];
  const before = d.stats.nodes;
  assert(d.auditTransport(bs).preservesImplication, 'uniform implication transport');
  const prices = d.atoms.map((atom, i) => ({ atom, cost: [3, 2, 2][i] }));
  const direct = d.liftEvidence(bs, [], ['p', 'q'], prices);
  const first = d.liftEvidence(bs, [], ['p'], prices);
  const second = d.liftEvidence(bs, first.facts, ['p', 'q'], prices);
  assert(direct.cost === 3 && direct.facts.join(',') === 'a', 'globally cheapest exact lift');
  assert(first.cost + second.cost === 4, 'local optima do not compose');
  assert(d.stats.nodes === before, 'source session unchanged');
  const badBindings = [{ atom: 'x', value: a }, { atom: 'y', value: a }];
  const bad = d.auditTransport(badBindings);
  assert(!bad.preservesImplication && bad.obstruction.requested.length === 1, 'explicit missing extension');
  assert(d.liftEvidence(badBindings, bad.obstruction.current, bad.obstruction.requested) === null, 'failure replay');
  const p = createEvidenceAlgebra(['p', 'q']), f = p.residual(p.atom('p'), p.all(p.atoms.map(n => p.atom(n))));
  const translated = d.substitute(f, bs.filter(b => p.inspect(f).support.includes(b.atom)));
  assert(translated === d.residual(bs[0].value, d.all(bs.map(b => b.value))), 'residual equality');
  const generated = d.source('additional', translated);
  for (const simd of [false, true]) for (const reductionFusion of [false, true]) {
    const app = `export fn main = (a:Bool) -> (b:Bool) -> (c:Bool) ->
      (require ((a || b) && additional {a,c}) {value:7,other:9}).value;`;
    const compiled = compileSources([generated, { name: 'app.ass', source: app }], { simd, reductionFusion, maxLoopIterations: 0 });
    const r = await createRuntime(compiled);
    assert(r.call('main', [true, false, false]) === 7, 'guarded current facts');
    let trap = false;
    try { r.call('main', [false, false, true]); } catch (e) { trap = e instanceof WebAssembly.RuntimeError; }
    assert(trap, 'false guarantee cannot bypass projected guard');
    assert(compiled.stats.kernelHeapAllocationSites === 0, 'no guest allocator');
    const files = [generated, { name: 'loop.ass', source: 'export fn main = (a:Num) -> (b:Num) -> additional {a:sum (range a)<0,c:sum (range b)>=0};' }];
    const enough = await createRuntime(compileSources(files, { simd, reductionFusion, maxLoopIterations: 7 }));
    assert(enough.call('main', [3, 4]), 'seven iterations succeed');
    const small = await createRuntime(compileSources(files, { simd, reductionFusion, maxLoopIterations: 6 }));
    trap = false;
    try { small.call('main', [3, 4]); } catch (e) { trap = e instanceof WebAssembly.RuntimeError; }
    assert(trap, 'six iterations trap');
    assert(small.call('main', [1, 1]), 'fresh allowance after trap');
  }
  report.cases.push({ name: 'implication-preserving-transport', modes: 4, directCost: 3, sequentialCost: 4 });
}
