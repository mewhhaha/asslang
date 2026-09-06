import test from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { compile, instantiate, verifyCertificate } from '../src/compiler.mjs';
import { parse, infer } from '../src/frontend.mjs';
import { stage } from '../src/jte.mjs';
import { planReductionFusion } from '../src/fusion.mjs';
import { reference } from './reference.mjs';

const enabled = { experimentalReductionFusion: true };
const stats = c => c.stats.functions[0];
function equivalent(actual, expected) {
  if (typeof expected === 'boolean') expected = Number(expected);
  assert.ok(Object.is(actual, expected) || Number.isNaN(actual) && Number.isNaN(expected),
    `${actual} differs from ${expected}`);
}
async function check(source, args = []) {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
  const input = new Float64Array(memory.buffer), abi = [];
  let offset = 0;
  for (const arg of args) {
    if (Array.isArray(arg)) { input.set(arg, offset); abi.push(offset * 8, arg.length); offset += arg.length; }
    else abi.push(arg);
  }
  const baseline = compile(source, { reductionFusion: false }), fused = compile(source, enabled);
  const a = await instantiate(baseline, { memory }), b = await instantiate(fused, { memory });
  const expected = reference(source, 'main', args);
  equivalent(a.exports.main(...abi), expected);
  equivalent(b.exports.main(...abi), expected);
  assert.deepEqual(fused.certificate, baseline.certificate);
  return { baseline, fused, instance: b, memory, abi };
}

// Ported from PR #1. Dense stateless count is already O(1) in 0.2, so its
// former loop is not a fusion opportunity. Explicit counting folds below keep
// tests of two independent reductions distinct from this separate optimization.
test('fusion is enabled by default, deterministic and validates its legacy option', () => {
  const s = 'export fn main(xs) = sum(xs) + count(xs);';
  const baseline = compile(s), off = compile(s, { experimentalReductionFusion: false });
  assert.deepEqual(baseline.bytes, off.bytes);
  assert.equal(stats(baseline).loops, 1);
  assert.equal(stats(baseline).reductionFusion.enabled, true);
  const a = compile(s, enabled), b = compile(s, enabled);
  assert.deepEqual(a.bytes, b.bytes);
  assert.deepEqual(a.stats.functions, b.stats.functions);
  assert.equal(verifyCertificate(a.certificate.steps), true);
  for (const value of [1, 0, 'true', null, {}]) {
    assert.throws(() => compile(s, { experimentalReductionFusion: value }), TypeError);
  }
});

test('shared-domain reductions become one loop without a runtime', async () => {
  const s = `export fn main(n) = { let xs = range(n);
    sum(xs) + sum(map(xs, x=>x*x)) + count(xs) };`;
  for (const n of [0, 1, 10, 100]) {
    const { baseline, fused } = await check(s, [n]);
    assert.equal(stats(baseline).loops, 2);
    assert.equal(stats(fused).loops, 1);
    assert.equal(stats(fused).reductionFusion.eliminatedLoops, 1);
    assert.equal(stats(fused).reductionFusion.groups[0].reductions.length, 2);
    assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(fused.bytes)), []);
  }
});

test('shared filters and map DAGs fuse without materialization', async () => {
  const s = `export fn main(xs) = { let selected = filter(xs,x=>x>0);
    let ys = map(selected,x=>sqrt(x)+2);
    sum(ys) + sum(map(ys,x=>x*x)) + count(selected) };`;
  for (const xs of [[], [-3, 0], [1], [1, 4, -2, 9]]) {
    const { fused } = await check(s, [xs]);
    assert.equal(stats(fused).loops, 1);
    assert.equal(fused.stats.intermediateBufferBytes, 0);
    assert.equal(fused.stats.kernelHeapAllocationSites, 0);
  }
});

test('independent folds retain separate initial values and left-to-right order', async () => {
  const s = `export fn main(xs) = fold(xs,17,(a,x)=>a-x)
    + fold(xs,2,(a,x)=>a*x) + sum(xs);`;
  for (const xs of [[], [2], [1e16, 1, -1e16], [2, 3, 4]]) {
    const { fused } = await check(s, [xs]);
    assert.equal(stats(fused).loops, 1);
  }
});

test('NaN, infinity, subnormal values and signed zero match baseline and reference', async () => {
  const programs = [
    'export fn main(xs)=sum(xs)+sum(map(xs,x=>x*x))+count(xs);',
    'export fn main(xs)=fold(xs,-0,(a,x)=>a*x)*fold(xs,1,(a,x)=>a+x);',
    'export fn main(xs)=fold(xs,0,(a,x)=>min(a,x))+fold(xs,-0,(a,x)=>max(a,x));',
  ];
  for (const s of programs) for (const xs of [[], [0], [-0], [NaN], [Infinity],
    [-Infinity, Infinity], [Number.MIN_VALUE, -Number.MIN_VALUE], [1e16, 1, -1e16]]) {
    await check(s, [xs]);
  }
});

test('count and ignoring folds do not demand a trapping mapped item', async () => {
  const s = `export fn main(n) = { let xs = range(n);
    let bad = map(xs,x=>sum(range(-1)));
    count(bad) + fold(bad,0,(a,x)=>a+1) + sum(xs) };`;
  const { fused } = await check(s, [5]);
  assert.equal(stats(fused).loops, 1);
});

test('repeated use of one reduction is not counted as a fusion opportunity', async () => {
  const { fused } = await check('export fn main(xs)={let s=sum(xs); s+s+s};', [[1,2,3]]);
  assert.equal(stats(fused).loops, 1);
  assert.equal(stats(fused).reductionFusion.groups.length, 0);
});

test('equal extents and identical-looking filters do not prove shared domains', async () => {
  const cases = [
    ['export fn main(xs,ys)=sum(xs)+sum(ys);', [[1,2],[3,4]]],
    ['export fn main(n)=sum(range(n))+fold(range(n),0,(a,x)=>a+1);', [5]],
    ['export fn main(xs)=sum(filter(xs,x=>x>0))+count(filter(xs,x=>x>0));', [[1,-2,3]]],
  ];
  for (const [s,args] of cases) {
    const { fused } = await check(s,args);
    assert.equal(stats(fused).loops, 2);
    assert.equal(stats(fused).reductionFusion.eliminatedLoops, 0);
  }
});

test('shared checked zip checks once and still traps on mismatches, including empty spans', async () => {
  const s = `export fn main(xs,ys)={let pairs=zip_checked(xs,ys,(x,y)=>x*y);
    sum(pairs)+fold(pairs,0,(a,x)=>a+1)};`;
  const { baseline, fused, instance } = await check(s, [[2,3],[4,5]]);
  assert.equal(stats(baseline).runtimeZipChecks, 2);
  assert.equal(stats(fused).runtimeZipChecks, 1);
  assert.equal(stats(fused).loops, 1);
  for (const args of [[0,2,16,1], [0,0,16,1], [0,1,16,0]]) {
    assert.throws(() => instance.exports.main(...args), WebAssembly.RuntimeError);
  }
  assert.equal(instance.exports.main(0,0,16,0), 0);
});

test('nested checked zip retains every pre-iteration obligation', async () => {
  const s = `export fn main(xs,ys,zs)={
    let pairs=zip_checked(zip_checked(xs,ys,(x,y)=>x+y),zs,(x,y)=>x*y);
    sum(pairs)+fold(pairs,0,(a,x)=>a+1)};`;
  const { fused, instance } = await check(s, [[1,2],[3,4],[5,6]]);
  assert.equal(stats(fused).runtimeZipChecks, 2);
  for (const args of [[0,2,16,1,32,2], [0,2,16,2,32,1]]) {
    assert.throws(() => instance.exports.main(...args), WebAssembly.RuntimeError);
  }
});

test('fused ranges still reject invalid extents', async () => {
  const { instance } = await check('export fn main(n)={let xs=range(n);sum(xs)+count(xs)};', [0]);
  for (const n of [-1, 0.5, NaN, Infinity, -Infinity, 2147483648]) {
    assert.throws(() => instance.exports.main(n), WebAssembly.RuntimeError);
  }
  assert.equal(instance.exports.main(-0), 0);
});

test('fusion respects borrowed-span validation and never writes or grows memory', async () => {
  const { instance, memory } = await check('export fn main(xs)=sum(xs)+count(xs);', [[1,2,3]]);
  const before = new Uint8Array(memory.buffer).slice();
  for (let i=0; i<100; i++) assert.equal(instance.exports.main(0,3), 9);
  assert.deepEqual(new Uint8Array(memory.buffer), before);
  assert.equal(memory.buffer.byteLength, 65536);
  for (const args of [[1,1], [65536,1], [-8,2], [0,-1], [8,536870912]]) {
    assert.throws(() => instance.exports.main(...args), WebAssembly.RuntimeError);
  }
  assert.equal(instance.exports.main(65536,0), 0);
});

test('inactive if, and, or branches and dead bindings stay undemanded', async () => {
  const expressions = [
    'if true then sum(xs)+count(xs) else sum(range(-1))',
    'if false then sum(range(-1)) else sum(xs)+count(xs)',
    'false && sum(map(xs,x=>sum(range(-1))))+count(xs)>0',
    'true || sum(map(xs,x=>sum(range(-1))))+count(xs)>0',
    '{let dead=sum(map(xs,x=>sum(range(-1))));sum(xs)+count(xs)}',
  ];
  for (const expr of expressions) await check(`export fn main(xs: [Num])=${expr};`, [[1,2,3]]);
});

test('branch-local fusion does not leak cached results across paths or calls', async () => {
  const s = `export fn main(xs,flag: Bool)={let a=sum(xs);let b=fold(xs,0,(s,x)=>s+1);
    (if flag then a+b else 0)+a+b};`;
  for (const flag of [false, true]) {
    const { instance } = await check(s, [[1,2,3],flag]);
    assert.equal(instance.exports.main(0,3,0), 9);
    assert.equal(instance.exports.main(0,3,1), 18);
    assert.equal(instance.exports.main(0,3,0), 9);
  }
});

test('cached condition reductions are excluded from later cohorts', async () => {
  const s = `export fn main(xs)={let a=sum(xs);let b=count(xs);
    (if a>0 then a+b else b)+a+b};`;
  for (const xs of [[], [-5], [1,2]]) await check(s,[xs]);
});

test('dependent reductions in bodies, initializers, masks and extents are not fused', async () => {
  const programs = [
    'export fn main(xs)={let total=sum(xs);sum(map(xs,x=>x-total))+count(xs)};',
    'export fn main(xs)=fold(xs,sum(xs),(a,x)=>a+x)+count(xs);',
    'export fn main(xs)={let ys=filter(xs,x=>x>sum(xs));sum(ys)+count(ys)};',
    'export fn main(xs: [Num])={let ys=range(count(xs));sum(ys)+count(ys)};',
  ];
  for (const s of programs) {
    const { fused } = await check(s,[[1,2,3]]);
    assert.equal(stats(fused).reductionFusion.eliminatedLoops, 0);
  }
});

test('nested reductions retain outer index and accumulator captures', async () => {
  const s = `export fn main(n)=fold(range(n),0,(a,x)=>{
    let ys=range(x); a+sum(map(ys,y=>y+x))+fold(ys,1,(b,y)=>b+y+a) });`;
  for (const n of [0,1,7]) {
    const { fused } = await check(s,[n]);
    assert.equal(stats(fused).reductionFusion.eliminatedLoops, 0);
  }
});

test('independent cohorts in one expression are kept separate', async () => {
  const { fused } = await check(`export fn main(xs,ys)=sum(xs)+fold(xs,0,(s,x)=>s+1)+sum(ys)+fold(ys,0,(s,x)=>s+1);`, [[1,2],[3]]);
  assert.equal(stats(fused).loops, 2);
  assert.equal(stats(fused).reductionFusion.groups.length, 2);
});

test('planner checks the actual schedule as well as the certified domain', () => {
  function make() {
    const p=parse('export fn main(xs)=sum(xs)+fold(xs,0,(s,x)=>s+1);');
    return stage(p,infer(p));
  }
  for (const change of [
    s => { s.extent={...s.extent,id:999}; },
    s => { s.mask={id:999,op:'const',args:[]}; },
    s => { s.indices=[{id:999}]; },
    s => { s.guards=[{id:999,op:'const',args:[]}]; },
  ]) {
    const staged=make(), root=staged.kernels[0].result;
    root.args[1].stream={...root.args[1].stream}; change(root.args[1].stream);
    assert.equal(planReductionFusion(root,staged.certificate.steps,new Map()).size,0);
  }
  const staged=make(), root=staged.kernels[0].result;
  assert.equal(planReductionFusion(root,staged.certificate.steps,new Map()).size,2);
  assert.equal(planReductionFusion(root,staged.certificate.steps,new Map([[root.args[0].id,0]])).size,0);
});

test('500 seeded programs agree with unfused Wasm and independent reference semantics', async () => {
  let seed=0xc0f0510;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for (let trial=0; trial<500; trial++) {
    const values=Array.from({length:random()%32},()=> (random()%81-40)/4);
    const a=random()%7+1, b=random()%9-4, cut=random()%11-5;
    const body=[
      `sum(xs)+sum(map(xs,x=>x*${a}+(${b})))+count(xs)`,
      `{let ys=filter(xs,x=>x>${cut});sum(ys)+sum(map(ys,x=>x*x))+count(ys)}`,
      `fold(xs,${a},(a,x)=>a-x)+fold(xs,${b},(a,x)=>a+x*x)`,
      `{let ys=map(xs,x=>if x>${cut} then x*${a} else x+(${b}));sum(ys)+count(ys)}`,
      `if count(xs)>${a} then sum(xs)+count(xs) else sum(map(xs,x=>x*x))+count(xs)`,
      `{let ys=zip_checked(xs,xs,(x,y)=>x*${a}+y);sum(ys)+count(ys)}`,
      `sum(filter(xs,x=>x>${cut}))+count(filter(xs,x=>x>${cut}))`,
      `{let unused=map(xs,x=>sum(range(-1)));count(unused)+sum(xs)}`,
    ][trial%8];
    await check(`export fn main(xs: [Num])=${body};`,[values]);
  }
});

test('CLI flags select enabled and disabled paths and exposes its diagnostics', () => {
  for (const flag of [false,true]) {
    const result=spawnSync(process.execPath,['src/cli.mjs','examples/rms.ass','--check','--explain',
      ...(flag ? ['--experimental-reduction-fusion'] : ['--no-reduction-fusion'])],
      {cwd:new URL('../',import.meta.url),encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(result.stdout);
    assert.equal(report.stats.functions[0].loops,1); // Dense count is O(1).
    assert.equal(report.stats.functions[0].reductionFusion.enabled,flag);
  }
});

test('fusion plans and caches remain isolated between exported kernels', async () => {
  const c=compile(`export fn first(xs)=sum(xs)+fold(xs,0,(s,x)=>s+1);
    export fn second(n)={let xs=range(n);sum(xs)+fold(xs,0,(s,x)=>s+1)};`,enabled);
  const memory=new WebAssembly.Memory({initial:1,maximum:1});
  new Float64Array(memory.buffer).set([2,4,8]);
  const instance=await instantiate(c,{memory});
  assert.equal(instance.exports.first(0,3),17);
  assert.equal(instance.exports.second(5),15);
  assert.deepEqual(c.stats.functions.map(f=>f.loops),[1,1]);
});
