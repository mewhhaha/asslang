// Invoked with actual browser-bundled compiler exports, not a Node mock.
export async function runEvidenceAlgebraBrowserChecks(compiler, createRuntime, report) {
  const { createEvidenceAlgebra, compileSources } = compiler;
  const assert = (ok, message) => { if (!ok) throw new Error(`Evidence algebra: ${message}`); report.checks++; };
  const template = createEvidenceAlgebra(['a', 'b']), d = createEvidenceAlgebra(['x', 'y', 'z']);
  const x = d.atom('x'), choice = d.any([d.atom('y'), d.atom('z')]);
  const f = d.substitute(template.all([template.atom('a'), template.atom('b')]), [{ atom: 'a', value: x }, { atom: 'b', value: choice }]);
  assert(d.residual(choice, f) === x, 'principal residual after substitution');
  assert(d.fromFrontier([['x', 'y'], ['x', 'z']]) === f, 'canonical equivalent contracts');
  assert(d.minimum(f).cost === 2, 'minimum support');
  const witness = d.counterexample(x, f);
  assert(d.evaluate(x, witness) && !d.evaluate(f, witness), 'separating assignment');
  const generated = d.source('accept', f);
  for (const simd of [false, true]) for (const reductionFusion of [false, true]) {
    const source = 'export fn main = (a:Bool) -> (b:Bool) -> (c:Bool) -> accept {x:a,y:b,z:c};';
    const c = compileSources([generated, { name: 'app.ass', source }], { simd, reductionFusion, maxLoopIterations: 0 });
    const r = await createRuntime(c);
    assert(r.call('main', [true, false, true]) === true, 'instantiated source evaluates');
    assert(r.call('main', [false, true, true]) === false, 'missing fact rejected');
    const metered = [generated, { name: 'metered.ass', source: 'export fn main = (a:Num) -> (b:Num) -> accept {x:sum (range a)>=0,y:sum (range b)>=0,z:false};' }];
    const enough = await createRuntime(compileSources(metered, { simd, reductionFusion, maxLoopIterations: 7 }));
    assert(enough.call('main', [3, 4]) === true, 'seven-unit allowance');
    const small = await createRuntime(compileSources(metered, { simd, reductionFusion, maxLoopIterations: 6 }));
    let trap = false;
    try { small.call('main', [3, 4]); } catch (error) { trap = error instanceof WebAssembly.RuntimeError; }
    assert(trap, 'six units trap');
    assert(small.call('main', [1, 1]) === true, 'post-trap reset');
  }
  report.cases.push({ name: 'compositional-evidence-algebra', modes: 4, canonical: true });
}
