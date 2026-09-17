import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compile, checkSources } from '../src/compiler.mjs';
import { ABIError, Arena, lowerValue, createRuntime, createCapability } from '../src/abi.mjs';

const modes = [false,true].flatMap(simd => [false,true].flatMap(reductionFusion =>
  [false,true].map(memoizeReductions => ({simd,reductionFusion,memoizeReductions}))));
const bytesSchema = {kind:'Bytes'};
const source = `
export fn echo = (data:Bytes) -> data;
export fn total = (data:Bytes) -> sum (byte_values data);
export fn size = (data:Bytes) -> byte_length data;
export fn report = (data:Bytes) -> {data, size:byte_length data, total:sum (byte_values data)};
export fn select = (data:Bytes) -> (index:Num) -> {data, selected:at (byte_values data) index};
`;
const rejectsCode = (fn, code) => assert.throws(fn, error => error instanceof ABIError && error.code === code);
function shadow(data, properties) {
  for (const [name,value] of Object.entries(properties)) Object.defineProperty(data,name,{value});
  return data;
}
function poison(data) {
  let calls = 0;
  for (const key of ['length','byteLength','byteOffset','buffer','constructor',Symbol.iterator])
    Object.defineProperty(data,key,{get() { calls++; throw new Error('input hook must not execute'); }});
  return {data, calls:() => calls};
}

// Independent framing oracle: the real input count is three, not any JS property.
test('Bytes reserves and advertises the same intrinsic input interval', () => {
  const memory = new WebAssembly.Memory({initial:1}), arena = new Arena(memory);
  const data = shadow(new Uint8Array([10,20,30]),{byteLength:0});
  const slots = lowerValue(arena,bytesSchema,data);
  assert.deepEqual(slots,[0,3]);
  assert.equal(arena.offset,3);
  assert.equal(arena.highWater,3);
  assert.deepEqual([...new Uint8Array(memory.buffer,0,3)],[10,20,30]);
  assert.equal(arena.allocate(8,4),4, 'descriptor starts after the complete input');
});

test('Bytes ignores unrelated public sizes in all eight lowering configurations', async () => {
  for (const mode of modes) {
    const compiled = compile(source,mode), runtime = await createRuntime(compiled);
    assert.equal(compiled.abi.version,1);
    assert.equal(compiled.stats.intermediateBufferBytes,0);
    for (const properties of [
      {byteLength:0}, {length:0}, {byteLength:1,length:1},
      {byteLength:65537,length:65537}, {byteLength:-1,length:NaN},
    ]) {
      const data = shadow(new Uint8Array([10,20,30]),properties);
      assert.deepEqual([...runtime.call('echo',[data],{outputBytes:0})],[10,20,30]);
      assert.equal(runtime.call('size',[data]),3);
      assert.equal(runtime.call('total',[data]),60);
    }
  }
});

test('Bytes never consults input metadata getters, iterator or species', async () => {
  const runtime = await createRuntime(compile(source));
  const input = poison(new Uint8Array([0,128,255]));
  const result = runtime.call('report',[input.data],{outputBytes:0});
  assert.deepEqual([...result.data],[0,128,255]);
  assert.equal(result.size,3); assert.equal(result.total,383);
  assert.equal(input.calls(),0);
  assert.equal(runtime.highWaterBytes,32, '3 input + 5 alignment + 24 descriptor bytes');
});

test('byte subviews, Uint8Array subclasses and Node Buffer keep their actual span', async () => {
  class Packet extends Uint8Array {
    get length() { throw new Error('subclass length'); }
    get byteLength() { throw new Error('subclass byteLength'); }
  }
  const runtime = await createRuntime(compile(source));
  const backing = Uint8Array.of(201,10,20,30,202);
  const inputs = [new Uint8Array(backing.buffer,1,3), new Packet([10,20,30]),
    Buffer.from([201,10,20,30,202]).subarray(1,4)];
  for (const input of inputs) {
    const data = poison(input);
    assert.deepEqual([...runtime.call('echo',[data.data],{outputBytes:0})],[10,20,30]);
    assert.equal(runtime.call('total',[data.data]),60);
    assert.equal(data.calls(),0);
  }
  assert.deepEqual([...backing],[201,10,20,30,202]);
});

test('seeded byte views use independent content and sum oracles', async () => {
  let seed = 0x42595445;
  const random = () => (seed = (Math.imul(seed,1664525)+1013904223) >>> 0);
  for (const mode of modes) {
    const runtime = await createRuntime(compile(source,mode));
    for (let trial=0; trial<32; trial++) {
      const count = random()%65, offset = random()%9;
      const expected = Array.from({length:count},() => random()%256);
      const backing = new Uint8Array(offset+count+7).fill(203);
      backing.set(expected,offset);
      const before = backing.slice();
      const data = shadow(new Uint8Array(backing.buffer,offset,count),
        {length:random()%100,byteLength:random()%100});
      const result = runtime.call('report',[data],{outputBytes:0});
      assert.deepEqual([...result.data],expected);
      assert.equal(result.size,count);
      assert.equal(result.total,expected.reduce((sum,value) => sum+value,0));
      assert.deepEqual(backing,before);
      if (count) result.data[0] ^= 255;
      assert.deepEqual([...runtime.call('echo',[data],{outputBytes:0})],expected);
    }
  }
});

test('byte capacity is checked against the actual span before any write', () => {
  const memory = new WebAssembly.Memory({initial:1}), arena = new Arena(memory);
  const region = new Uint8Array(memory.buffer);
  region.fill(0xa5); arena.allocate(65533,1);
  const tooLarge = shadow(new Uint8Array([1,2,3,4]),{byteLength:0,length:0});
  rejectsCode(() => lowerValue(arena,bytesSchema,tooLarge),'E_ARENA_FULL');
  assert.equal(arena.offset,65533);
  assert(region.every(value => value === 0xa5), 'capacity failure wrote no bytes');
  const exact = poison(new Uint8Array([10,20,30]));
  assert.deepEqual(lowerValue(arena,bytesSchema,exact.data),[65533,3]);
  assert.equal(arena.offset,65536); assert.equal(exact.calls(),0);
  assert.deepEqual([...region.slice(65532)],[0xa5,10,20,30]);
});

test('empty views reserve no input bytes regardless of public properties', async () => {
  const runtime = await createRuntime(compile('export fn size = (data:Bytes) -> byte_length data;'),{pages:0});
  const empty = shadow(new Uint8Array(0),{byteLength:65537,length:65537});
  assert.equal(runtime.call('size',[empty]),0);
  assert.equal(runtime.highWaterBytes,0);
  const lease = runtime.prepare('size',[empty]);
  try { assert.equal(lease.run(),0); } finally { lease.dispose(); }
});

test('trusted low-level overlapping byte spans retain typed-array copy semantics', () => {
  const memory = new WebAssembly.Memory({initial:1}), arena = new Arena(memory);
  new Uint8Array(memory.buffer,0,7).set([10,20,30,40,50,60,70]);
  const data = shadow(new Uint8Array(memory.buffer,0,4),{byteLength:0,length:0});
  arena.allocate(1,1);
  assert.deepEqual(lowerValue(arena,bytesSchema,data),[1,4]);
  assert.equal(arena.offset,5);
  assert.deepEqual([...new Uint8Array(memory.buffer,0,7)],[10,10,20,30,40,60,70]);
});

test('byte prototype impostors and proxies reject without executing input hooks', async () => {
  const runtime = await createRuntime(compile(source));
  let hooks = 0;
  const proxy = new Proxy(new Uint8Array([1]),{
    get() { hooks++; throw new Error('proxy get'); },
    getPrototypeOf() { hooks++; throw new Error('proxy prototype'); },
  });
  const impostor = Object.create(Uint8Array.prototype,{
    length:{get() { hooks++; return 1; }},
    byteLength:{get() { hooks++; return 1; }},
  });
  for (const input of [null,{},[],new Int8Array(1),new Uint8ClampedArray(1),
    new DataView(new ArrayBuffer(1)),proxy,impostor]) {
    rejectsCode(() => runtime.call('size',[input]),'E_ABI_VALUE');
    rejectsCode(() => runtime.prepare('size',[input]),'E_ABI_VALUE');
    assert.equal(runtime.call('total',[Uint8Array.of(10,20,30)]),60);
  }
  assert.equal(hooks,0);
});

test('detached byte inputs still reject and leave the runtime reusable', async () => {
  const runtime = await createRuntime(compile(source));
  const detached = new Uint8Array([1,2,3]);
  structuredClone(detached.buffer,{transfer:[detached.buffer]});
  assert.throws(() => runtime.call('size',[detached]),TypeError);
  assert.throws(() => runtime.prepare('size',[detached]),TypeError);
  assert.equal(runtime.call('total',[Uint8Array.of(10,20,30)]),60);
});

test('prepared byte snapshots survive caller mutation, output mutation and traps', async () => {
  for (const mode of modes) {
    const runtime = await createRuntime(compile(source,mode));
    const input = shadow(new Uint8Array([10,20,30]),{byteLength:0,length:0});
    const lease = runtime.prepare('select',[input,0],{outputBytes:0});
    let first;
    try {
      input.fill(99);
      first = lease.run();
      assert.equal(first.selected,10); assert.deepEqual([...first.data],[10,20,30]);
      first.data[0] = 88;
      rejectsCode(() => runtime.call('size',[input]),'E_LEASE_BUSY');
      assert.throws(() => lease.run({index:3}),WebAssembly.RuntimeError);
      const after = lease.run({index:2});
      assert.equal(after.selected,30); assert.deepEqual([...after.data],[10,20,30]);
      assert.equal(runtime.highWaterBytes,24, 'input and descriptor are disjoint; no output data region');
    } finally { assert.equal(lease.dispose(),true); }
    assert.equal(lease.dispose(),false);
    rejectsCode(() => lease.run(),'E_LEASE_EXPIRED');
    assert.equal(runtime.call('total',[Uint8Array.of(1,2)]),3);
    assert.deepEqual([...first.data],[88,20,30]);
  }
});

test('failed large byte copies and failed preparation cannot retain stale state', async () => {
  const runtime = await createRuntime(compile(source));
  const tooLarge = shadow(new Uint8Array(65537),{byteLength:0,length:0});
  rejectsCode(() => runtime.call('size',[tooLarge]),'E_ARENA_FULL');
  rejectsCode(() => runtime.prepare('size',[tooLarge]),'E_ARENA_FULL');
  assert.equal(runtime.highWaterBytes,0);
  assert.deepEqual([...runtime.call('echo',[Uint8Array.of(10,20,30)],{outputBytes:0})],[10,20,30]);
});

test('byte effects receive owned copies with exact performed-call sequencing', async () => {
  const effect = `host fn inspect: Bytes -> Num;
export fn main = (data:Bytes) -> effect {
  let first = perform inspect data;
  let second = perform inspect data;
  {first,second,after:sum (byte_values data)}
};`;
  for (const mode of modes) {
    const runtime = await createRuntime(compile(effect,mode)), seen = [];
    const capability = createCapability({inspect:{parameters:['Bytes'],result:'Num',call(data) {
      seen.push([...data]);
      const sum = [...data].reduce((a,b) => a+b,0); data.fill(99); return sum;
    }}},{maxCalls:2});
    rejectsCode(() => runtime.call('main',[Object.create(Uint8Array.prototype)],{capability}),'E_ABI_VALUE');
    assert.equal(capability.remaining,2); assert.deepEqual(seen,[]);
    const input = poison(Uint8Array.of(10,20,30));
    assert.deepEqual(runtime.call('main',[input.data],{capability,outputBytes:0}),{after:60,first:60,second:60});
    assert.deepEqual(seen,[[10,20,30],[10,20,30]]);
    assert.equal(capability.remaining,0); assert.equal(input.calls(),0);
  }
});

test('wrong guest byte types keep source-located rejection in unused definitions', () => {
  const source = '// invalid unused helper\nfn unused = (data:Bool) -> byte_length data;\nexport fn main = () -> 7;';
  const checked = checkSources([{name:'bytes-client.ass',source}]);
  assert.equal(checked.ok,false);
  const diagnostic = checked.diagnostics[0];
  assert.equal(diagnostic.code,'E_TYPE'); assert.equal(diagnostic.sourceName,'bytes-client.ass');
  assert.equal(diagnostic.range.start.offset,source.indexOf('byte_length'));
});

test('documented byte input and source snippets execute together', async () => {
  const doc = await readFile(new URL('../docs/BYTES-INPUT-INTEGRITY.md',import.meta.url),'utf8');
  const source = /<!-- bytes-integrity-source -->\n```ass\n([\s\S]*?)\n```/.exec(doc)?.[1];
  const host = /<!-- bytes-integrity-host -->\n```js\n([\s\S]*?)\n```/.exec(doc)?.[1];
  assert(source && host);
  const runtime = await createRuntime(compile(source));
  const result = new Function('runtime',`${host}\nreturn result;`)(runtime);
  assert.deepEqual([...result],[10,20,30]);
});
