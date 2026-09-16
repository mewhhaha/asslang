import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileSources } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const load = async path => ({name:path,source:await readFile(new URL('../../'+path,import.meta.url),'utf8')});
const libraries = await Promise.all(['lib/products.ass','lib/optimization.ass'].map(load));
const source = `
export fn optimize = (point:{gain:Num,model:{bias:Num,slope:Num}}) -> do {
  let objective = p ->
    (p.gain-2)*(p.gain-2) +
    (p.model.bias+1)*(p.model.bias+1) +
    (p.model.slope-4)*(p.model.slope-4);
  let vector = numeric_vector point;
  let first = momentum_step_with vector objective
    {point,velocity:vector.zero} 0.25 0.5;
  momentum_step_with vector objective first 0.25 0.5
};
`;

const artifact = compileSources([...libraries,{name:'structured-optimization.ass',source}],{maxLoopIterations:0});
const runtime = await createRuntime(artifact);
const result = runtime.call('optimize',[{gain:0,model:{bias:1,slope:2}}]);
const expected = {
  point:{gain:2,model:{bias:-1,slope:4}},
  velocity:{gain:-4,model:{bias:4,slope:-4}},
};
assert.deepEqual(result,expected);
assert.equal(artifact.abi.version,1);
assert.equal(artifact.stats.functions[0].loops,0);
assert.equal(artifact.stats.intermediateBufferBytes,0);

console.log(JSON.stringify({
  result,
  loops:artifact.stats.functions[0].loops,
  intermediateBufferBytes:artifact.stats.intermediateBufferBytes,
  abi:artifact.abi.version,
  wasmBytes:artifact.bytes.length,
  note:'The optimizer dictionary, gradient step and momentum state are source. Numeric product shape is elaborated at compile time; no runtime parameter-tree reflection is used.'
},null,2));
