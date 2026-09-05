import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, instantiate } from '../src/compiler.mjs';
import { createRuntime, Arena, layout, lowerValue, liftResult, readABI, prepareCall, ABIError } from '../src/abi.mjs';
const runtime=async source=>createRuntime(compile(source));
const rejectsCode=(fn,code)=>assert.throws(fn,e=>e.code===code);

test('ASABI 1 has explicit version, fixed little-endian scalar layout and canonical field ordering',()=>{
  const c=compile('export fn main(n:Num,b:Bool)={z:b,a:n};');
  const abi=readABI(c.bytes),result=abi.exports[0].result;
  assert.equal(abi.version,1);assert.equal(abi.byteOrder,'little');
  assert.deepEqual(result.layout,{size:16,align:8,fields:[
    {name:'a',schema:{kind:'Num'},offset:0,size:8,align:8},
    {name:'z',schema:{kind:'Bool'},offset:8,size:4,align:4},
  ]});assert.deepEqual(result.slots,[2,3,4]);
});
test('indirect result wire bytes are independent of JS object layout',async()=>{
  const c=compile('export fn main(n:Num,b:Bool)={z:b,a:n};'),memory=new WebAssembly.Memory({initial:1,maximum:1});
  const i=await instantiate(c,{memory});i.exports.main(1.5,1,0,16,0);
  assert.equal(Buffer.from(memory.buffer,0,12).toString('hex'),'000000000000f83f01000000');
});
test('stable text bytes numeric arrays bool arrays and nested record roundtrips',async()=>{
  const r=await runtime('export fn main(x:{name:Text,data:Bytes,xs:[Num],flags:[Bool],inner:{n:Num}})=x;');
  const arg={name:'\uFEFFÅ字🙂\0',data:new Uint8Array([0,255,128]),xs:new Float64Array([1,-0,NaN,Infinity]),flags:[true,false],inner:{n:7}};
  const out=r.call('main',[arg]);assert.equal(out.name,arg.name);assert.deepEqual(out.data,arg.data);assert.deepEqual(out.xs,arg.xs);assert.deepEqual(out.flags,arg.flags);assert.equal(out.inner.n,7);
});
test('outputs own storage and survive arena reuse; inputs are not mutated',async()=>{
  const r=await runtime('export fn main(xs)=map(xs,x=>x*2);'),input=new Float64Array([1,2,3]);
  const first=r.call('main',[input]);r.call('main',[[8,9,10]]);
  assert.deepEqual([...first],[2,4,6]);assert.deepEqual([...input],[1,2,3]);assert.equal(r.memoryBytes,65536);
});
test('caller capacity overflow traps and runtime frame remains reusable',async()=>{
  const r=await runtime('export fn main(n)=range(n);');
  assert.throws(()=>r.call('main',[10],{outputBytes:8}),WebAssembly.RuntimeError);
  assert.deepEqual([...r.call('main',[3])],[0,1,2]);
});
test('indirect output descriptors and arenas cannot overlap input spans or each other',async()=>{
  const c=compile('export fn main(xs)=map(xs,x=>x+1);'),memory=new WebAssembly.Memory({initial:1,maximum:1});
  new Float64Array(memory.buffer,0,4).set([1,2,3,4]);const i=await instantiate(c,{memory});
  for(const args of [[0,4,0,64,64],[0,4,32,16,64],[0,4,32,32,64],[0,4,65532,64,64],[0,4,32,65528,16]])assert.throws(()=>i.exports.main(...args),WebAssembly.RuntimeError);
  assert.deepEqual([...new Float64Array(memory.buffer,0,4)],[1,2,3,4]);
});
test('Bool streams validate canonical wire elements when demanded',async()=>{
  const c=compile('export fn main(xs:[Bool])=map(xs,x=>!x);'),memory=new WebAssembly.Memory({initial:1});
  new Uint32Array(memory.buffer,0,2).set([1,2]);const i=await instantiate(c,{memory});
  assert.throws(()=>i.exports.main(0,2,8,16,64),WebAssembly.RuntimeError);
});
test('aligned materialized output after a Bool array',async()=>{
  const r=await runtime('export fn main(n)={a:map(range(n),x=>x>0),b:range(n)};');
  const out=r.call('main',[3]);assert.deepEqual(out.a,[false,true,true]);assert.deepEqual([...out.b],[0,1,2]);
});
test('ABI rejects wrong values, sparse arrays, getters and invalid Unicode',async()=>{
  const r=await runtime('export fn main(x:{n:Num,t:Text,xs:[Num]})=x;');
  for(const arg of [{n:true,t:'ok',xs:[]},{n:1,t:'\uD800',xs:[]},{n:1,t:'ok',xs:[,1]},{get n(){throw new Error('must not execute');},t:'ok',xs:[]}])assert.throws(()=>r.call('main',[arg]),ABIError);
  assert.equal(r.call('main',[{n:2,t:'ok',xs:[]}]).n,2);
});
test('malformed UTF-8 and invalid descriptor pointers fail at lifting',()=>{
  const memory=new WebAssembly.Memory({initial:1}),view=new DataView(memory.buffer);
  view.setUint32(0,16,true);view.setUint32(4,1,true);new Uint8Array(memory.buffer)[16]=0xff;
  rejectsCode(()=>liftResult(memory,{kind:'Text'},0),'E_ABI_UTF8');
  view.setUint32(0,65535,true);view.setUint32(4,4,true);
  rejectsCode(()=>liftResult(memory,{kind:'Bytes'},0),'E_ABI_BOUNDS');
});
test('prototype-looking record fields are data, not object prototype mutation',async()=>{
  const r=await runtime('export fn main(x:Num)={__proto__:x,constructor:x+1};'),out=r.call('main',[4]);
  assert.equal(Object.getPrototypeOf(out),Object.prototype);assert.equal(out.__proto__,4);assert.equal(out.constructor,5);
});
test('zero-page runtime supports pure scalar exports and empty records',async()=>{
  const r=await createRuntime(compile('export fn main(x)=x+1;'),{pages:0});assert.equal(r.call('main',[2]),3);assert.equal(r.memoryBytes,0);
  const empty=await createRuntime(compile('export fn main()={};'),{pages:0});assert.deepEqual(empty.call('main'),{});
});
test('ABI version is enforced from binary, not mutable compile sidecar',async()=>{
  const c=compile('export fn main(x)=x+1;');c.abi.version=999;
  assert.equal((await createRuntime(c)).call('main',[2]),3);
  const bytes=c.bytes.slice(),needle=new TextEncoder().encode('"version":1');
  let found=-1;for(let i=0;i<bytes.length-needle.length;i++)if(needle.every((b,j)=>bytes[i+j]===b)){found=i;break;}
  assert.notEqual(found,-1);bytes[found+needle.length-1]=0x32;
  await assert.rejects(()=>createRuntime(bytes),e=>e.code==='E_ABI_VERSION');
});
test('low-level arena refreshes DataViews after host growth and enforces capacity',()=>{
  const memory=new WebAssembly.Memory({initial:1,maximum:2}),arena=new Arena(memory);
  arena.allocate(65536);memory.grow(1);assert.equal(arena.allocate(8),65536);
  assert.equal(arena.view.byteLength,131072);rejectsCode(()=>arena.allocate(131072),'E_ARENA_FULL');
});
test('record row inference supports polymorphic dictionary shapes and rejects missing fields',async()=>{
  const source='fn first(x)=x.a; export fn main()={num:first({a:2,b:true}),bool:first({a:false,c:3})};';
  assert.deepEqual((await runtime(source)).call('main'),{bool:false,num:2});
  assert.throws(()=>compile('fn use(x)=x.a+x.b; export fn main()=use({a:1});'),e=>e.code==='E_TYPE');
  assert.throws(()=>compile('export fn main(x)=x.a+1;'),e=>e.code==='E_ABI');
});
test('record-fold state snapshots preserve simultaneous update and branch scope',async()=>{
  const r=await runtime('export fn main(n)=range(n) |> fold({a:0,b:1},(s,x)=>if x<2 then {a:s.b,b:s.a+s.b} else {a:s.a+10,b:s.b});');
  assert.deepEqual(r.call('main',[4]),{a:21,b:2});
});
test('checked random access handles maps and guards, and rejects invalid indices',async()=>{
  const r=await runtime('export fn main(xs,i)=at(map(xs,x=>x+1),i);');
  assert.equal(r.call('main',[[3,4],1]),5);
  for(const index of [-1,0.5,2,NaN,Infinity])assert.throws(()=>r.call('main',[[3,4],index]),WebAssembly.RuntimeError);
  const ignored=await runtime('export fn main(i)=at(map(range(0),x=>42),i);');assert.throws(()=>ignored.call('main',[0]),WebAssembly.RuntimeError);
});
test('frozen ASABI 1 binary fixture runs without recompiling its source',async()=>{
  const {readFile}=await import('node:fs/promises');
  const bytes=Buffer.from(await readFile(new URL('./fixtures/asabi1-snapshot.wasm.base64',import.meta.url),'utf8'),'base64');
  const golden=JSON.parse(await readFile(new URL('./fixtures/asabi1-snapshot.json',import.meta.url),'utf8'));
  assert.deepEqual(readABI(bytes),golden.abi);
  const out=(await createRuntime(bytes)).call('snapshot',[{label:'golden',values:[1,2,3]}]);
  assert.equal(out.label,'golden');assert.equal(out.total,6);assert.deepEqual([...out.doubled],[2,4,6]);
});
test('conditionals select text, bytes and streams without demanding the inactive branch',async()=>{
  const text=await runtime('export fn main(flag:Bool,a:Text,b:Text)=if flag then a else b;');assert.equal(text.call('main',[true,'left','right']),'left');
  const streams=await runtime('export fn main(flag:Bool,n)=if flag then filter(range(n),x=>x>1) else range(2);');
  assert.deepEqual([...streams.call('main',[false,-1])],[0,1]);assert.deepEqual([...streams.call('main',[true,5])],[2,3,4]);
  const guards=await runtime('export fn main(flag:Bool)=count(if flag then require(false,range(3)) else range(2));');
  assert.equal(guards.call('main',[false]),2);assert.throws(()=>guards.call('main',[true]),WebAssembly.RuntimeError);
});
