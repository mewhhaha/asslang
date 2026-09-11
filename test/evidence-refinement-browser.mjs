// Invoked from both native-module and bundled-browser test paths.
export async function runEvidenceRefinementBrowserChecks(compiler, createRuntime, report) {
  const { createEvidenceAlgebra, compileSources } = compiler;
  const assert = (ok, message) => { if (!ok) throw new Error(`Evidence refinement: ${message}`); report.checks++; };
  const d = createEvidenceAlgebra(['a', 'b', 'c']), [a, b, c] = d.atoms.map(n => d.atom(n));
  const targets = [{ name: 'first', value: d.all([a, b]) }, { name: 'second', value: d.all([a, c]) }];
  const retained = [{ atom: 'left', value: b }, { atom: 'right', value: c }];
  const candidates = [{ atom: 'shared', value: a, cost: 3 }, { atom: 'first', value: targets[0].value, cost: 2 }, { atom: 'second', value: targets[1].value, cost: 2 }];
  const options = { retained, candidates }, before = d.stats.nodes, plan = d.refine(targets, options);
  assert(plan.complete && plan.minimumCost === 3 && plan.selected.join(',') === '0', 'optimal shared repair');
  assert(d.stats.nodes === before, 'private session unchanged');
  assert(d.verifyRefinement(targets, options, JSON.parse(JSON.stringify(plan))), 'portable certificate replay');
  const forged = structuredClone(plan); forged.separations.pop();
  assert(!d.verifyRefinement(targets, options, forged), 'missing lower bound rejected');
  const impossibleOptions = { retained, candidates: [] };
  const impossible = d.refine(targets, impossibleOptions);
  assert(!impossible.complete && d.verifyRefinement(targets, impossibleOptions, impossible), 'unavailable repair certificate');
  const bindings = [...retained, ...plan.selected.map(i => candidates[i])];
  const view = createEvidenceAlgebra(bindings.map(b => b.atom));
  const results = targets.map(t => view.abstract(t.value, bindings));
  assert(results.every(r => r.exact), 'both requested targets exactly expressible');
  const generated = view.source('accept', view.all(results.map(r => r.sufficient)));
  for (const simd of [false, true]) for (const reductionFusion of [false, true]) {
    const app = 'export fn main = (a:Num) -> (b:Num) -> (c:Num) -> (require (accept {left:b>=0,right:c>=0,shared:a>=0}) {first:b,second:c}).first;';
    const compiled = compileSources([generated, { name: 'app.ass', source: app }], { simd, reductionFusion, maxLoopIterations: 0 });
    const runtime = await createRuntime(compiled);
    assert(runtime.call('main', [1, 3, 4]) === 3, 'current input guard');
    let trap = false;
    try { runtime.call('main', [1, 3, -4]); } catch (e) { trap = e instanceof WebAssembly.RuntimeError; }
    assert(trap, 'sibling requirement retained on projection');
    assert(compiled.stats.kernelHeapAllocationSites === 0, 'no guest allocator');
    const metered = [generated, { name: 'metered.ass', source: 'export fn main = (a:Num) -> (b:Num) -> accept {left:sum (range a)>=0,right:sum (range b)>=0,shared:true};' }];
    const enough = await createRuntime(compileSources(metered, { simd, reductionFusion, maxLoopIterations: 7 }));
    assert(enough.call('main', [3, 4]), 'exact seven-unit allowance');
    const small = await createRuntime(compileSources(metered, { simd, reductionFusion, maxLoopIterations: 6 }));
    trap = false;
    try { small.call('main', [3, 4]); } catch (e) { trap = e instanceof WebAssembly.RuntimeError; }
    assert(trap, 'six units cannot finish');
    assert(small.call('main', [1, 1]), 'fresh allowance after trap');
  }
  report.cases.push({ name: 'minimum-cost-interface-refinement', modes: 4, minimumCost: 3, witnessedClauses: 2 });
}
