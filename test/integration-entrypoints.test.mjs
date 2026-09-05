import test from 'node:test';
import assert from 'node:assert/strict';
// Exercise the real worker handler without claiming HTTP/worker loading works.
let reply;
globalThis.self={postMessage:value=>{reply=value;}};
await import('../web/worker.mjs');
const source='export fn main(xs:[Num])={let ys=scan(xs,0,(s,x)=>s+x);sum(ys)+count(ys)};';
test('playground worker keeps reduction fusion disabled by default',async()=>{
  await self.onmessage({data:{source,args:[[1,2,3]]}});
  assert.equal(reply.value,13);assert.equal(reply.stats.functions[0].loops,2);
  assert.equal(reply.stats.functions[0].reductionFusion.enabled,false);
});
test('playground worker forwards the fusion option and returns diagnostics',async()=>{
  await self.onmessage({data:{source,args:[[1,2,3]],experimentalReductionFusion:true}});
  assert.equal(reply.value,13);assert.equal(reply.stats.functions[0].loops,1);
  assert.equal(reply.stats.functions[0].reductionFusion.eliminatedLoops,1);
});
test('playground fusion never grants unrequested host authority',async()=>{
  const effect='host fn tick(x:Num):Num;export fn main(x)=effect{let y=perform tick(x);y};';
  await self.onmessage({data:{source:effect,args:[1],experimentalReductionFusion:true}});
  assert.match(reply.error,/E_CAPABILITY/);
});
