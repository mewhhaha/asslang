import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileSources } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const load = async path => ({name:path,source:await readFile(new URL('../../'+path,import.meta.url),'utf8')});
const libraries = await Promise.all(['lib/products.ass','lib/polynomials.ass'].map(load));
const plain = value => ArrayBuffer.isView(value) ? [...value] : value;
const cases = [
  {file:'polynomial',name:'shape_polynomial',args:[[2,3,5],{mass:4,position:{x:2,y:3}}],
    expected:{mass:49,position:{x:19,y:32}},units:3,outputBytes:0},
  {file:'stages',name:'shape_stages',args:[{a:2,b:{c:3,d:4}},1],expected:41,units:0},
  {file:'ranges',name:'shape_ranges',args:[{a:2,b:{c:3,d:1}}],expected:[0,1,1,2,4,4],units:6,outputBytes:48},
];
const reports = [];
for (const c of cases) {
  const sources = [...libraries,await load(`examples/case-studies/products/${c.file}.ass`)];
  const artifact = compileSources(sources,{maxLoopIterations:c.units});
  const runtime = await createRuntime(artifact);
  const result = plain(runtime.call(c.name,c.args,{...(c.outputBytes===undefined?{}:{outputBytes:c.outputBytes})}));
  assert.deepEqual(result,c.expected);
  assert.equal(artifact.stats.intermediateBufferBytes,0);
  if (c.units) {
    const small = await createRuntime(compileSources(sources,{maxLoopIterations:c.units-1}));
    assert.throws(()=>small.call(c.name,c.args),WebAssembly.RuntimeError);
  }
  if (c.outputBytes) assert.throws(()=>runtime.call(c.name,c.args,{outputBytes:c.outputBytes-1}),WebAssembly.RuntimeError);
  reports.push({name:c.name,result,loops:artifact.stats.functions[0].loops,loopUnits:c.units,
    outputArrayBytes:c.outputBytes??0,intermediateBufferBytes:artifact.stats.intermediateBufferBytes,wasmBytes:artifact.bytes.length});
}
console.log(JSON.stringify({reports,note:'Type shape is elaborated during compilation; numeric data and array work remain runtime. Descriptors, input/output copies and compiler memory are not included in array storage.'},null,2));
