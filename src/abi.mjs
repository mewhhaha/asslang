import { ABI_VERSION, alignTo, layout, flatTypes, isScalarSchema } from './abi-schema.mjs';
export { ABI_VERSION, layout } from './abi-schema.mjs';

/** Stable-ASABI framing error. Guest traps remain WebAssembly.RuntimeError. */
export class ABIError extends Error {
  constructor(message, code = 'E_ABI_VALUE') { super(message); this.name = 'ABIError'; this.code = code; }
}
const bad = (message, code) => { throw new ABIError(message, code); };
const integer = (n, max = 0x7fffffff) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

function checkSchema(schema, depth = 0, budget = { count: 0 }) {
  if (!schema || typeof schema !== 'object' || depth > 24 || ++budget.count > 4096) bad('Invalid or excessive ABI schema', 'E_ABI_SCHEMA');
  if (['Num','Bool','Text','Bytes'].includes(schema.kind)) return;
  if (schema.kind === 'Stream' && ['Num','Bool'].includes(schema.element?.kind)) return;
  if (schema.kind !== 'Record' || !Array.isArray(schema.fields) || schema.fields.length > 128) bad('Unsupported ABI schema', 'E_ABI_SCHEMA');
  let previous = null;
  for (const f of schema.fields) {
    if (typeof f.name !== 'string' || !/^[A-Za-z_]\w*$/.test(f.name) || previous !== null && f.name <= previous) bad('Record fields must be unique and ASCII-sorted', 'E_ABI_SCHEMA');
    previous = f.name; checkSchema(f.schema, depth + 1, budget);
  }
}

/** Read the versioned, self-describing ABI from a .wasm binary or module.
 * This validates layout metadata, not the behavior or trustworthiness of code.
 */
export function readABI(moduleOrBytes) {
  const module = moduleOrBytes instanceof WebAssembly.Module ? moduleOrBytes : new WebAssembly.Module(moduleOrBytes);
  const sections = WebAssembly.Module.customSections(module, 'asslang.abi');
  if (sections.length !== 1 || sections[0].byteLength > 1_000_000) bad('Exactly one bounded asslang.abi section is required', 'E_ABI_VERSION');
  let abi;
  try { abi = JSON.parse(decoder.decode(sections[0])); } catch { bad('Malformed ABI metadata', 'E_ABI_SCHEMA'); }
  if (abi.version !== ABI_VERSION || abi.addressBits !== 32 || abi.byteOrder !== 'little') bad('Unsupported ASABI version or memory model', 'E_ABI_VERSION');
  if (!Array.isArray(abi.exports) || !Array.isArray(abi.hosts) || abi.exports.length > 1024 || abi.hosts.length > 256) bad('Invalid ABI function tables', 'E_ABI_SCHEMA');
  const names = new Set();
  for (const h of abi.hosts) {
    if (typeof h.name !== 'string' || names.has(h.name) || !Array.isArray(h.parameters) || h.parameters.length > 128) bad('Invalid host declaration', 'E_ABI_SCHEMA');
    names.add(h.name); h.parameters.forEach(s => checkSchema(s)); checkSchema(h.result);
    if (!isScalarSchema(h.result)) bad('Host results must be scalar', 'E_ABI_SCHEMA');
  }
  names.clear();
  for (const f of abi.exports) {
    if (typeof f.name !== 'string' || names.has(f.name) || !Array.isArray(f.parameters) || f.parameters.length > 128 || !Array.isArray(f.effects) || f.effects.length > 100000) bad('Invalid export declaration', 'E_ABI_SCHEMA');
    names.add(f.name); let slot = 0;
    for (const p of f.parameters) {
      checkSchema(p.schema); const expected = flatTypes(p.schema).map(() => slot++);
      if (JSON.stringify(p.slots) !== JSON.stringify(expected)) bad('Invalid flattened parameter slots', 'E_ABI_SCHEMA');
    }
    checkSchema(f.result?.schema);
    const indirect = !isScalarSchema(f.result.schema);
    if (f.result.mode !== (indirect ? 'indirect' : 'scalar') || JSON.stringify(f.result.layout) !== JSON.stringify(layout(f.result.schema)) ||
        JSON.stringify(f.result.slots) !== JSON.stringify(indirect ? [slot,slot+1,slot+2] : [])) bad('Result layout or slots do not match schema', 'E_ABI_SCHEMA');
    f.effects.forEach((e,i) => { if(e.sequence !== i || !abi.hosts.some(h => h.name === e.name)) bad('Invalid effect trace', 'E_ABI_SCHEMA'); });
  }
  return abi;
}

/** Fixed-capacity, resettable frame allocator. No memory.grow and no guest GC.
 * This low-level API is for trusted hosts; createRuntime keeps its arena private.
 */
export class Arena {
  constructor(memory) {
    if (!(memory instanceof WebAssembly.Memory) || typeof SharedArrayBuffer !== 'undefined' && memory.buffer instanceof SharedArrayBuffer) bad('An unshared WebAssembly.Memory is required');
    if (memory.buffer.byteLength > 0x7fffffff) bad('ASABI 1 managed arenas are limited to 2 GiB - 1 bytes');
    this.memory = memory; this.offset = 0; this.highWater = 0;
  }
  get view() { return new DataView(this.memory.buffer); }
  allocate(bytes, alignment = 8) {
    if (!integer(bytes) || ![1,2,4,8].includes(alignment)) bad('Invalid allocation size or alignment');
    const pointer = alignTo(this.offset, alignment), end = pointer + bytes;
    if (end > this.memory.buffer.byteLength || end > 0x7fffffff) bad('Call exceeds fixed arena capacity', 'E_ARENA_FULL');
    this.offset = end; this.highWater = Math.max(this.highWater, end); return pointer;
  }
  reset({ scrub = false } = {}) {
    if (scrub) new Uint8Array(this.memory.buffer).fill(0);
    this.offset = 0;
  }
}
function ownField(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) bad('Expected a record object');
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor || !('value' in descriptor)) bad(`Record requires an own data field '${name}' (no getters)`);
  return descriptor.value;
}
export function scalarToWire(schema, value) {
  if (schema.kind === 'Num') { if (typeof value !== 'number') bad('Num requires a JavaScript number'); return value; }
  if (schema.kind === 'Bool') { if (typeof value !== 'boolean') bad('Bool requires a JavaScript boolean'); return Number(value); }
  bad('Not a scalar schema');
}
export function scalarFromWire(schema, value) {
  if (schema.kind === 'Num' && typeof value === 'number') return value;
  if (schema.kind === 'Bool' && (value === 0 || value === 1)) return Boolean(value);
  bad('Invalid scalar wire value');
}
function wellFormed(text) {
  for (let i=0;i<text.length;i++) {
    const c=text.charCodeAt(i);
    if(c>=0xd800 && c<=0xdbff) {const d=text.charCodeAt(++i);if(!(d>=0xdc00 && d<=0xdfff))return false;}
    else if(c>=0xdc00 && c<=0xdfff)return false;
  }
  return true;
}
/** Encode one value to flattened core-Wasm arguments, copying borrowed inputs. */
export function lowerValue(arena, schema, value) {
  if (isScalarSchema(schema)) return [scalarToWire(schema, value)];
  if (schema.kind === 'Record') return schema.fields.flatMap(f => lowerValue(arena, f.schema, ownField(value, f.name)));
  if (schema.kind === 'Text') {
    if (typeof value !== 'string' || !wellFormed(value)) bad('Text requires a Unicode string without unpaired surrogates');
    const pointer = arena.allocate(0,1), available = arena.memory.buffer.byteLength - pointer;
    if (value.length > available) bad('Text exceeds arena capacity','E_ARENA_FULL');
    const { read, written } = encoder.encodeInto(value, new Uint8Array(arena.memory.buffer,pointer,available));
    if (read !== value.length) bad('UTF-8 text exceeds arena capacity','E_ARENA_FULL');
    arena.allocate(written,1); return [pointer,written];
  }
  if (schema.kind === 'Bytes') {
    if (!(value instanceof Uint8Array)) bad('Bytes requires Uint8Array');
    const pointer = arena.allocate(value.byteLength,1);
    new Uint8Array(arena.memory.buffer,pointer,value.length).set(value); return [pointer,value.length];
  }
  const element = schema.element.kind, stride = element === 'Num' ? 8 : 4;
  if (!(Array.isArray(value) || element === 'Num' && value instanceof Float64Array)) bad('Expected an Array, or Float64Array for [Num]');
  const pointer = arena.allocate(value.length * stride, stride), view = arena.view;
  for (let i=0;i<value.length;i++) {
    // Array getters are rejected; typed-array indexed access is intrinsic.
    const v = Array.isArray(value) ? Object.getOwnPropertyDescriptor(value,String(i)) : { value:value[i] };
    if(!v || !('value' in v)) bad('Arrays must be dense data properties (no getters)');
    const wire = scalarToWire(schema.element,v.value);
    if(element === 'Num') view.setFloat64(pointer+i*stride,wire,true); else view.setUint32(pointer+i*stride,wire,true);
  }
  return [pointer,value.length];
}
export function checkedSpan(memory,pointer,length,stride=1) {
  if(!integer(pointer,0xffffffff) || !integer(length) || pointer%stride || pointer+length*stride>memory.buffer.byteLength) bad('Span is outside memory or misaligned','E_ABI_BOUNDS');
}
function decodeSpan(memory,schema,pointer,length) {
  const stride=schema.kind==='Stream' ? (schema.element.kind==='Num'?8:4) : 1;
  checkedSpan(memory,pointer,length,stride);
  if(schema.kind==='Text') {
    try {return decoder.decode(new Uint8Array(memory.buffer,pointer,length));} catch {bad('Text contains invalid UTF-8','E_ABI_UTF8');}
  }
  if(schema.kind==='Bytes') return new Uint8Array(memory.buffer,pointer,length).slice();
  const view=new DataView(memory.buffer);
  if(schema.element.kind==='Num') {
    const result=new Float64Array(length);
    for(let i=0;i<length;i++)result[i]=view.getFloat64(pointer+i*8,true);
    return result;
  }
  return Array.from({length},(_,i)=>scalarFromWire(schema.element,view.getUint32(pointer+i*4,true)));
}
/** Lift flattened input slots. Composite data is copied before calling JS. */
export function liftFlat(memory,schema,slots,cursor={index:0}) {
  if(isScalarSchema(schema))return scalarFromWire(schema,slots[cursor.index++]);
  if(schema.kind==='Record') {
    const result={};for(const f of schema.fields) Object.defineProperty(result,f.name,{value:liftFlat(memory,f.schema,slots,cursor),enumerable:true});return result;
  }
  const pointer=slots[cursor.index++]>>>0,length=slots[cursor.index++]>>>0;
  return decodeSpan(memory,schema,pointer,length);
}
/** Lift an indirect result descriptor. Returned JS data owns its storage. */
export function liftResult(memory,schema,pointer) {
  checkedSpan(memory,pointer,layout(schema).size);
  if(pointer%layout(schema).align)bad('Misaligned result descriptor','E_ABI_BOUNDS');
  const view=new DataView(memory.buffer);
  if(schema.kind==='Num')return view.getFloat64(pointer,true);
  if(schema.kind==='Bool')return scalarFromWire(schema,view.getUint32(pointer,true));
  if(schema.kind==='Record') {
    const result={};for(const f of layout(schema).fields)Object.defineProperty(result,f.name,{value:liftResult(memory,f.schema,pointer+f.offset),enumerable:true});return result;
  }
  return decodeSpan(memory,schema,view.getUint32(pointer,true),view.getUint32(pointer+4,true));
}

/** Lower a complete call once. Useful for low-level hosts and kernel benchmarks.
 * The caller owns arena lifetime, exclusive access and post-call lifting.
 */
export function prepareCall(arena,contract,args,{outputBytes}={}) {
  if(!Array.isArray(args) || args.length!==contract.parameters.length)bad('Incorrect export argument count');
  const slots=contract.parameters.flatMap((p,i)=>lowerValue(arena,p.schema,args[i]));
  let resultPointer=null, outputStart=null, capacity=0;
  if(contract.result.mode==='indirect') {
    const l=layout(contract.result.schema);resultPointer=arena.allocate(l.size,l.align);
    outputStart=arena.allocate(0,8);
    capacity=outputBytes ?? arena.memory.buffer.byteLength-outputStart;
    arena.allocate(capacity,8);slots.push(resultPointer,outputStart,capacity);
  }
  return {slots,resultPointer,outputStart,capacity,
    lift(raw) {
      if(resultPointer===null)return scalarFromWire(contract.result.schema,raw);
      if(!integer(raw,0xffffffff) || raw<outputStart || raw>outputStart+capacity)bad('Invalid output cursor','E_ABI_BOUNDS');
      return liftResult(arena.memory,contract.result.schema,resultPointer);
    }};
}

const grants=new WeakMap();
function normalizeSchema(value) {
  let schema;
  if(typeof value==='string') schema=value==='[Num]'?{kind:'Stream',element:{kind:'Num'}}:value==='[Bool]'?{kind:'Stream',element:{kind:'Bool'}}:{kind:value};
  else schema=structuredClone(value);
  checkSchema(schema);return schema;
}
const schemaKey = schema => JSON.stringify(schema);
/** Mint a host-owned capability. No capability or function is placed in Wasm memory.
 * Each function has an exact ABI contract and an optional synchronous argument policy.
 */
export function createCapability(definitions,{maxCalls=0}={}) {
  if(!integer(maxCalls))bad('maxCalls must be a nonnegative integer','E_CAPABILITY');
  const handlers=new Map();
  for(const name of Object.keys(definitions)) {
    const d=ownField(definitions,name);
    if(!Array.isArray(d.parameters) || typeof d.call!=='function' || d.validate!==undefined && typeof d.validate!=='function')bad('Capability entries require parameters, result and call','E_CAPABILITY');
    const parameters=d.parameters.map(normalizeSchema),result=normalizeSchema(d.result);
    if(!isScalarSchema(result))bad('Host results currently must be Num or Bool','E_CAPABILITY');
    if(d.call.constructor?.name==='AsyncFunction' || d.validate?.constructor?.name==='AsyncFunction')bad('Async capabilities require a future async protocol','E_CAPABILITY');
    handlers.set(name,{parameters,result,call:d.call,validate:d.validate});
  }
  const state={handlers,remaining:maxCalls,revoked:false,inUse:false};
  const capability=Object.freeze({revoke(){state.revoked=true;},get remaining(){return state.remaining;}});
  grants.set(capability,state);return capability;
}

/** Instantiate a private, fixed-capacity call arena and a deny-by-default broker.
 * call() is synchronous, non-reentrant and returns copied values. No instance,
 * memory, handler, or numeric token is exposed by this high-level adapter.
 */
export async function createRuntime(compiledOrBytes,{pages=1}={}) {
  if(!integer(pages,32767))bad('pages must be between 0 and 32767');
  const bytes=compiledOrBytes?.bytes ?? compiledOrBytes;
  const module=await WebAssembly.compile(bytes),abi=readABI(module);
  const memory=new WebAssembly.Memory({initial:pages,maximum:pages}),arena=new Arena(memory);
  const hostMap=new Map(abi.hosts.map(h=>[h.name,h])),exports=new Map(abi.exports.map(f=>[f.name,f]));
  let active=null,busy=false,preparedLease=null,leaseGeneration=0;
  const hostImports=Object.create(null);
  for(const h of abi.hosts)hostImports[h.name]=(sequence,...wires)=>{
    const session=active, state=session?.grant;
    if(!session || !state || state.revoked)bad('No active capability','E_CAPABILITY');
    const expected=session.contract.effects[session.sequence];
    if(sequence!==session.sequence || expected?.name!==h.name)bad('Effect token replay or out-of-order use','E_EFFECT_TOKEN');
    if(session.remaining<=0 || state.remaining<=0)bad('Host-call budget exhausted','E_EFFECT_BUDGET');
    const handler=state.handlers.get(h.name);
    if(!handler)bad('Host operation not granted','E_CAPABILITY');
    // Consume the linear permission BEFORE lifting, policy code or host execution.
    session.sequence++;session.remaining--;state.remaining--;
    const cursor={index:0},args=h.parameters.map(s=>liftFlat(memory,s,wires,cursor));
    if(cursor.index!==wires.length)bad('Host import wire arity mismatch','E_ABI_VALUE');
    if(handler.validate && handler.validate(...args)!==true)bad('Host argument policy rejected the call','E_EFFECT_POLICY');
    const result=handler.call(...args);
    if(result && typeof result.then==='function')bad('Host returned a Promise; async effects are unsupported','E_EFFECT_ASYNC');
    return scalarToWire(h.result,result);
  };
  for(const entry of WebAssembly.Module.imports(module)) {
    if(entry.kind==='memory' && entry.module==='env' && entry.name==='memory')continue;
    if(entry.kind==='function' && entry.module==='asslang_host' && hostMap.has(entry.name))continue;
    bad('Module requests an undeclared import','E_CAPABILITY');
  }
  const instance=await WebAssembly.instantiate(module,{env:{memory},asslang_host:hostImports});
  return Object.freeze({
    abi:structuredClone(abi),
    get memoryBytes(){return memory.buffer.byteLength;},
    get highWaterBytes(){return arena.highWater;},
    /** Copy fixed inputs once and lend this runtime to one prepared pure call.
     * No borrowed JS view escapes. Scalar parameters may be overridden per run.
     * dispose() invalidates the handle and clears all retained memory.
     */
    prepare(name,args=[],{outputBytes}={}) {
      if(busy || preparedLease)bad('Runtime already has an active call or input lease','E_LEASE_BUSY');
      const contract=exports.get(name);if(!contract)bad(`Unknown export '${name}'`);
      if(contract.effects.length)bad('Prepared calls are pure-only; effects need an explicit per-call capability','E_LEASE_EFFECT');
      busy=true;
      let frame;
      try {frame=prepareCall(arena,contract,args,{outputBytes});}
      catch(error){arena.reset({scrub:true});throw error;}
      finally{busy=false;}
      const epoch=++leaseGeneration,identity={};preparedLease=identity;
      const scalarParameters=new Map(contract.parameters.filter(p=>isScalarSchema(p.schema)).map(p=>[p.name,p]));
      let disposed=false;
      const valid=()=>{if(disposed || preparedLease!==identity || leaseGeneration!==epoch)bad('Input lease has expired','E_LEASE_EXPIRED');};
      return Object.freeze({
        generation:epoch,
        run(overrides={}) {
          valid();if(busy)bad('Reentrant prepared call is forbidden','E_EFFECT_REENTRANCY');
          busy=true;
          try {
            if(!overrides || typeof overrides!=='object' || Array.isArray(overrides) || ArrayBuffer.isView(overrides))bad('Scalar overrides must be a record');
            const slots=[...frame.slots];
            for(const name of Object.keys(overrides)) {
              const p=scalarParameters.get(name);
              if(!p)bad(`Only top-level scalar parameters can be overridden: '${name}'`,'E_LEASE_OVERRIDE');
              slots[p.slots[0]]=scalarToWire(p.schema,ownField(overrides,name));
            }
            return frame.lift(instance.exports[name](...slots));
          } finally {
            // Preserve the pinned inputs, not stale result descriptors or output.
            if(frame.resultPointer!==null)new Uint8Array(memory.buffer,frame.resultPointer).fill(0);
            busy=false;
          }
        },
        dispose() {
          if(disposed)return false;
          valid();if(busy)bad('Cannot dispose a running input lease','E_LEASE_BUSY');
          disposed=true;preparedLease=null;leaseGeneration++;arena.reset({scrub:true});return true;
        },
        get disposed(){return disposed;},
      });
    },
    call(name,args=[],{capability,maxHostCalls=32,outputBytes}={}) {
      if(busy)bad('Reentrant invocation is forbidden','E_EFFECT_REENTRANCY');
      if(preparedLease)bad('Dispose the prepared input lease before a normal call','E_LEASE_BUSY');
      if(!integer(maxHostCalls))bad('Invalid per-invocation host-call budget','E_EFFECT_BUDGET');
      const contract=exports.get(name);if(!contract)bad(`Unknown export '${name}'`);
      const state=capability===undefined?null:grants.get(capability);
      if(capability!==undefined && !state)bad('Forged capability','E_CAPABILITY');
      if(state?.revoked || state?.inUse)bad('Capability is revoked or already in use','E_CAPABILITY');
      if(contract.effects.length) {
        if(!state)bad('This export needs an explicit capability','E_CAPABILITY');
        if(contract.effects.length>maxHostCalls || contract.effects.length>state.remaining)bad('Insufficient effect budget','E_EFFECT_BUDGET');
        for(const {name} of contract.effects) {
          const h=hostMap.get(name), handler=state.handlers.get(name);
          if(!handler || schemaKey(handler.parameters)!==schemaKey(h.parameters) || schemaKey(handler.result)!==schemaKey(h.result))bad(`Capability does not grant the exact '${name}' contract`,'E_CAPABILITY');
        }
      }
      busy=true;if(state)state.inUse=true;
      active={contract,grant:state,sequence:0,remaining:maxHostCalls};
      try {
        const frame=prepareCall(arena,contract,args,{outputBytes});
        const raw=instance.exports[name](...frame.slots);
        if(active.sequence!==contract.effects.length)bad('Incomplete effect trace','E_EFFECT_TOKEN');
        return frame.lift(raw);
      } finally {
        active=null;busy=false;if(state)state.inUse=false;
        // No stale input or unwritten output bytes survive into another call.
        arena.reset({scrub:true});
      }
    },
  });
}
