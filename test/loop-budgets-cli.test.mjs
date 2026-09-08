import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const cli=new URL('../src/cli.mjs',import.meta.url);
function driver(args) {
  const r=spawnSync(process.execPath,[cli.pathname,...args],{encoding:'utf8',timeout:10000});
  assert.equal(r.error,undefined);return r;
}
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'asslang-loop-budget-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const source=join(dir,'main.ass');
  await writeFile(source,'export fn main = (n:Num) -> sum (map (range n) (x -> x*x));');
  return {dir,source};
}

test('CLI budgeted builds and explain output preserve policy and executable bytes',async t=>{
  const {dir,source}=await fixture(t),out=join(dir,'main.wasm');
  const r=driver([source,'-o',out,'--max-loop-iterations','3','--explain']);
  assert.equal(r.status,0,r.stderr);
  const sidecar=JSON.parse(await readFile(out+'.json','utf8'));
  assert.equal(sidecar.executionLimits.maxLoopIterations,3);
  assert.deepEqual(sidecar.stats.functions[0].loopBudget,{limit:3,sites:1});
  const explain=JSON.parse(r.stdout.slice(r.stdout.indexOf('\n')+1));
  assert.deepEqual(explain.executionLimits,sidecar.executionLimits);
  const {instance}=await WebAssembly.instantiate(await readFile(out));
  assert.equal(instance.exports.main(3),5);
  assert.throws(()=>instance.exports.main(4),WebAssembly.RuntimeError);
  assert.equal(instance.exports.main(3),5);
});

test('CLI --run enforces the limit and reports failure without a fabricated result',async t=>{
  const {source}=await fixture(t);
  const success=driver([source,'--max-loop-iterations','3','--run','main','--args','[3]']);
  assert.equal(success.status,0,success.stderr);assert.equal(success.stdout.trim(),'5');
  const failure=driver([source,'--max-loop-iterations','3','--run','main','--args','[4]']);
  assert.equal(failure.status,1);assert.equal(failure.stdout,'');assert.ok(failure.stderr.trim());
});

test('CLI check modes validate without running and accept zero or maximum budgets',async t=>{
  const {dir,source}=await fixture(t);
  for(const limit of ['0','2147483647']) {
    const r=driver([source,'--max-loop-iterations',limit,'--check','--diagnostics=json']);
    assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).ok,true);assert.equal(r.stderr,'');
  }
  const explain=driver([source,'--max-loop-iterations','0','--check','--explain']);
  assert.equal(explain.status,0);assert.equal(JSON.parse(explain.stdout).executionLimits.maxLoopIterations,0);
  assert.deepEqual(await readdir(dir),['main.ass']);
});

test('CLI budget parsing rejects missing, duplicate, nondecimal, and out-of-range values',()=>{
  const flags=[[],['-1'],['0.5'],['NaN'],['Infinity'],['0x10'],['1e3'],['01'],['+1'],[''],['2147483648'],['3','--max-loop-iterations','4']];
  for(const values of flags) {
    // Invalid policy is rejected before any source file is opened.
    const r=driver(['missing.ass','--check','--diagnostics=json','--max-loop-iterations',...values]);
    assert.equal(r.status,1);
    const report=JSON.parse(r.stdout);assert.equal(report.ok,false);
    assert.equal(report.diagnostics[0].code,'E_OPTIONS');assert.equal(r.stderr,'');
    assert.match(report.diagnostics[0].message,/max-loop-iterations/);
  }
});

test('CLI source linking carries the budget and unmetered sidecars omit the policy',async t=>{
  const {dir,source}=await fixture(t),lib=join(dir,'helper.ass');
  await writeFile(lib,'fn square = x -> x*x;');
  await writeFile(source,'export fn main = (n:Num) -> sum (map (range n) square);');
  const limited=driver([source,'--lib',lib,'--max-loop-iterations','2','--run','main','--args','[3]']);
  assert.equal(limited.status,1);
  const output=join(dir,'unlimited.wasm');
  const plain=driver([source,'--lib',lib,'-o',output]);assert.equal(plain.status,0,plain.stderr);
  const metadata=JSON.parse(await readFile(output+'.json','utf8'));
  assert.equal(Object.hasOwn(metadata,'executionLimits'),false);
  const {instance}=await WebAssembly.instantiate(await readFile(output));assert.equal(instance.exports.main(3),5);
});
