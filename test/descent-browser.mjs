// Invoked by the engine-only browser bundle with its actual compiler entry point.
export async function runDescentBrowserChecks(compiler, createRuntime, report) {
  const { compileSources, planDescent, verifyDescent, descentSource } = compiler;
  const assert = (condition, message) => {
    if (!condition) { report.status = 'FAIL'; throw new Error(`Descent: ${message}`); }
    report.checks++;
  };
  const graph = { nodes: ['x', 'y', 'z'], edges: [
    { from: 'x', to: 'z', map: 'zero' }, { from: 'y', to: 'z', map: 'zero' },
  ] };
  const patches = [
    { name: 'left', nodes: ['x', 'z'] }, { name: 'middle', nodes: ['x', 'y', 'z'] },
    { name: 'right', nodes: ['y', 'z'] },
  ];
  const plan = planDescent(graph, patches), generated = descentSource('assemble', graph, patches);
  assert(plan.minimumComparisons === 2 && plan.naiveComparisons === 5, 'exact overlap count');
  assert(verifyDescent(graph, patches, plan.comparisons), 'independent certificate verification');
  assert(!verifyDescent(graph, patches, plan.comparisons.slice(1)), 'incomplete certificate rejected');
  const shape = '{left:{x:Num,z:Num},middle:{x:Num,y:Num,z:Num},right:{y:Num,z:Num}}';
  const source = `fn equal = x -> y -> x==y;
    export fn join = (pieces:${shape}) -> (assemble {zero:x -> 0}).join {x:equal,y:equal,z:equal} pieces;
    export fn agree = (pieces:${shape}) -> (assemble {zero:x -> 0}).agree {x:equal,y:equal} pieces;`;
  const pieces = { left: { x: 3, z: 0 }, middle: { x: 3, y: 4, z: 0 }, right: { y: 4, z: 0 } };
  for (const simd of [false, true]) for (const reductionFusion of [false, true]) {
    const c = compileSources([generated, { name: 'app.ass', source }], { simd, reductionFusion, maxLoopIterations: 0 });
    const r = await createRuntime(c), joined = r.call('join', [pieces]);
    assert(joined.x === 3 && joined.y === 4 && joined.z === 0, 'checked assembly at zero loop allowance');
    const bad = structuredClone(pieces); bad.middle.z = 99;
    assert(r.call('agree', [bad]) === true, 'agreement is not a local coherence proof');
    let trapped = false;
    try { r.call('join', [bad]); } catch (error) { trapped = error instanceof WebAssembly.RuntimeError; }
    assert(trapped, 'join rejects local incoherence');
    assert(c.stats.kernelHeapAllocationSites === 0, 'no guest allocator');
    const metered = `fn eq = x -> y -> sum (range x)>=0 && x==y;
      export fn main = (x:Num) -> (y:Num) -> (a:Num) -> (b:Num) ->
      (assemble {zero:x -> 0}).agree {x:eq,y:eq} {left:{x,z:0},middle:{x:a,y,z:0},right:{y:b,z:0}};`;
    const sources = [generated, { name: 'metered.ass', source: metered }];
    const enough = await createRuntime(compileSources(sources, { simd, reductionFusion, maxLoopIterations: 7 }));
    assert(enough.call('main', [3, 4, 3, 4]) === true, 'seven-unit comparison boundary');
    const small = await createRuntime(compileSources(sources, { simd, reductionFusion, maxLoopIterations: 6 }));
    trapped = false;
    try { small.call('main', [3, 4, 3, 4]); } catch (error) { trapped = error instanceof WebAssembly.RuntimeError; }
    assert(trapped, 'six units cannot run seven comparison iterations');
    assert(small.call('main', [1, 1, 1, 1]) === true, 'fresh allowance after trap');
  }
  report.cases.push({ name: 'optimal-descent', modes: 4, minimumComparisons: 2, naiveComparisons: 5 });
}
