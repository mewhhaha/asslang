// Shared by the native HTTP harness and the fixed engine bundle.
export async function runDescentQueryBrowserChecks(compiler, createRuntime, report) {
  const { planDescentQuery, verifyDescentQuery, verifyDescentQueryCost, descentQuerySource, compileSources } = compiler;
  const assert = (ok, message) => { if (!ok) throw new Error(`Descent query: ${message}`); report.checks++; };
  const graph = { nodes: ['raw', 'summary'], edges: [{ from: 'raw', to: 'summary', map: 'square' }] };
  const patches = [{ name: 'a', nodes: graph.nodes }, { name: 'b', nodes: graph.nodes },
    { name: 'c', nodes: ['summary'] }, { name: 'unused', nodes: graph.nodes }];
  const options = { query: { node: 'summary', left: 'a', right: 'c' }, candidates: [
    { node: 'raw', left: 'a', right: 'b', cost: 1 }, { node: 'summary', left: 'b', right: 'c', cost: 2 },
    { node: 'summary', left: 'a', right: 'c', cost: 9 },
  ] };
  const p = planDescentQuery(graph, patches, options), gen = descentQuerySource('goal', graph, patches, options);
  assert(p.minimumCost === 3 && p.additionalCount === 2, 'minimum single-goal evidence cost');
  assert(verifyDescentQuery(graph, patches, options, p.proof), 'transport proof replay');
  assert(verifyDescentQueryCost(graph, patches, options, p.proof, p.potentials), 'dual optimality certificate');
  const expensive = [{ kind: 'candidate', index: 2, from: 'a', to: 'c', transport: [] }];
  assert(!verifyDescentQueryCost(graph, patches, options, expensive, p.potentials), 'nonoptimal proof rejected');
  const impossible = planDescentQuery(graph, patches, { query: { ...options.query, right: 'unused' }, candidates: options.candidates });
  assert(!impossible.complete && impossible.obstruction.witness.right === 'unused', 'goal-specific countermodel');
  const shape = '{a:{raw:Num,summary:Num},b:{raw:Num,summary:Num},c:{summary:Num}}';
  const source = `fn eq = x -> y -> x==y;
    export fn main = (p:${shape}) -> (goal {square:x -> x*x}).select {raw:eq,summary:eq} p;`;
  const good = { a: { raw: 3, summary: 9 }, b: { raw: 3, summary: 9 }, c: { summary: 9 } };
  for (const simd of [false, true]) for (const reductionFusion of [false, true]) {
    const c = compileSources([gen, { name: 'app.ass', source }], { simd, reductionFusion, maxLoopIterations: 0 });
    const r = await createRuntime(c);
    assert(r.call('main', [good]) === 9, 'support-shaped guarded selection');
    const bad = structuredClone(good); bad.a.summary = 10;
    let trapped = false;
    try { r.call('main', [bad]); } catch (e) { trapped = e instanceof WebAssembly.RuntimeError; }
    assert(trapped, 'support-local incoherence rejected');
    assert(c.stats.kernelHeapAllocationSites === 0, 'no guest allocator');
    const metered = `fn eq = x -> y -> x==y;
      export fn main = (a:Num) -> (b:Num) -> (goal {square:x -> sum (range x)}).check {raw:eq,summary:eq}
      {a:{raw:a,summary:3},b:{raw:b,summary:3},c:{summary:3}};`;
    const files = [gen, { name: 'metered.ass', source: metered }];
    const enough = await createRuntime(compileSources(files, { simd, reductionFusion, maxLoopIterations: 6 }));
    assert(enough.call('main', [3, 3]) === true, 'six-unit local transport budget');
    const small = await createRuntime(compileSources(files, { simd, reductionFusion, maxLoopIterations: 5 }));
    trapped = false;
    try { small.call('main', [3, 3]); } catch (e) { trapped = e instanceof WebAssembly.RuntimeError; }
    assert(trapped, 'five units cannot complete six local iterations');
    assert(small.call('main', [1, 1]) === false, 'fresh allowance after trap');
  }
  report.cases.push({ name: 'query-directed-descent', modes: 4, minimumEvidenceCost: 3, dualCertificate: true });
}
