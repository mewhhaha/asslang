import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,instantiate} from '../src/compiler.mjs';
import {createRuntime,createCapability} from '../src/abi.mjs';
const source='host fn emit(n:Num):Num; export fn main(n)=effect { let a=perform emit(n); let b=perform emit(a+1); b+1 };';
const grant=(call,options={maxCalls:10})=>createCapability({emit:{parameters:['Num'],result:'Num',call}},options);
const code=(fn,c)=>assert.throws(fn,e=>e.code===c);

test('all host functions are impure and cannot escape into ordinary value code',()=>{
  for(const body of ['emit(1)','{let f=emit; f(1)}','map(range(2),x=>emit(x)) |> sum']) {
    code(()=>compile(`host fn emit(n:Num):Num; export fn main()=${body};`),'E_EFFECT');
  }
  code(()=>compile('host fn emit(n:Num):Num; fn f()=effect {perform emit(1); 0}; export fn main()=f();'),'E_EFFECT');
  code(()=>compile('host fn emit(n:Num):Num; export fn main()=if true then effect {perform emit(1);0} else 1;'),'E_EFFECT');
});
test('unused performed results still execute once, in lexical order',async()=>{
  const r=await createRuntime(compile('host fn emit(n:Num):Num; export fn main(n)=effect { perform emit(n); perform emit(n+1); 99 };'));
  const seen=[],cap=grant(n=>(seen.push(n),n));
  assert.equal(r.call('main',[4],{capability:cap}),99);assert.deepEqual(seen,[4,5]);assert.equal(cap.remaining,8);
});
test('perform results may be reused as data without repeating the effect',async()=>{
  const r=await createRuntime(compile('host fn emit(n:Num):Num; export fn main(n)=effect {let a=perform emit(n);a+a};'));
  let calls=0;const cap=grant(n=>(calls++,n));assert.equal(r.call('main',[7],{capability:cap}),14);assert.equal(calls,1);
});
test('ungranted, forged, wrong-signature and insufficient-budget invocations fail before a host call',async()=>{
  const r=await createRuntime(compile(source));let calls=0;
  code(()=>r.call('main',[1]),'E_CAPABILITY');
  code(()=>r.call('main',[1],{capability:{}}),'E_CAPABILITY');
  const short=grant(n=>(calls++,n),{maxCalls:1});code(()=>r.call('main',[1],{capability:short}),'E_EFFECT_BUDGET');
  const wrong=createCapability({emit:{parameters:['Bool'],result:'Num',call:()=>{calls++;return 1;}}},{maxCalls:5});
  code(()=>r.call('main',[1],{capability:wrong}),'E_CAPABILITY');
  const cap=grant(n=>(calls++,n));code(()=>r.call('main',[1],{capability:cap,maxHostCalls:1}),'E_EFFECT_BUDGET');assert.equal(calls,0);
});
test('quota is consumed before a host exception, and later invocations use fresh sequence state',async()=>{
  const r=await createRuntime(compile(source));let first=true;
  const cap=grant(n=>{if(first){first=false;throw new Error('host failure');}return n;},{maxCalls:3});
  assert.throws(()=>r.call('main',[1],{capability:cap}),/host failure/);assert.equal(cap.remaining,2);
  assert.equal(r.call('main',[1],{capability:cap}),3);assert.equal(cap.remaining,0);
});
test('argument policy cannot be bypassed with a type-correct value',async()=>{
  const r=await createRuntime(compile(source));let calls=0;
  const cap=createCapability({emit:{parameters:['Num'],result:'Num',validate:n=>Number.isFinite(n)&&n>=0&&n<10,call:n=>(calls++,n)}},{maxCalls:10});
  code(()=>r.call('main',[Infinity],{capability:cap}),'E_EFFECT_POLICY');assert.equal(calls,0);assert.equal(cap.remaining,9);
});
test('revocation takes effect immediately, including between operations',async()=>{
  const r=await createRuntime(compile(source));let cap,calls=0;
  cap=grant(n=>{calls++;cap.revoke();return n;});code(()=>r.call('main',[1],{capability:cap}),'E_CAPABILITY');assert.equal(calls,1);
  code(()=>r.call('main',[1],{capability:cap}),'E_CAPABILITY');
});
test('same-instance and same-capability cross-instance reentry are blocked',async()=>{
  const r=await createRuntime(compile(source)),other=await createRuntime(compile(source));let cap;
  cap=grant(n=>{
    code(()=>r.call('main',[n],{capability:cap}),'E_EFFECT_REENTRANCY');
    code(()=>other.call('main',[n],{capability:cap}),'E_CAPABILITY');return n;
  });assert.equal(r.call('main',[1],{capability:cap}),3);
});
test('async callbacks and non-scalar results are rejected without pretending to undo side effects',async()=>{
  code(()=>grant(async n=>n),'E_CAPABILITY');
  const r=await createRuntime(compile(source));
  const cap=grant(()=>Promise.resolve(1));code(()=>r.call('main',[1],{capability:cap}),'E_EFFECT_ASYNC');assert.equal(cap.remaining,9);
  const bad=grant(()=>true);code(()=>r.call('main',[1],{capability:bad}),'E_ABI_VALUE');
});
test('private broker is unavailable through raw instantiate',async()=>{
  await assert.rejects(()=>instantiate(compile(source)),/createRuntime/);
});
test('host receives copied bytes, not a guest-memory view',async()=>{
  const c=compile('host fn touch(x:Bytes):Num; export fn main(x:Bytes)=effect {perform touch(x); x};');
  const r=await createRuntime(c),cap=createCapability({touch:{parameters:['Bytes'],result:'Num',call:x=>{x[0]=255;return 0;}}},{maxCalls:1});
  assert.deepEqual(r.call('main',[new Uint8Array([1,2])],{capability:cap}),new Uint8Array([1,2]));
});
test('a tampered Wasm body cannot replay an already-consumed sequence token',async()=>{
  const c=compile(source),bytes=c.bytes.slice();
  // Change only the code section's i32.const 1 (second token) into const 0.
  let offset=8;
  const leb=()=>{let n=0,shift=0,b;do{b=bytes[offset++];n|=(b&127)<<shift;shift+=7;}while(b&128);return n>>>0;};
  let changed=false;
  while(offset<bytes.length){const section=bytes[offset++],size=leb(),end=offset+size;if(section===10){for(let i=offset;i<end-1;i++)if(bytes[i]===0x41&&bytes[i+1]===1){bytes[i+1]=0;changed=true;break;}}offset=end;}
  assert.equal(changed,true);assert.equal(WebAssembly.validate(bytes),true);
  const r=await createRuntime(bytes),seen=[],cap=grant(n=>(seen.push(n),n));
  code(()=>r.call('main',[3],{capability:cap}),'E_EFFECT_TOKEN');assert.deepEqual(seen,[3]);assert.equal(cap.remaining,9);
});
test('effectful exports cannot be called or captured as ordinary pure functions',()=>{
  code(()=>compile('host fn emit(n:Num):Num; export fn a(n)=effect {perform emit(n);n}; export fn b(n)=a(n);'),'E_EFFECT');
});
