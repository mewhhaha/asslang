// Shared HTTP/engine tests exercise the actual compiler, budgets and ABI adapter.
export async function runOutputFusionBrowserChecks({ compile, createCompiler }, createRuntime, report) {
  const assert = (ok, label) => { if (!ok) throw new Error(`Output fusion: ${label}`); report.checks++; };
  const source = `export fn main = (xs:[Num]) -> do {
    let h=scan xs 0 (s -> x -> s+x);
    {flags:map h (x -> x>0),values:h,last:fold h 0 (s -> x -> x)}
  };`;
  for (const simd of [false, true]) for (const reductionFusion of [false, true]) for (const memoizeReductions of [false, true]) {
    const budget = reductionFusion ? 3 : 9;
    const options = { simd, reductionFusion, memoizeReductions, maxLoopIterations: budget };
    const c = compile(source, options), stats = c.stats.functions[0];
    assert(stats.loops === (reductionFusion ? 1 : 3), 'one shared traversal or three independent traversals');
    assert(stats.stateMachines === (reductionFusion ? 1 : 3), 'state-machine copies');
    const r = await createRuntime(c), value = r.call('main', [[1, -2, 3]], { outputBytes: 40 });
    assert(value.last === 2 && Array.from(value.values).join(',') === '1,-1,2' && value.flags.join(',') === 'true,false,true', 'mixed dense outputs');
    let trap = false;
    try { r.call('main', [[1, -2, 3]], { outputBytes: 39 }); } catch (e) { trap = e instanceof WebAssembly.RuntimeError; }
    assert(trap, 'exact output capacity enforced');
    assert(r.call('main', [[]], { outputBytes: 0 }).last === 0, 'empty result and recovery');
    const small = await createRuntime(compile(source, { ...options, maxLoopIterations: budget - 1 }));
    trap = false;
    try { small.call('main', [[1, -2, 3]]); } catch (e) { trap = e instanceof WebAssembly.RuntimeError; }
    assert(trap, 'one fewer loop unit traps');
    assert(small.call('main', [[2]]).last === 2, 'fresh allowance after trap');
  }
  const sparse = compile('export fn main = (xs:[Num]) -> do {let h=filter (scan xs 0 (s -> x -> s+x)) (x -> x>99); {a:h,b:map h (x -> x>0)}};');
  assert(sparse.stats.functions[0].outputFusion.groups.length === 0, 'sparse fallback');
  const r = await createRuntime(sparse);
  assert(r.call('main', [[1, 2, 3]], { outputBytes: 0 }).a.length === 0, 'compact sparse output retained');
  const session = createCompiler(); session.compile(source).bytes.fill(0);
  const cached = session.compile(source);
  assert(cached.cache.hit && WebAssembly.validate(cached.bytes), 'cache artifact remains independent');
  report.cases.push({ name: 'causal-output-fusion', modes: 8, monitorLoops: 1, unfusedLoops: 3 });
}
