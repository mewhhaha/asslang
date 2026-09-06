import test from 'node:test';
import assert from 'node:assert/strict';
// Exercise the real worker handler without claiming HTTP/worker loading works.
let reply;
globalThis.self={postMessage:value=>{reply=value;}};
await import('../web/worker.mjs');
const source='export fn main(xs:[Num])={let ys=scan(xs,0,(s,x)=>s+x);sum(ys)+count(ys)};';
test('playground worker enables reduction fusion by default',async()=>{
  await self.onmessage({data:{source,args:[[1,2,3]]}});
  assert.equal(reply.value,13);assert.equal(reply.stats.functions[0].loops,1);
  assert.equal(reply.stats.functions[0].reductionFusion.enabled,true);
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

test('playground check mode validates effects without touching runtime arguments or capabilities', async () => {
  const source = 'host fn tick: Num -> Num; export fn main = (x: Num) -> effect { perform tick x; x };';
  for (const experimentalReductionFusion of [false, true]) {
    const data = { mode: 'check', source, experimentalReductionFusion };
    for (const key of ['args', 'allowDemoEffects', 'name', 'n'])
      Object.defineProperty(data, key, { get() { throw new Error(`${key} must not be accessed when checking`); } });
    await self.onmessage({ data });
    assert.equal(reply.mode, 'check'); assert.equal(reply.ok, true);
    assert.equal(reply.exports[0].name, 'main'); assert.deepEqual(reply.diagnostics, []);
    assert.equal(reply.events, undefined); assert.equal(reply.memoryBytes, undefined); assert.equal(reply.value, undefined);
  }
});

test('playground compile and check failures both retain structured locations', async () => {
  const source = '// 🦊\r\nexport fn main = (x: Num) -> missing x;';
  for (const mode of ['run', 'check']) {
    await self.onmessage({ data: { mode, source, args: [1] } });
    assert.match(reply.error, /E_NAME at 2:/); assert.match(reply.error, /\^/);
    assert.equal(reply.diagnostics[0].range.start.offset, source.indexOf('missing'));
    assert.equal(reply.diagnostics[0].phase, 'infer');
    if (mode === 'check') assert.equal(reply.ok, false);
  }
});

test('playground runtime failures are not presented as compiler locations', async () => {
  await self.onmessage({ data: { source: 'export fn main = (x: Num) -> require false x;', args: [1] } });
  assert.ok(reply.error); assert.equal(reply.diagnostics, undefined);
});

test('playground rejects unknown modes rather than accidentally running a program', async () => {
  await self.onmessage({ data: { mode: 'typo', source: 'export fn main = () -> 42;', args: [{}] } });
  assert.match(reply.error, /Unknown worker mode/); assert.equal(reply.value, undefined);
  await self.onmessage({ data: null });
  assert.match(reply.error, /Worker request must be an object/);
});


test('worker honors explicit fusion opt-out and SIMD opt-in', async () => {
  await self.onmessage({data:{source,args:[[1,2,3]],experimentalReductionFusion:false}});
  assert.equal(reply.stats.functions[0].loops,2);
  await self.onmessage({data:{source:'export fn main = (xs:[Num]) -> map xs (x -> x*x);',args:[[1,2,3]],simd:true}});
  assert.equal(reply.stats.functions[0].simd.vectorizedLoops,1);
  assert.deepEqual(Array.from(reply.value),[1,4,9]);
});
