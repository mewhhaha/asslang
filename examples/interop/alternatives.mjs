import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileSources} from '../../src/compiler.mjs';
import {createRuntime} from '../../src/abi.mjs';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const library={name:'alternatives.ass',source:await read('../../lib/alternatives.ass')};
for(const [path,args,expected] of [
  ['../patterns/either_elimination.ass',[-4],-4],
  ['../patterns/maybe_elimination.ass',[3,false],-1],
  ['../patterns/maybe_elimination.ass',[3,true],9],
]){
  const source=await read(path),artifact=compileSources([library,{name:path,source}],{maxLoopIterations:0});
  const runtime=await createRuntime(artifact),value=runtime.call('main',args);
  assert.deepEqual(value,expected);
  const stats=artifact.stats.functions.find(f=>f.name==='main');
  console.log(JSON.stringify({path,args,value,abi:artifact.abi.version,wasmBytes:artifact.bytes.length,
    loops:stats.loops,intermediateBufferBytes:artifact.stats.intermediateBufferBytes,
    syntaxNodes:artifact.stats.syntaxNodes,inferenceConstraints:artifact.stats.inferenceConstraints,stagingWork:artifact.stats.stagingWork,
    scalarNodes:artifact.stats.scalarNodes,needsMemory:artifact.stats.needsMemory,wasmLocals:stats.wasmLocals,wasmLocalValueBytes:stats.wasmLocalValueBytes}));
}
