import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/compiler.mjs';
import { ABIError, Arena, lowerValue, createRuntime, createCapability } from '../src/abi.mjs';

const modes = [false,true].flatMap(simd => [false,true].flatMap(reductionFusion =>
  [false,true].map(memoizeReductions => ({simd,reductionFusion,memoizeReductions}))));
const bytes = {kind:'Bytes'};
const nums = {kind:'Stream',element:{kind:'Num'}};
const source = `
export fn byte_count = (data:Bytes) -> byte_length data;
export fn byte_total = (data:Bytes) -> sum (byte_values data);
export fn numeric_count = (data:[Num]) -> count data;
export fn numeric_total = (data:[Num]) -> sum data;
`;
const rejectsValue = fn => assert.throws(fn, error =>
  error instanceof ABIError && error.code === 'E_ABI_VALUE');

function detach(view) {
  structuredClone(view.buffer,{transfer:[view.buffer]});
  return view;
}
function outOfBounds(Ctor) {
  const bytesPerElement = Ctor.BYTES_PER_ELEMENT;
  const buffer = new ArrayBuffer(bytesPerElement*4,{maxByteLength:bytesPerElement*8});
  const view = new Ctor(buffer,bytesPerElement*2,2);
  buffer.resize(bytesPerElement);
  return view;
}
function poisoned(view) {
  let calls = 0;
  for (const key of ['length','byteLength','byteOffset','buffer','constructor',Symbol.iterator])
    Object.defineProperty(view,key,{get(){ calls++; throw new Error('input hook must not execute'); }});
  return {view,calls:()=>calls};
}

// Old main leaked native TypeError here and the f64 path could align the arena first.
test('detached typed inputs normalize before low-level arena mutation', () => {
  for (const [schema,value] of [[bytes,detach(Uint8Array.of(1,2,3))],[nums,detach(Float64Array.of(1,2,3))]]) {
    const memory = new WebAssembly.Memory({initial:1}), arena = new Arena(memory);
    new Uint8Array(memory.buffer).fill(0xa5); arena.allocate(3,1);
    rejectsValue(() => lowerValue(arena,schema,value));
    assert.equal(arena.offset,3); assert.equal(arena.highWater,3);
    assert(new Uint8Array(memory.buffer).every(byte => byte === 0xa5));
  }
});

test('resizable-buffer out-of-bounds typed inputs reject like detached inputs', () => {
  for (const [schema,Ctor] of [[bytes,Uint8Array],[nums,Float64Array]]) {
    const memory = new WebAssembly.Memory({initial:1}), arena = new Arena(memory);
    arena.allocate(5,1);
    rejectsValue(() => lowerValue(arena,schema,outOfBounds(Ctor)));
    assert.equal(arena.offset,5); assert.equal(arena.highWater,5);
  }
});

test('valid empty typed views remain distinct from invalid zero-length views', () => {
  for (const [schema,value,alignment] of [[bytes,new Uint8Array(0),1],[nums,new Float64Array(0),8]]) {
    const memory = new WebAssembly.Memory({initial:1}), arena = new Arena(memory);
    arena.allocate(3,1);
    const expectedPointer = alignment === 8 ? 8 : 3;
    assert.deepEqual(lowerValue(arena,schema,value),[expectedPointer,0]);
    assert.equal(arena.offset,expectedPointer);
  }
});

test('valid subviews, subclasses, Buffer and poisoned metadata retain no-hook behavior', () => {
  class BytesPacket extends Uint8Array {}
  class NumericPacket extends Float64Array {}
  const cases = [
    [bytes,new Uint8Array(Uint8Array.of(9,10,20,30,8).buffer,1,3),[10,20,30]],
    [bytes,new BytesPacket([10,20,30]),[10,20,30]],
    [bytes,Buffer.from([9,10,20,30,8]).subarray(1,4),[10,20,30]],
    [nums,new Float64Array(Float64Array.of(9,1,2,3,8).buffer,8,3),[1,2,3]],
    [nums,new NumericPacket([1,2,3]),[1,2,3]],
  ];
  for (const [schema,value,expected] of cases) {
    const p = poisoned(value);
    const memory = new WebAssembly.Memory({initial:1}), arena = new Arena(memory);
    const [pointer,length] = lowerValue(arena,schema,p.view);
    assert.equal(length,expected.length); assert.equal(p.calls(),0);
    if (schema.kind === 'Bytes') assert.deepEqual([...new Uint8Array(memory.buffer,pointer,length)],expected);
    else assert.deepEqual([...new Float64Array(memory.buffer,pointer,length)],expected);
  }
});



test('typed proxies and prototype impostors reject without executing hooks', () => {
  let hooks = 0;
  const numericProxy = new Proxy(Float64Array.of(1,2),{
    getPrototypeOf(){ hooks++; throw new Error('proxy prototype must not run'); },
    get(){ hooks++; throw new Error('proxy get must not run'); },
  });
  const byteProxy = new Proxy(Uint8Array.of(1,2),{
    getPrototypeOf(){ hooks++; throw new Error('proxy prototype must not run'); },
    get(){ hooks++; throw new Error('proxy get must not run'); },
  });
  const numericImpostor = Object.create(Float64Array.prototype,{
    length:{get(){hooks++;return 2;}}, byteLength:{get(){hooks++;return 16;}},
  });
  const byteImpostor = Object.create(Uint8Array.prototype,{
    length:{get(){hooks++;return 2;}}, byteLength:{get(){hooks++;return 2;}},
  });
  for (const [schema,value] of [[nums,numericProxy],[bytes,byteProxy],[nums,numericImpostor],[bytes,byteImpostor]]) {
    const memory = new WebAssembly.Memory({initial:1}), arena = new Arena(memory);
    rejectsValue(() => lowerValue(arena,schema,value));
    assert.equal(arena.offset,0);
  }
  assert.equal(hooks,0);
});

test('managed and prepared calls normalize both typed families and recover', async () => {
  const runtime = await createRuntime(compile(source));
  for (const [name,value] of [
    ['byte_count',detach(Uint8Array.of(1,2,3))],
    ['numeric_count',detach(Float64Array.of(1,2,3))],
    ['byte_count',outOfBounds(Uint8Array)],
    ['numeric_count',outOfBounds(Float64Array)],
  ]) {
    rejectsValue(() => runtime.call(name,[value]));
    rejectsValue(() => runtime.prepare(name,[value]));
    assert.equal(runtime.call('byte_total',[Uint8Array.of(10,20,30)]),60);
    assert.equal(runtime.call('numeric_total',[Float64Array.of(1,2,3)]),6);
  }
});

test('typed-view rejection is stable across all lowering configurations', async () => {
  for (const mode of modes) {
    const runtime = await createRuntime(compile(source,mode));
    rejectsValue(() => runtime.call('byte_count',[detach(Uint8Array.of(1))]));
    rejectsValue(() => runtime.call('numeric_count',[detach(Float64Array.of(1))]));
    assert.equal(runtime.call('byte_total',[Uint8Array.of(1,2,3)]),6);
    assert.equal(runtime.call('numeric_total',[Float64Array.of(1,2,3)]),6);
  }
});

test('invalid typed inputs do not consume performed-call authority', async () => {
  const effectSource = `host fn inspect: Num -> Num;
export fn bytes = (data:Bytes) -> effect { let n = perform inspect 1; n + byte_length data };
export fn nums = (data:[Num]) -> effect { let n = perform inspect 1; n + count data };`;
  const runtime = await createRuntime(compile(effectSource));
  let calls = 0;
  const capability = createCapability({inspect:{parameters:['Num'],result:'Num',call(x){calls++;return x;}}},{maxCalls:2});
  rejectsValue(() => runtime.call('bytes',[detach(Uint8Array.of(1))],{capability}));
  rejectsValue(() => runtime.call('nums',[outOfBounds(Float64Array)],{capability}));
  assert.equal(calls,0); assert.equal(capability.remaining,2);
  assert.equal(runtime.call('bytes',[Uint8Array.of(1,2)],{capability}),3);
  assert.equal(runtime.call('nums',[Float64Array.of(1,2,3)],{capability}),4);
  assert.equal(calls,2); assert.equal(capability.remaining,0);
});
