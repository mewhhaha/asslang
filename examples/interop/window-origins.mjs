import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileSources} from '../../src/compiler.mjs';
import {createRuntime} from '../../src/abi.mjs';

const library={name:'windows.ass',source:await readFile(new URL('../../lib/windows.ass',import.meta.url),'utf8')};
const source=await readFile(new URL('../case-studies/windows/origin_report.ass',import.meta.url),'utf8');
const files=[library,{name:'origin_report.ass',source}];
const artifact=compileSources(files,{maxLoopIterations:12});
const runtime=await createRuntime(artifact);
const result=runtime.call('origin_report',[[1,2,3,4,5,6],3,2],{outputBytes:48});
const plain=value=>ArrayBuffer.isView(value)||Array.isArray(value)?Array.from(value,plain):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,plain(item)])):value;
const expected={indexes:[0,1],starts:[0,2],totals:[6,12]};
assert.deepEqual(plain(result),expected);
assert.equal(artifact.abi.version,1);
assert.equal(artifact.stats.intermediateBufferBytes,0);
assert.equal(artifact.stats.functions[0].runtimeZipChecks,0);
assert.throws(()=>runtime.call('origin_report',[[1,2,3,4,5,6],3,2],{outputBytes:47}),WebAssembly.RuntimeError);

console.log(JSON.stringify({
  result:expected,
  asabi:artifact.abi.version,
  loops:artifact.stats.functions[0].loops,
  loopUnits:12,
  runtimeZipChecks:artifact.stats.functions[0].runtimeZipChecks,
  intermediateBufferBytes:artifact.stats.intermediateBufferBytes,
  wasmBytes:artifact.bytes.length,
},null,2));
