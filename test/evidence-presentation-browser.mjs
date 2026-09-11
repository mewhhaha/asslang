// Runs unchanged in the HTTP harness and fixed engine bundle.
export async function runEvidencePresentationBrowserChecks(compiler, createRuntime, report) {
  const { createEvidenceAlgebra, compileSources } = compiler;
  const assert = (ok, message) => { if (!ok) throw new Error(`Evidence presentation: ${message}`); report.checks++; };
  const d = createEvidenceAlgebra(['a', 'b']), a = d.atom('a'), b = d.atom('b');
  const bindings = [{ atom: 'x', value: a }, { atom: 'y', value: a }];
  const p = d.present(bindings);
  assert(!d.auditTransport(bindings).preservesImplication, 'free flag cube is too permissive');
  assert(p.auditTransport().preservesImplication, 'exact image laws restore transport');
  assert(p.atom('x') === p.atom('y'), 'laws identify equivalent public contracts');
  const residual = p.residual(p.atom('x'), p.atom('y'));
  assert(residual === p.always, 'residual recomputed in the quotient');
  const blocked = d.present([{ atom: 'x', value: a }, { atom: 'y', value: d.all([a, b]) }]);
  const failure = blocked.auditTransport().obstruction;
  assert(failure !== null && blocked.isRealizable(failure.requested), 'realizable but blocked future');
  const repaired = d.present([{ atom: 'x', value: a }, { atom: 'y', value: d.all([a, b]) }, { atom: 'z', value: b }]);
  assert(repaired.auditTransport().preservesImplication, 'more informative image restores lifting');
  const generated = p.source('accept', residual);
  for (const simd of [false, true]) for (const reductionFusion of [false, true]) {
    const src = [generated, { name: 'app.ass', source: 'export fn main = (x:Bool) -> (y:Bool) -> accept {x,y};' }];
    const c = compileSources(src, { simd, reductionFusion, maxLoopIterations: 0 }), r = await createRuntime(c);
    assert(r.call('main', [true, true]), 'valid public evidence');
    assert(r.call('main', [false, false]), 'valid bottom public state');
    let trapped = false;
    try { r.call('main', [true, false]); } catch (e) { trapped = e instanceof WebAssembly.RuntimeError; }
    assert(trapped, 'always predicate still rejects invalid schema');
    assert(c.stats.kernelHeapAllocationSites === 0, 'no guest graph or allocator');
    const free = d.present([{ atom: 'x', value: a }, { atom: 'y', value: b }]);
    const metered = [free.source('gate', free.all([free.atom('x'), free.atom('y')])), { name: 'metered.ass', source:
      'export fn main = (a:Num) -> (b:Num) -> gate {x:sum (range a)>=0,y:sum (range b)>=0};' }];
    const enough = await createRuntime(compileSources(metered, { simd, reductionFusion, maxLoopIterations: 7 }));
    assert(enough.call('main', [3, 4]), 'exact seven-unit allowance');
    const small = await createRuntime(compileSources(metered, { simd, reductionFusion, maxLoopIterations: 6 }));
    trapped = false;
    try { small.call('main', [3, 4]); } catch (e) { trapped = e instanceof WebAssembly.RuntimeError; }
    assert(trapped, 'six units trap'); assert(small.call('main', [1, 1]), 'fresh allowance after trap');
  }
  report.cases.push({ name: 'law-aware-evidence-presentations', modes: 4, schemaAndFutureDistinct: true });
}
