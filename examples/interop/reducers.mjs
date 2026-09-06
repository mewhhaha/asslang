// Run: npm run example:reducers
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCompiler } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const compiler=createCompiler({maxEntries:2,maxBytes:1024*1024});
const files=[
  {name:'reducers.ass',source:await readFile(new URL('../../lib/reducers.ass',import.meta.url),'utf8')},
  {name:'app.ass',source:`
    export fn milestones(xs:[Num],threshold:Num)=until_with(xs,
      until_both(first_matching(x=>x>10,-1),threshold_reducer(threshold))
    );
  `},
];
const compiled=compiler.compileSources(files);
assert.equal(compiler.compileSources(files).cache.hit,true);
// Reuse this native module for independently owned runtimes. It carries no
// input memory and confers no host authority.
const module=await WebAssembly.compile(compiled.bytes);
const runtime=await createRuntime(module,{pages:2});
const call=runtime.prepare('milestones',[Float64Array.of(2,11,3,100),15]);
try {
  const first=call.run();
  const second=call.run({threshold:100});
  assert.equal(first.steps,3);
  assert.equal(first.value.left.value,11); // The first-found lane freezes.
  assert.equal(first.value.right.value,16);
  assert.equal(second.steps,4);
  assert.equal(second.value.left.value,11);
  assert.equal(second.value.right.value,116);
  console.log(JSON.stringify({first,second,loops:compiled.stats.functions[0].loops},null,2));
} finally {
  call.dispose();
  compiler.clear();
}
