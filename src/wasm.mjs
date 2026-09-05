import { planReductionFusion } from './fusion.mjs';
import { ABI_VERSION, layout, flatTypes } from './abi-schema.mjs';
// Direct Wasm binary emission. No WAT parser, LLVM, binaryen, or runtime library.
const wasmType = type => type === 'Num' ? 0x7c : 0x7f;
export function uleb(value) {
  const bytes = [];
  do { const b = value & 127; value >>>= 7; bytes.push(b | (value ? 128 : 0)); } while (value);
  return bytes;
}
function sleb(value) {
  const bytes = [];
  while (true) {
    const byte = value & 127; value >>= 7;
    const done = (value === 0 && !(byte & 64)) || (value === -1 && (byte & 64));
    bytes.push(byte | (done ? 0 : 128)); if (done) return bytes;
  }
}
const vector = entries => [...uleb(entries.length), ...entries.flat()];
const text = value => { const bytes = [...new TextEncoder().encode(value)]; return [...uleb(bytes.length), ...bytes]; };
const section = (id, data) => [id, ...uleb(data.length), ...data];
const f64bytes = value => {
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value, true); return [...new Uint8Array(view.buffer)];
};

function lowerKernel(kernel, { memoizeReductions = true, experimentalReductionFusion = false } = {}, steps = []) {
  const fusionGroups = [];
  const code = [], locals = []; let loops = 0, runtimeChecks = 0, zipChecks = 0, stores = 0, memoizedReductions = 0, stateMachines = 0, stateSlots = 0, boundedIterations = 0;
  const emit = (...bytes) => code.push(...bytes);
  const allocate = type => { locals.push(type); return kernel.abi.length + locals.length - 1; };
  const get = local => emit(0x20, ...uleb(local));
  const set = local => emit(0x21, ...uleb(local));
  const i32 = value => emit(0x41, ...sleb(value));
  const f64 = value => emit(0x44, ...f64bytes(value));
  const trapUnless = () => emit(0x45, 0x04, 0x40, 0x00, 0x0b);
  const noteGuard = guard => {
    runtimeChecks++;
    const containsZip=n=>n.op==='same_extent'||n.args.some(containsZip);
    if(containsZip(guard))zipChecks++;
  };
  const copyContext = ctx => ({ ...ctx, cache: new Map(ctx.cache), indices: new Map(ctx.indices), accumulators: new Map(ctx.accumulators), groups: new Map(ctx.groups), lazy: new Map(ctx.lazy), bypass: new Set(ctx.bypass) });
  const root = { fusionAllowed: experimentalReductionFusion, cohorts: new Map(), cache: new Map(), indices: new Map(), accumulators: new Map(), groups: new Map(), lazy: new Map(), bypass: new Set() };
  function load(node, ctx) { get(evaluate(node, ctx)); }
  function region(nodes, ctx) {
    const completed = new Map([...ctx.cache, ...ctx.groups, ...ctx.lazy]);
    return { ...ctx, cohorts: ctx.fusionAllowed
      ? planReductionFusion(nodes, steps, completed) : new Map() };
  }
  function loadRegion(node, ctx) { load(node, region(node, ctx)); }
  function disableFusion(ctx) { ctx.fusionAllowed = false; ctx.cohorts = new Map(); }
  function resultRoots(value) {
    if (value.kind === 'record') return [...value.fields.values()].flatMap(resultRoots);
    return value.kind === 'scalar' ? [value] : [];
  }
  function reduceCohort(requested, ctx) {
    const peers = ctx.cohorts.get(requested.id).filter(n =>
      !ctx.cache.has(n.id) && !ctx.groups.has(n.id) && !ctx.lazy.has(n.id));
    const nodes = [requested, ...peers.filter(n => n !== requested)];
    const outer = { ...ctx, cohorts: new Map() };
    if (nodes.length < 2) {
      if (requested.op === 'reduce') evaluate(requested, outer);
      else evaluateGroup(requested, outer);
      return;
    }
    const stream = requested.stream;
    const frames = nodes.map(node => ({ node,
      initial: node.op === 'reduce' ? [node.initial] : node.initial,
      acc: node.op === 'reduce' ? [node.acc] : node.acc,
      body: node.op === 'reduce' ? [node.body] : node.body,
    }));
    for (const guard of stream.guards) { load(guard, outer); trapUnless(); noteGuard(guard); }
    const extent = evaluate(stream.extent, outer);
    for (const f of frames) {
      f.targets = f.initial.map(n => allocate(n.type));
      f.initial.forEach((n, i) => { load(n, outer); set(f.targets[i]); });
    }
    const index = allocate('I32'); i32(0); set(index);
    const body = copyContext(outer); disableFusion(body);
    invalidateBindings(body, [...stream.indices.map(n => n.id), ...frames.flatMap(f => f.acc.map(n => n.id))]);
    for (const identity of stream.indices) body.indices.set(identity.id, index);
    for (const f of frames) f.acc.forEach((n, i) => body.accumulators.set(n.id, f.targets[i]));
    const machines = prepareMachines(stream, body);
    loops++; emit(0x02, 0x40, 0x03, 0x40);
    get(index); get(extent); emit(0x4f, 0x0d, 0x01);
    stepMachines(machines, body);
    if (stream.mask) { load(stream.mask, body); emit(0x04, 0x40); }
    // Snapshot every component before changing any accumulator, including
    // record-valued folds. Each recurrence retains its original f64 ordering.
    const snapshots = frames.map(f => f.body.map(n => {
      const local = allocate(n.type); load(n, body); set(local); return local;
    }));
    frames.forEach((f, i) => snapshots[i].forEach((v, j) => { get(v); set(f.targets[j]); }));
    if (stream.mask) emit(0x0b);
    get(index); i32(1); emit(0x6a); set(index); emit(0x0c, 0x00, 0x0b, 0x0b);
    for (const f of frames) {
      knownNodes.set(f.node.id, f.node);
      if (f.node.op === 'reduce') ctx.cache.set(f.node.id, f.targets[0]);
      else ctx.groups.set(f.node.id, f.targets);
    }
    fusionGroups.push({ domain: steps[stream.proof].domain,
      reductions: nodes.map(n => n.id), streams: nodes.map(n => n.stream.proof),
      stateMachines: stream.machines.length });
  }
  const dependencyCache=new Map(), knownNodes=new Map();
  function dependencies(node) {
    knownNodes.set(node.id,node);
    if(dependencyCache.has(node.id))return dependencyCache.get(node.id);
    const deps=new Set();dependencyCache.set(node.id,deps);
    if(node.op==='index' || node.op==='acc' || node.op==='cell')deps.add(node.id);
    for(const child of scalarChildren(node))for(const id of dependencies(child))deps.add(id);
    if(node.op==='reduce' || node.op==='reduce_group') {
      for(const i of node.stream.indices)deps.delete(i.id);
      for(const a of Array.isArray(node.acc)?node.acc:[node.acc])deps.delete(a.id);
      for(const m of node.stream.machines)for(const a of [...m.acc,...m.cells])deps.delete(a.id);
    }
    if(node.op==='iterate_group')for(const a of node.acc)deps.delete(a.id);
    return deps;
  }
  const machineRoots = stream => stream.machines.flatMap(m=>[...m.initial,...m.body,...m.outputs,m.emission,...(m.gate?[m.gate]:[])]);
  function scalarChildren(node) {
    if(node.op==='iterate_group')return [...node.initial,...node.body,node.done,node.limit];
    if(node.op==='reduce' || node.op==='reduce_group') {
      return [...node.args,node.stream.extent,...node.stream.guards,...(node.stream.mask?[node.stream.mask]:[]),
        ...[node.initial,node.body].flat(),...machineRoots(node.stream)];
    }
    return node.args;
  }
  function invalidateBindings(ctx,ids) {
    const changed=new Set(ids);
    for(const cache of [ctx.cache,ctx.groups,ctx.lazy])for(const id of cache.keys()) {
      const node=knownNodes.get(id);
      if(node && [...dependencies(node)].some(d=>changed.has(d)))cache.delete(id);
    }
  }
  function planLoopMemo(roots,parent,body) {
    if(!memoizeReductions)return;
    const available=new Set([...parent.indices.keys(),...parent.accumulators.keys()]), seen=new Set();
    function visit(node) {
      if(seen.has(node.id))return;seen.add(node.id);
      if(['reduce','reduce_group','iterate_group'].includes(node.op) && !body.lazy.has(node.id) &&
          !parent.cache.has(node.id) && !parent.groups.has(node.id) && [...dependencies(node)].every(id=>available.has(id))) {
        const flag=allocate('I32'), targets=[...(node.op==='reduce'?[node.initial]:node.initial).map(n=>n.type),...(node.op==='iterate_group'?['Num','Bool']:[])].map(allocate);
        i32(0);set(flag);body.lazy.set(node.id,{flag,targets});memoizedReductions++;
        // This reduction's nested computations are planned by its own loop.
        return;
      }
      for(const child of scalarChildren(node))visit(child);
    }
    roots.filter(Boolean).forEach(visit);
  }
  function forceLazy(node,ctx,group=false) {
    const entry=ctx.lazy.get(node.id);
    get(entry.flag);emit(0x45,0x04,0x40);
    const inner=copyContext(ctx);inner.bypass.add(node.id);
    const values=group?(node.op==='iterate_group'?evaluateIteration(node,inner):evaluateGroup(node,inner)):[evaluate(node,inner)];
    values.forEach((v,i)=>{get(v);set(entry.targets[i]);});i32(1);set(entry.flag);emit(0x0b);
    if(group)ctx.groups.set(node.id,entry.targets);else ctx.cache.set(node.id,entry.targets[0]);
    return group?entry.targets:entry.targets[0];
  }

  function evaluate(node, ctx) {
    knownNodes.set(node.id,node);
    if (ctx.cache.has(node.id)) return ctx.cache.get(node.id);
    if (ctx.lazy.has(node.id) && !ctx.bypass.has(node.id)) return forceLazy(node,ctx);
    if (node.op === 'wire') return node.data.index;
    if (node.op === 'index') {
      if (!ctx.indices.has(node.id)) throw new Error('Unbound iteration index');
      return ctx.indices.get(node.id);
    }
    if (node.op === 'acc' || node.op === 'cell') {
      if (!ctx.accumulators.has(node.id)) throw new Error('Unbound reduction accumulator');
      return ctx.accumulators.get(node.id);
    }
    if (node.op==='reduce_field') return evaluateGroup(node.args[0],ctx)[node.data];
    if (node.op==='iterate_field') return evaluateIteration(node.args[0],ctx)[node.data];
    if (node.op === 'reduce' && ctx.cohorts.has(node.id)) {
      reduceCohort(node, ctx); return ctx.cache.get(node.id);
    }
    const target = allocate(node.type), a = node.args;
    if (node.op === 'const') {
      node.type === 'Num' ? f64(node.data) : i32(node.data);
    } else if (node.op === 'if' || node.op === '&&' || node.op === '||') {
      loadRegion(a[0], ctx); emit(0x04, wasmType(node.type));
      const yes = copyContext(ctx), no = copyContext(ctx);
      if (node.op === 'if') loadRegion(a[1], yes);
      else if (node.op === '&&') loadRegion(a[1], yes);
      else i32(1);
      emit(0x05);
      if (node.op === 'if') loadRegion(a[2], no);
      else if (node.op === '||') loadRegion(a[1], no);
      else i32(0);
      emit(0x0b);
    } else if (node.op === 'extent') {
      const n = evaluate(a[0], ctx);
      get(n); f64(0); emit(0x66); trapUnless(); // n >= 0, also rejects NaN
      get(n); f64(2147483647); emit(0x65); trapUnless();
      get(n); get(n); emit(0x9c, 0x61); trapUnless(); // n == floor(n)
      get(n); emit(0xab); // i32.trunc_f64_u after validation
    } else if(node.op==='host_call') {
      for(const arg of a) load(arg,ctx);
      emit(0x10,...uleb(node.data));
    } else if(node.op==='guard') {
      loadRegion(a[0],ctx); trapUnless(); loadRegion(a[1],ctx);
    } else if(node.op==='checked_index') {
      const n=evaluate(a[0],ctx), extent=evaluate(a[1],ctx);
      get(n); f64(0); emit(0x66); trapUnless();
      get(n); get(extent); emit(0xb8,0x63); trapUnless(); // n < extent
      get(n); get(n); emit(0x9c,0x61); trapUnless();
      get(n); emit(0xab);
    } else if(node.op==='index_valid') {
      load(a[0],ctx); emit(0x1a); i32(1);
    } else if(node.op==='byte_load' || node.op==='bool_load') {
      load(a[0],ctx); load(a[1],ctx);
      if(node.op==='bool_load') { i32(2); emit(0x74); }
      emit(0x6a);
      if(node.op==='byte_load') emit(0x2d,0x00,0x00,0xb8);
      else {
        emit(0x28,0x02,0x00); set(target);
        get(target); i32(1); emit(0x4d); trapUnless(); get(target);
      }
    } else if (node.op === 'load') {
      load(a[0], ctx); load(a[1], ctx); i32(3); emit(0x74, 0x6a, 0x2b, 0x03, 0x00);
    } else if (node.op === 'to_num') {
      load(a[0], ctx); emit(0xb8);
    } else if (node.op === 'same_extent') {
      load(a[0], ctx); load(a[1], ctx); emit(0x46);
    } else if (node.op === 'reduce') {
      const stream = node.stream;
      for (const guard of stream.guards) { load(guard, ctx); trapUnless(); noteGuard(guard); }
      const extent = evaluate(stream.extent, ctx);
      load(node.initial, ctx); set(target);
      const index = allocate('I32'); i32(0); set(index);
      const bodyContext = copyContext(ctx); disableFusion(bodyContext);
      invalidateBindings(bodyContext,[...stream.indices.map(i=>i.id),node.acc.id]);
      for (const identity of stream.indices) bodyContext.indices.set(identity.id, index);
      bodyContext.accumulators.set(node.acc.id, target);
      const machines=prepareMachines(stream,bodyContext);
      planLoopMemo([stream.mask,node.body,...machineRoots(stream)],ctx,bodyContext);
      loops++;
      emit(0x02, 0x40, 0x03, 0x40); // block(exit) { loop(next) {
      get(index); get(extent); emit(0x4f, 0x0d, 0x01); // br_if exit when i >= length
      stepMachines(machines,bodyContext);
      if (stream.mask) { load(stream.mask, bodyContext); emit(0x04, 0x40); }
      load(node.body, bodyContext); set(target);
      if (stream.mask) emit(0x0b);
      get(index); i32(1); emit(0x6a); set(index);
      emit(0x0c, 0x00, 0x0b, 0x0b); // br next; end loop; end block
      ctx.cache.set(node.id, target); return target;
    } else {
      const operations = {
        '+': 0xa0, '-': 0xa1, '*': 0xa2, '/': 0xa3,
        '==': 0x61, '!=': 0x62, '<': 0x63, '>': 0x64, '<=': 0x65, '>=': 0x66,
        neg: 0x9a, not: 0x45, abs: 0x99, sqrt: 0x9f, floor: 0x9c, min: 0xa4, max: 0xa5,
      };
      if (operations[node.op] === undefined) throw new Error(`No Wasm lowering for ${node.op}`);
      for (const arg of a) load(arg, ctx);
      emit(operations[node.op]);
    }
    set(target); ctx.cache.set(node.id, target); return target;
  }
  // A machine is a scalar state frame, owned by this traversal, not a heap
  // object. Its gate is the upstream event clock, never a downstream filter.
  function prepareMachines(stream,ctx) {
    invalidateBindings(ctx,stream.machines.flatMap(m=>[...m.acc,...m.cells].map(n=>n.id)));
    return stream.machines.map(machine=>{
      const flag=allocate('I32');i32(0);set(flag);
      const state=machine.initial.map(n=>allocate(n.type));
      const cells=machine.cells.map(n=>allocate(n.type));
      machine.acc.forEach((n,i)=>ctx.accumulators.set(n.id,state[i]));
      machine.cells.forEach((n,i)=>ctx.accumulators.set(n.id,cells[i]));
      stateMachines++;stateSlots+=state.length;
      return {machine,flag,state,cells};
    });
  }
  function stepMachines(frames,ctx) {
    for(const {machine:m,flag,state,cells} of frames) {
      if(m.gate){load(m.gate,ctx);emit(0x04,0x40);}
      // No cache entry made in a conditional step escapes its scope.
      const step=copyContext(ctx);
      get(flag);emit(0x45,0x04,0x40);
      const init=copyContext(step);
      m.initial.forEach((n,i)=>{load(n,init);set(state[i]);});i32(1);set(flag);emit(0x0b);
      const next=m.body.map(n=>{const t=allocate(n.type);load(n,step);set(t);return t;});
      load(m.emission,step);set(cells.at(-1));
      get(cells.at(-1));emit(0x04,0x40);
      const output=copyContext(step);
      m.outputs.forEach((n,i)=>{load(n,output);set(cells[i]);});emit(0x0b);
      // Simultaneous state update: output sees the OLD state and current input.
      next.forEach((v,i)=>{get(v);set(state[i]);});
      if(m.gate)emit(0x0b);
    }
  }
  function evaluateIteration(node,ctx) {
    knownNodes.set(node.id,node);
    if(ctx.groups.has(node.id))return ctx.groups.get(node.id);
    if(ctx.lazy.has(node.id) && !ctx.bypass.has(node.id))return forceLazy(node,ctx,true);
    const limit=evaluate(node.limit,ctx),targets=node.initial.map(n=>allocate(n.type));
    node.initial.forEach((n,i)=>{load(n,ctx);set(targets[i]);});
    const count=allocate('I32'),done=allocate('Bool');i32(0);set(count);i32(0);set(done);
    const body=copyContext(ctx);disableFusion(body);invalidateBindings(body,node.acc.map(a=>a.id));
    node.acc.forEach((a,i)=>body.accumulators.set(a.id,targets[i]));
    planLoopMemo([...node.body,node.done],ctx,body);
    loops++;boundedIterations++;emit(0x02,0x40,0x03,0x40);
    get(count);get(limit);emit(0x4f);get(done);emit(0x72,0x0d,0x01);
    const next=node.body.map(n=>{const t=allocate(n.type);load(n,body);set(t);return t;});
    load(node.done,body);set(done);
    next.forEach((v,i)=>{get(v);set(targets[i]);});
    get(count);i32(1);emit(0x6a);set(count);emit(0x0c,0x00,0x0b,0x0b);
    const steps=allocate('Num');get(count);emit(0xb8);set(steps);
    const result=[...targets,steps,done];ctx.groups.set(node.id,result);return result;
  }
  function evaluateGroup(node,ctx) {
    knownNodes.set(node.id,node);
    if(ctx.groups.has(node.id)) return ctx.groups.get(node.id);
    if(ctx.lazy.has(node.id) && !ctx.bypass.has(node.id))return forceLazy(node,ctx,true);
    if(ctx.cohorts.has(node.id)) { reduceCohort(node,ctx); return ctx.groups.get(node.id); }
    const targets=node.initial.map(n=>allocate(n.type)), stream=node.stream;
    for(const guard of stream.guards) {load(guard,ctx);trapUnless();noteGuard(guard);}
    const extent=evaluate(stream.extent,ctx);
    node.initial.forEach((n,i)=>{load(n,ctx);set(targets[i]);});
    const index=allocate('I32'); i32(0);set(index);
    const bodyContext=copyContext(ctx); disableFusion(bodyContext);
    invalidateBindings(bodyContext,[...stream.indices.map(i=>i.id),...node.acc.map(a=>a.id)]);
    for(const identity of stream.indices) bodyContext.indices.set(identity.id,index);
    node.acc.forEach((a,i)=>bodyContext.accumulators.set(a.id,targets[i]));
    const machines=prepareMachines(stream,bodyContext);
    planLoopMemo([stream.mask,...node.body,...machineRoots(stream)],ctx,bodyContext);
    loops++; emit(0x02,0x40,0x03,0x40);
    get(index);get(extent);emit(0x4f,0x0d,0x01);
    stepMachines(machines,bodyContext);
    if(stream.mask) {load(stream.mask,bodyContext);emit(0x04,0x40);}
    // Snapshot ALL next-state components before changing any accumulator local.
    const next=node.body.map(n=>{const temp=allocate(n.type);load(n,bodyContext);set(temp);return temp;});
    next.forEach((v,i)=>{get(v);set(targets[i]);});
    if(stream.mask) emit(0x0b);
    get(index);i32(1);emit(0x6a);set(index);emit(0x0c,0,0x0b,0x0b);
    ctx.groups.set(node.id,targets);return targets;
  }
  // Every borrowed input is checked at entry, including inputs not later demanded.
  function checkSpan(pointer,length,stride) {
    get(pointer);i32(stride-1);emit(0x71,0x45);trapUnless();
    get(length);i32(2147483647);emit(0x4d);trapUnless();
    get(pointer);emit(0xad);get(length);emit(0xad,0x42,...sleb(stride),0x7e,0x7c);
    emit(0x3f,0,0xad,0x42,...sleb(65536),0x7e,0x58);trapUnless();
  }
  for(const p of kernel.inputLeaves) {
    if(p.stride) checkSpan(p.slots[0],p.slots[1],p.stride);
    else if(p.type==='Bool') {get(p.slots[0]);i32(1);emit(0x4d);trapUnless();}
  }
  let cursor,end;
  if(kernel.indirect) {
    const [ret,out,capacity]=kernel.outputSlots, size=layout(kernel.resultSchema).size;
    const len=allocate('I32');i32(size);set(len);checkSpan(ret,len,1);checkSpan(out,capacity,1);
    get(ret);i32(layout(kernel.resultSchema).align-1);emit(0x71,0x45);trapUnless();
    get(out);i32(7);emit(0x71,0x45);trapUnless();
    // Keep output cursors representable and non-wrapping within the v1 arena.
    get(out);emit(0xad);get(capacity);emit(0xad,0x7c,0x42,...sleb(2147483647),0x58);trapUnless();
    const ranges=[{pointer:ret,length:len,stride:1},{pointer:out,length:capacity,stride:1}];
    const nonoverlap=(a,b)=>{
      // Empty ranges never conflict. Endpoints are compared in i64 arithmetic.
      get(a.length);emit(0x45);get(b.length);emit(0x45,0x72);
      const endpoint=r=>{get(r.pointer);emit(0xad);get(r.length);emit(0xad,0x42,...sleb(r.stride),0x7e,0x7c);};
      endpoint(a);get(b.pointer);emit(0xad,0x58,0x72);
      endpoint(b);get(a.pointer);emit(0xad,0x58,0x72);trapUnless();
    };
    nonoverlap(ranges[0],ranges[1]);
    for(const input of kernel.inputLeaves.filter(p=>p.stride)) {
      const r={pointer:input.slots[0],length:input.slots[1],stride:input.stride};
      for(const output of ranges) nonoverlap(output,r);
    }
    cursor=allocate('I32');get(out);set(cursor);
    end=allocate('I32');get(out);get(capacity);emit(0x6a);set(end);
  }
  // All host effects are forced exactly once, in source order, before the result.
  for(const effect of kernel.effects) evaluate(effect,root);
  const resultContext = region(resultRoots(kernel.result), root);
  function writeDescriptor(base,offset,type,valueLocal) {
    get(base);get(valueLocal);emit(type==='Num'?0x39:0x36,type==='Num'?3:2,...uleb(offset));stores++;
  }
  function writeResult(value,schema,base,offset=0) {
    if(schema.kind==='Record') {
      for(const f of layout(schema).fields) writeResult(value.fields.get(f.name),f.schema,base,offset+f.offset);
      return;
    }
    if(schema.kind==='Num' || schema.kind==='Bool') {writeDescriptor(base,offset,schema.kind,evaluate(value,resultContext));return;}
    if(schema.kind==='Text' || schema.kind==='Bytes') {
      // Borrowed result data is valid through the call frame; JS lifting copies it.
      writeDescriptor(base,offset,'I32',evaluate(value.pointer,resultContext));
      writeDescriptor(base,offset+4,'I32',evaluate(value.extent,resultContext));return;
    }
    const stream=value, stride=schema.element.kind==='Num'?8:4;
    // Each array starts at an 8-byte boundary, including after a Bool array.
    get(cursor);i32(7);emit(0x6a);i32(-8);emit(0x71);set(cursor);
    get(cursor);get(end);emit(0x4d);trapUnless();
    const begin=allocate('I32'), count=allocate('I32'), index=allocate('I32');
    get(cursor);set(begin);i32(0);set(count);i32(0);set(index);
    for(const guard of stream.guards) {load(guard,resultContext);trapUnless();noteGuard(guard);}
    const extent=evaluate(stream.extent,resultContext), ctx=copyContext(resultContext);
    disableFusion(ctx);
    invalidateBindings(ctx,stream.indices.map(i=>i.id));
    for(const identity of stream.indices) ctx.indices.set(identity.id,index);
    const machines=prepareMachines(stream,ctx);
    planLoopMemo([stream.mask,stream.item,...machineRoots(stream)],resultContext,ctx);
    loops++;emit(0x02,0x40,0x03,0x40);
    get(index);get(extent);emit(0x4f,0x0d,1);
    stepMachines(machines,ctx);
    if(stream.mask){load(stream.mask,ctx);emit(0x04,0x40);}
    get(end);get(cursor);emit(0x6b);i32(stride);emit(0x4f);trapUnless();
    get(cursor);load(stream.item,ctx);emit(stride===8?0x39:0x36,stride===8?3:2,0);stores++;
    get(cursor);i32(stride);emit(0x6a);set(cursor);get(count);i32(1);emit(0x6a);set(count);
    if(stream.mask)emit(0x0b);
    get(index);i32(1);emit(0x6a);set(index);emit(0x0c,0,0x0b,0x0b);
    writeDescriptor(base,offset,'I32',begin);writeDescriptor(base,offset+4,'I32',count);
  }
  if(kernel.indirect) {writeResult(kernel.result,kernel.resultSchema,kernel.outputSlots[0]);get(cursor);}
  else loadRegion(kernel.result,root);
  emit(0x0b);
  const declarations = vector(locals.map(type => [1, wasmType(type)]));
  const body = [...declarations, ...code];
  return { bytes: [...uleb(body.length), ...body], locals: locals.length,
    localBytes: locals.reduce((n, t) => n + (t === 'Num' ? 8 : 4), 0), loops, runtimeChecks, zipChecks, stores, memoizedReductions, stateMachines, stateSlots, boundedIterations,
    reductionFusion: { enabled: experimentalReductionFusion, groups: fusionGroups,
      eliminatedLoops: fusionGroups.reduce((n, g) => n + g.reductions.length - 1, 0) } };
}

export function emitModule(staged, options = {}) {
  const kernels=staged.kernels, hosts=staged.hostDeclarations, bodies=kernels.map(k=>lowerKernel(k,options,staged.certificate.steps));
  const needsMemory=kernels.some(k=>k.indirect || k.inputLeaves.some(p=>p.stride));
  const functionType=(args,result)=>[0x60,...vector(args.map(t=>[wasmType(t)])),1,wasmType(result)];
  const types=[...hosts.map(h=>functionType(['I32',...h.parameters.flatMap(flatTypes)],h.result.kind)),...kernels.map(k=>functionType(k.abi,k.resultType))];
  const imports=hosts.map((h,i)=>[...text('asslang_host'),...text(h.name),0x00,...uleb(i)]);
  if(needsMemory) imports.push([...text('env'),...text('memory'),0x02,0x00,0x00]);
  const contract={version:ABI_VERSION,addressBits:32,byteOrder:'little',memory:'env.memory',
    hosts:hosts.map(({name,parameters,result})=>({name,parameters,result})),
    exports:kernels.map(k=>({name:k.name,parameters:k.parameters,result:{schema:k.resultSchema,
      mode:k.indirect?'indirect':'scalar',slots:k.outputSlots,layout:layout(k.resultSchema)},
      effects:k.effects.map((e,sequence)=>({sequence,name:hosts[e.data].name}))}))};
  const pieces=[
    [0,0x61,0x73,0x6d,1,0,0,0],section(1,vector(types)),
    ...(imports.length?[section(2,vector(imports))]:[]),
    section(3,vector(kernels.map((_,i)=>uleb(i+hosts.length)))),
    section(7,vector(kernels.map((k,i)=>[...text(k.name),0,...uleb(i+hosts.length)]))),
    section(10,vector(bodies.map(b=>b.bytes))),
    section(0,[...text('asslang.abi'),...new TextEncoder().encode(JSON.stringify(contract))]),
  ];
  return {bytes:Uint8Array.from(pieces.flat()),needsMemory,contract,abiMetadataBytes:pieces.at(-1).length,
    functions:kernels.map((k,i)=>({name:k.name,loops:bodies[i].loops,wasmLocals:bodies[i].locals,
      wasmLocalValueBytes:bodies[i].localBytes,runtimeZipChecks:bodies[i].zipChecks,runtimeStreamChecks:bodies[i].runtimeChecks,
      outputStoreSites:bodies[i].stores,hostCallSites:k.effects.length,memoizedReductions:bodies[i].memoizedReductions,stateMachines:bodies[i].stateMachines,stateSlots:bodies[i].stateSlots,boundedIterations:bodies[i].boundedIterations,reductionFusion:bodies[i].reductionFusion}))};
}
