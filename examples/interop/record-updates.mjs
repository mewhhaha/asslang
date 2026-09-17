import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compile} from '../../src/compiler.mjs';
import {createRuntime} from '../../src/abi.mjs';
import {layout} from '../../src/abi-schema.mjs';

const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'
  ?Object.fromEntries(Object.entries(x).map(([key,value])=>[key,plain(value)])):x;
const read=path=>readFile(new URL('../case-studies/records/'+path+'.ass',import.meta.url),'utf8');
const cases=[
  {file:'configuration',name:'configure',budget:0,inputPayloadBytes:7,
    args:[{name:'demo',enabled:false,network:{retries:0,timeout:30},payload:new Uint8Array([1,2,3])},4],
    expected:{name:'demo',enabled:true,network:{retries:4,timeout:30},payload:[1,2,3]}},
  {file:'ledger',name:'settle',budget:2,inputPayloadBytes:24,
    args:[{balance:0,enabled:true,metadata:{revision:7,limit:50}},[2,3,-99],5],
    expected:{state:{balance:5,enabled:true,metadata:{revision:7,limit:50}},done:true,steps:2}},
];
for(const c of cases) {
  const source=await read(c.file),artifact=compile(source,{maxLoopIterations:c.budget});
  const unmetered=compile(source),runtime=await createRuntime(artifact);
  const result=runtime.call(c.name,c.args,{outputBytes:0});
  assert.deepEqual(plain(result),c.expected);
  assert.equal(artifact.abi.version,1);
  assert.equal(artifact.stats.intermediateBufferBytes,0);
  if(c.file==='ledger') {
    const short=await createRuntime(compile(source,{maxLoopIterations:1}));
    assert.throws(()=>short.call(c.name,c.args,{outputBytes:0}),WebAssembly.RuntimeError);
  }
  const outputDescriptorBytes=layout(artifact.abi.exports[0].result.schema).size;
  console.log(JSON.stringify({example:c.file,result:plain(result),
    abi:artifact.abi.version,wasmBytes:unmetered.bytes.length,meteredWasmBytes:artifact.bytes.length,
    inputPayloadBytes:c.inputPayloadBytes,outputDescriptorBytes,additionalGuestOutputBytes:0,
    alignmentBytes:runtime.highWaterBytes-c.inputPayloadBytes-outputDescriptorBytes,
    arenaHighWaterBytes:runtime.highWaterBytes,scratchBytes:0,
    intermediateBufferBytes:artifact.stats.intermediateBufferBytes,
    emittedLoops:artifact.stats.functions[0].loops,visitedLoopUnits:c.budget,
    syntaxNodes:artifact.stats.syntaxNodes,inferenceConstraints:artifact.stats.inferenceConstraints,
    stagingWork:artifact.stats.stagingWork,scalarNodes:artifact.stats.scalarNodes,
    functionStats:artifact.stats.functions[0]},null,2));
}
