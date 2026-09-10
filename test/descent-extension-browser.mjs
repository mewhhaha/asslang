// Run by both the native HTTP harness and the fixed engine-only test bundle.
export async function runDescentExtensionBrowserChecks(compiler, createRuntime, report) {
  const { planDescentExtension, descentCountermodel, descentExtensionSource, compileSources } = compiler;
  const assert = (condition, message) => { if (!condition) throw new Error(`Descent extension: ${message}`); report.checks++; };
  const graph = { nodes: ['x'], edges: [] }, patches = ['a', 'b', 'c', 'd'].map(name => ({ name, nodes: ['x'] }));
  const retained = [{ node: 'x', left: 'a', right: 'b' }];
  const candidates = [
    { node: 'x', left: 'a', right: 'c', cost: 9 },
    { node: 'x', left: 'b', right: 'c', cost: 2 },
    { node: 'x', left: 'c', right: 'd', cost: 1 },
  ];
  const p = planDescentExtension(graph, patches, { retained, candidates });
  assert(p.complete && p.minimumCost === 3 && p.minimumAdditional === 2, 'minimum-cost extension');
  assert(p.retainedRank === 1 && p.rank === 3, 'relative rank');
  assert(descentCountermodel(graph, patches, p.comparisons) === null, 'complete proof has no obstruction');
  const bad = planDescentExtension(graph, patches, { retained, candidates: [candidates[2]] });
  assert(!bad.complete && bad.minimumCost === null && bad.obstruction.witness.node === 'x', 'missing bridge gives finite obstruction');
  const gen = descentExtensionSource('extend', graph, patches, { retained, candidates });
  const source = `fn eq = x -> y -> x==y;
    export fn extra = (a:Num) -> (b:Num) -> (c:Num) -> (d:Num) ->
      (extend {}).checkAdditional {x:eq} {a:{x:a},b:{x:b},c:{x:c},d:{x:d}};
    export fn full = (a:Num) -> (b:Num) -> (c:Num) -> (d:Num) ->
      ((extend {}).join {x:eq} {a:{x:a},b:{x:b},c:{x:c},d:{x:d}}).x;`;
  for (const simd of [false, true]) for (const reductionFusion of [false, true]) {
    const c = compileSources([gen, { name: 'app.ass', source }], { simd, reductionFusion, maxLoopIterations: 0 });
    const r = await createRuntime(c);
    assert(r.call('full', [3, 3, 3, 3]) === 3, 'full checked join');
    assert(r.call('extra', [9, 3, 3, 3]) === true, 'conditional path states its assumptions');
    let trap = false;
    try { r.call('full', [9, 3, 3, 3]); } catch (e) { trap = e instanceof WebAssembly.RuntimeError; }
    assert(trap, 'full path rejects stale retained equality');
    assert(c.stats.kernelHeapAllocationSites === 0, 'no guest allocator');
    const metered = `fn eq = x -> y -> sum (range x)>=0 && x==y;
      export fn main = (b:Num) -> (c:Num) -> (d:Num) ->
        (extend {}).checkAdditional {x:eq} {a:{x:b},b:{x:b},c:{x:c},d:{x:d}};`;
    const inputs = [gen, { name: 'metered.ass', source: metered }];
    const enough = await createRuntime(compileSources(inputs, { simd, reductionFusion, maxLoopIterations: 6 }));
    assert(enough.call('main', [3, 3, 3]) === true, 'two three-iteration checks fit six units');
    const small = await createRuntime(compileSources(inputs, { simd, reductionFusion, maxLoopIterations: 5 }));
    trap = false;
    try { small.call('main', [3, 3, 3]); } catch (e) { trap = e instanceof WebAssembly.RuntimeError; }
    assert(trap, 'five units cannot complete six iterations');
    assert(small.call('main', [1, 1, 1]) === true, 'allowance reset after trap');
  }
  report.cases.push({ name: 'relative-descent', modes: 4, minimumCost: 3, retainedRank: 1, rank: 3 });
}
