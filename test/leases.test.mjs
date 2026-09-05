import test from 'node:test';import assert from 'node:assert/strict';
import {compile} from '../src/compiler.mjs';import {createRuntime} from '../src/abi.mjs';
const source='export fn main(xs:[Num],scale:Num)=map(xs,x=>x*scale);';
test('prepared inputs are snapshots, outputs own storage, and scalar overrides do not persist',async()=>{
  const r=await createRuntime(compile(source)),xs=new Float64Array([1,2,3]);
  const lease=r.prepare('main',[xs,2]);xs.fill(999);
  const a=lease.run(),b=lease.run({scale:3});
  assert.deepEqual(a,new Float64Array([2,4,6]));assert.deepEqual(b,new Float64Array([3,6,9]));
  assert.deepEqual(lease.run(),a);assert.equal(r.memoryBytes,65536);lease.dispose();assert.deepEqual(a,new Float64Array([2,4,6]));
});
test('runtime permits one lease and revokes stale generations',async()=>{
  const r=await createRuntime(compile(source)),a=r.prepare('main',[[1],2]);
  assert.throws(()=>r.prepare('main',[[2],3]),e=>e.code==='E_LEASE_BUSY');
  assert.throws(()=>r.call('main',[[2],3]),e=>e.code==='E_LEASE_BUSY');
  assert.equal(a.dispose(),true);assert.equal(a.dispose(),false);assert.equal(a.disposed,true);
  const b=r.prepare('main',[[2],3]);assert.ok(b.generation>a.generation);
  assert.throws(()=>a.run(),e=>e.code==='E_LEASE_EXPIRED');assert.equal(a.dispose(),false);
  assert.deepEqual(b.run(),new Float64Array([6]));b.dispose();assert.deepEqual(r.call('main',[[4],5]),new Float64Array([20]));
});
test('preparation failure and guest traps recover without losing pinned inputs',async()=>{
  const r=await createRuntime(compile('export fn main(xs:[Num],i:Num)=at(xs,i);'));
  assert.throws(()=>r.prepare('main',[[true],0]));
  const l=r.prepare('main',[[7,9],0]);assert.equal(l.run(),7);
  assert.throws(()=>l.run({i:9}),WebAssembly.RuntimeError);assert.equal(l.run({i:1}),9);l.dispose();
});
test('leases deny composite replacements, getters, unknown fields and type mismatches',async()=>{
  const r=await createRuntime(compile(source)),l=r.prepare('main',[[2],3]);
  assert.throws(()=>l.run({xs:[1]}),e=>e.code==='E_LEASE_OVERRIDE');
  assert.throws(()=>l.run({wat:1}),e=>e.code==='E_LEASE_OVERRIDE');
  assert.throws(()=>l.run({get scale(){throw new Error('should not run');}}),e=>e.code==='E_ABI_VALUE');
  assert.throws(()=>l.run({scale:true}),e=>e.code==='E_ABI_VALUE');
  assert.deepEqual(l.run(),new Float64Array([6]));l.dispose();
});
test('leased calls cannot bypass host capabilities',async()=>{
  const r=await createRuntime(compile('host fn tick(x:Num):Num;export fn main(x)=effect{let y=perform tick(x);y};'));
  assert.throws(()=>r.prepare('main',[1]),e=>e.code==='E_LEASE_EFFECT');
  assert.throws(()=>r.call('main',[1]),e=>e.code==='E_CAPABILITY');
});
test('reentrant scalar override inspection cannot release the executing lease',async()=>{
  const r=await createRuntime(compile(source)),l=r.prepare('main',[[1],2]);
  const overrides=new Proxy({scale:3},{ownKeys(t){assert.throws(()=>l.dispose(),e=>e.code==='E_LEASE_BUSY');assert.throws(()=>l.run(),e=>e.code==='E_EFFECT_REENTRANCY');return Reflect.ownKeys(t);}});
  assert.deepEqual(l.run(overrides),new Float64Array([3]));l.dispose();
});
