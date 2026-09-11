// Shared native HTTP / fixed engine-bundle integration tests.
export async function runDescentBatchBrowserChecks(compiler, createRuntime, report) {
  const { planDescentBatch, verifyDescentBatch, descentBatchSource, compileSources } = compiler;
  const assert = (ok, message) => { if (!ok) throw new Error(`Descent batch: ${message}`); report.checks++; };
  const graph = { nodes: ['raw', 'summary'], edges: [{ from: 'raw', to: 'summary', map: 'square' }] };
  const patches = [{ name: 'a', nodes: graph.nodes }, { name: 'b', nodes: graph.nodes }, { name: 'c', nodes: ['summary'] }];
  const options = { queries: [{ name: 'input', node: 'raw', left: 'a', right: 'b' }, { name: 'output', node: 'summary', left: 'a', right: 'c' }],
    candidates: [{ node: 'raw', left: 'a', right: 'b', cost: 4 }, { node: 'summary', left: 'b', right: 'c', cost: 1 }, { node: 'summary', left: 'a', right: 'c', cost: 3 }] };
  const plan = planDescentBatch(graph, patches, options), gen = descentBatchSource('batch', graph, patches, options);
  assert(plan.minimumCost === 5 && plan.additionalCount === 2, 'exact shared cost');
  assert(plan.frontier.minimal.length === 2 && plan.frontier.maximalFailures.length === 2, 'complete positive and negative boundaries');
  assert(verifyDescentBatch(graph, patches, options, plan), 'independent frontier and proof verification');
  const missing = structuredClone(plan); missing.frontier.minimal.pop();
  assert(!verifyDescentBatch(graph, patches, options, missing), 'missing nonselected alternative rejected');
  const shape = '{a:{raw:Num,summary:Num},b:{raw:Num,summary:Num},c:{summary:Num}}';
  const source = `fn eq = x -> y -> x==y;
    export fn main = (p:${shape}) -> (batch {square:x -> x*x}).select {raw:eq,summary:eq} p;
    export fn field = (p:${shape}) -> ((batch {square:x -> x*x}).select {raw:eq,summary:eq} p).input;`;
  const good = { a: { raw: 3, summary: 9 }, b: { raw: 3, summary: 9 }, c: { summary: 9 } };
  for (const simd of [false, true]) for (const reductionFusion of [false, true]) {
    const c = compileSources([gen, { name: 'app.ass', source }], { simd, reductionFusion, maxLoopIterations: 0 });
    const r = await createRuntime(c), result = r.call('main', [good]);
    assert(result.input === 3 && result.output === 9, 'shared guarded results');
    const bad = structuredClone(good); bad.c.summary = 10;
    let trapped = false;
    try { r.call('field', [bad]); } catch (e) { trapped = e instanceof WebAssembly.RuntimeError; }
    assert(trapped, 'projected field retains sibling goal guard');
    assert(c.stats.kernelHeapAllocationSites === 0, 'no new guest allocator');
    const metered = `fn costly = x -> y -> sum (range x)>=0 && x==y;
      export fn main = (a:Num) -> (b:Num) -> (c:Num) -> (d:Num) ->
      (batch {square:x -> x*x}).checkEvidence {raw:costly,summary:costly} {a:{raw:a,summary:0},b:{raw:b,summary:c},c:{summary:d}};`;
    const files = [gen, { name: 'metered.ass', source: metered }];
    const enough = await createRuntime(compileSources(files, { simd, reductionFusion, maxLoopIterations: 7 }));
    assert(enough.call('main', [3, 3, 4, 4]) === true, 'shared labels take seven iterations, not ten');
    const small = await createRuntime(compileSources(files, { simd, reductionFusion, maxLoopIterations: 6 }));
    trapped = false;
    try { small.call('main', [3, 3, 4, 4]); } catch (e) { trapped = e instanceof WebAssembly.RuntimeError; }
    assert(trapped, 'six iterations cannot complete seven');
    assert(small.call('main', [1, 1, 1, 1]) === true, 'fresh budget after trap');
  }
  report.cases.push({ name: 'shared-descent-frontier', modes: 4, sharedCost: 5, frontierSize: 2 });
}
