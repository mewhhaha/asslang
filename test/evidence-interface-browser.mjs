// New interface checks execute with real compiler modules in the engine bundle.
export async function runEvidenceInterfaceBrowserChecks(compiler, createRuntime, report) {
  const { createEvidenceAlgebra, compileSources } = compiler;
  const assert = (ok, message) => { if (!ok) throw new Error(`Evidence interface: ${message}`); report.checks++; };
  const d = createEvidenceAlgebra(['leftValid', 'rightValid', 'reviewed']);
  const [left, right, reviewed] = d.atoms.map(n => d.atom(n)), f = d.all([left, right]);
  const e = createEvidenceAlgebra(['someValid', 'reviewedPair']);
  const meanings = [{ atom: 'someValid', value: d.any([left, right]) }, { atom: 'reviewedPair', value: d.all([f, reviewed]) }];
  const before = d.stats.nodes, p = e.abstract(f, meanings);
  assert(!p.exact && p.necessary === e.atom('someValid'), 'strongest necessary summary');
  assert(p.sufficient === e.atom('reviewedPair'), 'weakest sufficient admission rule');
  assert(d.stats.nodes === before, 'private session remains read-only');
  assert(d.evaluate(f, p.obstruction.satisfying) && !d.evaluate(f, p.obstruction.failing), 'separating private assignments');
  const precise = createEvidenceAlgebra(['pair']);
  assert(precise.abstract(f, [{ atom: 'pair', value: f }]).exact, 'refining interface restores exactness');
  const concrete = d.substitute(p.sufficient, meanings.filter(b => e.inspect(p.sufficient).support.includes(b.atom)));
  const generated = d.source('accept', concrete);
  for (const simd of [false, true]) for (const reductionFusion of [false, true]) {
    const app = 'export fn main = (a:Num) -> (b:Num) -> (reviewed:Bool) -> require (accept {leftValid:a>=0,rightValid:b>=0,reviewed}) (a+b);';
    const c = compileSources([generated, { name: 'app.ass', source: app }], { simd, reductionFusion, maxLoopIterations: 0 });
    const r = await createRuntime(c);
    assert(r.call('main', [3, 4, true]) === 7, 'guard accepts valid current inputs');
    let trap = false;
    try { r.call('main', [-3, 4, true]); } catch (error) { trap = error instanceof WebAssembly.RuntimeError; }
    assert(trap, 'invalid current input cannot pass a necessary-only summary');
    trap = false;
    try { r.call('main', [3, 4, false]); } catch (error) { trap = error instanceof WebAssembly.RuntimeError; }
    assert(trap, 'coarse sufficient interface conservatively rejects unreviewed input');
    assert(c.stats.kernelHeapAllocationSites === 0, 'no new guest allocator');
    const metered = [generated, { name: 'loops.ass', source: 'export fn main = (a:Num) -> (b:Num) -> accept {leftValid:sum (range a)>=0,rightValid:sum (range b)>=0,reviewed:true};' }];
    const enough = await createRuntime(compileSources(metered, { simd, reductionFusion, maxLoopIterations: 7 }));
    assert(enough.call('main', [3, 4]) === true, 'seven-unit exact budget');
    const small = await createRuntime(compileSources(metered, { simd, reductionFusion, maxLoopIterations: 6 }));
    trap = false;
    try { small.call('main', [3, 4]); } catch (error) { trap = error instanceof WebAssembly.RuntimeError; }
    assert(trap, 'six-unit budget exhausts');
    assert(small.call('main', [1, 1]) === true, 'fresh budget after trap');
  }
  report.cases.push({ name: 'principal-evidence-interfaces', modes: 4, adjoints: 2, separatingWitness: true });
}
