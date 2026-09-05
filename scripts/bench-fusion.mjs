import assert from 'node:assert/strict';
import { cpus, platform, arch } from 'node:os';
import { compile, instantiate } from '../src/compiler.mjs';

// Paired, alternating-order microbenchmarks; no performance threshold in tests.
// Override the input length: FUSION_BENCH_N=4096 node scripts/bench-fusion.mjs
const n = Number(process.env.FUSION_BENCH_N ?? 262144);
if (!Number.isInteger(n) || n < 1 || n > 1048576) {
  throw new RangeError('FUSION_BENCH_N must be an integer from 1 to 1048576');
}
const warmup = 30, rounds = 9, callsPerSample = 12;
const pages = Math.ceil(n * 8 / 65536);
const memory = new WebAssembly.Memory({ initial: pages, maximum: pages });
const input = new Float64Array(memory.buffer, 0, n);
let seed = 0x51a7c0de;
for (let i = 0; i < n; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  input[i] = ((seed >>> 8) % 2049 - 1024) / 16;
}
const programs = {
  moments: `export fn main(xs) = sum(xs) + sum(map(xs,x=>x*x)) + count(xs);`,
  filtered_moments: `export fn main(xs) = { let ys=filter(xs,x=>x>0);
    sum(ys)+sum(map(ys,x=>x*x))+count(ys) };`,
  shared_map: `export fn main(xs) = { let ys=map(xs,x=>sqrt(abs(x)+1));
    sum(ys)+sum(map(ys,x=>x*x)) };`,
  independent_filters_control: `export fn main(xs) =
    sum(filter(xs,x=>x>0)) + count(filter(xs,x=>x>0));`,
  causal_history: `export fn main(xs:[Num])={let ys=scan(xs,0,(s,x)=>s+x);
    sum(ys)+count(ys)+fold(ys,0,(s,x)=>max(s,x))};`,
  causal_selection: `export fn main(xs:[Num])={
    let ys=transduce(xs,0,(s,x)=>{state:s+x,value:s+x,emit:x>0});
    sum(ys)+count(ys)};`,
};
const median = xs => [...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const report = {
  experiment: 'same-domain reduction cohorts integrated with JTE 1 causal',
  environment: { node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  method: { n, inputSeed: '0x51a7c0de', warmupCallsPerVariant: warmup,
    rounds, callsPerSample, order: 'alternating baseline/fused pairs',
    units: 'milliseconds per call', timing: 'execution only, excludes compilation and instantiation',
    note: 'Dense stateless count already has no loop in the integrated baseline.' },
  cases: [],
};
for (const [name, source] of Object.entries(programs)) {
  const variants = [];
  for (const experimentalReductionFusion of [false, true]) {
    const compiled = compile(source, { experimentalReductionFusion });
    const instance = await instantiate(compiled, { memory });
    variants.push({ compiled, run: () => instance.exports.main(0, n), samples: [] });
  }
  assert.ok(Object.is(variants[0].run(), variants[1].run()), `${name}: result differs`);
  for (let i = 0; i < warmup; i++) { variants[i%2].run(); variants[1-i%2].run(); }
  let checksum = 0;
  for (let round = 0; round < rounds; round++) {
    for (const index of round%2 ? [1,0] : [0,1]) {
      const variant = variants[index], start = performance.now();
      for (let j = 0; j < callsPerSample; j++) checksum += variant.run();
      variant.samples.push((performance.now() - start) / callsPerSample);
    }
  }
  const summarize = v => ({ millisecondsMedian: median(v.samples), samples: v.samples,
    wasmBytes: v.compiled.bytes.length, ...v.compiled.stats.functions[0] });
  report.cases.push({ name, source, baseline: summarize(variants[0]), fused: summarize(variants[1]),
    medianSpeedup: median(variants[0].samples) / median(variants[1].samples), checksum });
}
console.log(JSON.stringify(report, null, 2));
