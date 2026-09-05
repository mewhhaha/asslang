import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus, platform, arch } from 'node:os';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/compiler.mjs';
const iterations=200, warmup=30;
const root=fileURLToPath(new URL('../',import.meta.url));
const sources={
  scalar:'export fn main(x) = x*x + 1;',
  cohort:readFileSync(new URL('../examples/cohort.ass',import.meta.url),'utf8'),
  pipeline100:'export fn main(n)=range(n)'+Array.from({length:100},()=> ' |> map(x=>x+1)').join('')+' |> sum;',
};
const summary=times=>{
  const sorted=[...times].sort((a,b)=>a-b);
  return {p50:sorted[Math.floor(sorted.length*0.50)],p95:sorted[Math.floor(sorted.length*0.95)]};
};
const results=[];
for (const [name,source] of Object.entries(sources)) {
  const first=compile(source);
  for(let i=0;i<warmup;i++) compile(source);
  const times=[];
  for(let i=0;i<iterations;i++) times.push(compile(source).stats.milliseconds.total);
  results.push({name,sourceCharacters:source.length,wasmBytes:first.bytes.length,
    firstCallMilliseconds:first.stats.milliseconds.total,
    warmedCompileMilliseconds:summary(times),kernels:first.stats.functions});
}
const processTimes=[];
for(let i=0;i<10;i++) {
  const start=performance.now();
  const result=spawnSync(process.execPath,['src/cli.mjs','examples/cohort.ass','--check'],{cwd:root,encoding:'utf8'});
  if(result.status!==0) throw new Error(result.stderr);
  processTimes.push(performance.now()-start);
}
console.log(JSON.stringify({recordedAt:new Date().toISOString(),node:process.version,
  platform:`${platform()} ${arch()}`,cpu:cpus()[0]?.model,iterations,warmup,
  notes:[
    'One container, not a language comparison or production performance guarantee.',
    'Compile includes parse, ordinary inference, JTE staging/checking, binary emission and WebAssembly.validate.',
    'Compile excludes V8 machine-code compilation, execution, filesystem IO and process startup.',
    'Fresh-process check below includes Node startup and source file IO, but does not write Wasm output.',
    'First call is per case within this process, not necessarily a cold JavaScript engine.',
    'wasmLocalValueBytes is logical Wasm-local payload, NOT measured V8 stack or process memory.'
  ],results,freshProcessCohortCheckMilliseconds:summary(processTimes)},null,2));
