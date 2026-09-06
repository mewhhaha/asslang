import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compile, compileSources, checkSources } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';
import { corpus, unsupportedCorpus, exampleSource } from '../examples/corpus.mjs';
import { expandedCorpus } from '../examples/expanded-corpus.mjs';
import { reference } from './reference.mjs';
const read=path=>readFile(new URL('../examples/'+path,import.meta.url),'utf8');
const modes=[false,true].flatMap(simd=>[false,true].map(reductionFusion=>({simd,reductionFusion})));
const plain=x=>ArrayBuffer.isView(x)?Array.from(x):Array.isArray(x)?x.map(plain):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;

for(const e of expandedCorpus)test(`expanded four-mode execution: ${e.id}`,async()=>{
  const source=await exampleSource(e,read),expected=reference(source,e.name,e.args);
  for(const options of modes)assert.deepEqual(plain((await createRuntime(compile(source,options))).call(e.name,e.args)),plain(expected));
});

for(const e of unsupportedCorpus)test(`unsupported feature remains explicit: ${e.id}`,async()=>{
  const source=await read(e.path);
  for(const options of modes) {
    const result=checkSources([{name:'helpers.ass',source:'fn helper = x -> x;'}, {name:e.path,source}],options);
    assert.equal(result.ok,false,`${e.id} now works: promote it with runtime tests`);
    const d=result.diagnostics[0];assert.equal(d.code,e.code);assert.equal(d.sourceName,e.path);
    assert.ok(d.range.start.offset>=0 && d.range.start.offset<=source.length);
  }
  assert.ok(e.extension && e.variant && e.feature);
});

test('unsupported missing-name diagnostics retain exact linked source offsets',()=>{
  const source='// app\nexport fn main = (xs:[Num]) -> sort xs;';
  assert.throws(()=>compileSources([{name:'helpers.ass',source:'fn id = x -> x;'}, {name:'future.ass',source}]),e=>
    e.code==='E_NAME' && e.sourceName==='future.ass' && e.offset===source.indexOf('sort xs'));
});

test('promoted pathologies have structural evidence under the default lowering',async()=>{
  for(const [id,loops,machines] of [['multi-reduction',1,0],['scan-replay',1,1]]) {
    const e=corpus.find(e=>e.id===id),source=await read(e.path);
    const current=compile(source).stats.functions[0],old=compile(source,{reductionFusion:false}).stats.functions[0];
    assert.equal(current.loops,loops);assert.equal(current.stateMachines,machines);
    assert.equal(old.loops,2);assert.equal(current.reductionFusion.eliminatedLoops,1);
    assert.ok(!e.path.startsWith('pathological/'));
  }
  const shared=corpus.find(e=>e.id==='shared-reduction'),source=await read(shared.path);
  assert.equal(compile(source).stats.functions[0].memoizedReductions,1);
  assert.ok(!shared.path.startsWith('pathological/'));
});

async function runtime(id,options={}) {const e=expandedCorpus.find(e=>e.id===id);return {e,r:await createRuntime(compile(await exampleSource(e,read),options))};}
test('case studies cover empty inputs, invalid contracts and exceptional numeric data',async()=>{
  for(const options of modes) {
    let {r}=await runtime('telemetry-monitor',options);
    assert.deepEqual(r.call('analyze',[[],5]),{alerts:0,count:0,mean:0,rejected:0,rms:0});
    assert.deepEqual(r.call('analyze',[[NaN,Infinity,-Infinity,3],2]),{alerts:1,count:1,mean:3,rejected:3,rms:3});
    ({r}=await runtime('checkout-invoice',options));
    assert.deepEqual(r.call('invoice',[[],[],0.2,0]),{line_count:0,subtotal:0,tax:0,total:0});
    for(const args of [[[1],[],0,0],[[-1],[2],0,0],[[1],[2],0,2]])assert.throws(()=>r.call('invoice',args),WebAssembly.RuntimeError);
    ({r}=await runtime('session-analytics',options));
    assert.deepEqual(plain(r.call('session_ids',[[],5])),[]);
    for(const args of [[[2,1],5],[[1,NaN],5],[[1],-1]])assert.throws(()=>r.call('session_ids',args),WebAssembly.RuntimeError);
    ({r}=await runtime('inventory-planner',options));
    assert.deepEqual(plain(r.call('replenish',[[],[],2,1])),[]);
    assert.throws(()=>r.call('replenish',[[0.5],[0],2,1]),WebAssembly.RuntimeError);
    ({r}=await runtime('particle-step',options));
    assert.deepEqual(plain(r.call('advance',[[],[],1])),{kinetic:0,particles:0,positions:[]});
    assert.throws(()=>r.call('advance',[[1],[],1]),WebAssembly.RuntimeError);
    ({r}=await runtime('text-log-summary',options));
    assert.deepEqual(r.call('summarize',['']),{bytes:0,digits:0,lines:0});
    assert.deepEqual(r.call('summarize',['🙂9']),{bytes:5,digits:1,lines:1});
  }
});

test('structural Option and Result variants do not demand an absent/error value transform',async()=>{
  const library=await read('../lib/patterns.ass');
  const source=library+'\nexport fn main = (xs:[Num]) -> option_default 42 (option_map (x -> at xs 9) (option_none 0));';
  for(const options of modes)assert.equal((await createRuntime(compile(source,options))).call('main',[[]]),42);
  const {r}=await runtime('result-validation');assert.deepEqual(r.call('main',[4,0]),{code:1,ok:false,value:0});
});

test('case-study host app accepts JSON stdin and rejects invalid requests and oversized input',async()=>{
  const {spawnSync}=await import('node:child_process');
  const run=(args,input)=>spawnSync(process.execPath,['examples/case-studies/app.mjs',...args],{cwd:new URL('../',import.meta.url),input,encoding:'utf8'});
  const success=run(['particle-step','--simd'],'[[0,10],[2,-2],0.5]');
  assert.equal(success.status,0,success.stderr);
  assert.deepEqual(JSON.parse(success.stdout),{kinetic:4,particles:2,positions:[1,9]});
  for(const [args,input] of [[['unknown'],'[]'],[['particle-step'],'{}'],[['particle-step'],'not JSON'],[['particle-step'],' '.repeat(1024*1024+1)]])
    assert.equal(run(args,input).status,1);
});
