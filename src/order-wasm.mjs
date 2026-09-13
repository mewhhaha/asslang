// Native stable row ordering. All buffers belong to the caller's disjoint,
// bounded invocation scratch span; no host comparator or memory.grow exists.
export function createOrderEmitter(orders, scratch, api) {
  const { allocate, get, set, i32, f64, emit, load, evaluate, copyContext, disableFusion,
    invalidateBindings, prepareMachines, stepMachines, planLoopMemo, machineRoots,
    loopHeader, trapUnless, noteGuard } = api;
  const frames = new Map(orders.map(node => [node.id, {
    pointer: allocate('I32'), count: allocate('I32'), flag: allocate('I32'),
  }]));
  for (const frame of frames.values()) { i32(0); set(frame.flag); }
  const address = (base, index, stride) => { get(base); get(index); i32(stride); emit(0x6c, 0x6a); };
  const increment = local => { get(local); i32(1); emit(0x6a); set(local); };
  const loopEnd = () => emit(0x0c, 0, 0x0b, 0x0b);
  function materialize(node, ctx) {
    const frame = frames.get(node.id), { stream, payload, keys, stride } = node;
    if (!frame) throw new Error('Unregistered ordering site');
    get(frame.flag); emit(0x45, 0x04, 0x40);
    // A private completion flag is necessary even when another branch or a
    // repeated downstream traversal is the first to demand this same order.
    const outer = copyContext(ctx); disableFusion(outer);
    for (const guard of stream.guards) { load(guard, outer); trapUnless(); noteGuard(guard); }
    const extent = evaluate(stream.extent, outer);
    get(extent); get(scratch.end); get(scratch.cursor); emit(0x6b);
    i32(2*stride); emit(0x6e, 0x4d); trapUnless();
    const other = allocate('I32');
    get(scratch.cursor); set(frame.pointer);
    get(scratch.cursor); get(extent); i32(stride); emit(0x6c, 0x6a); set(other);
    get(other); get(extent); i32(stride); emit(0x6c, 0x6a); set(scratch.cursor);
    i32(0); set(frame.count);
    const index = allocate('I32'); i32(0); set(index);
    const body = copyContext(outer); disableFusion(body);
    invalidateBindings(body, stream.indices.map(n => n.id));
    for (const identity of stream.indices) body.indices.set(identity.id, index);
    const machines = prepareMachines(stream, body);
    planLoopMemo([stream.mask, ...payload, ...keys, ...machineRoots(stream)], outer, body);
    loopHeader(() => { get(index); get(extent); emit(0x4f); });
    stepMachines(machines, body);
    if (stream.mask) { load(stream.mask, body); emit(0x04, 0x40); }
    // Strict rows, then a cached key tuple. Consumer projection cannot silently skip
    // payload validation at the materialization barrier.
    const values = payload.map(n => evaluate(n, body));
    keys.forEach((key, i) => {
      const keyValue = evaluate(key, body);
      get(keyValue); get(keyValue); emit(0xa1); f64(0); emit(0x61); trapUnless();
      address(frame.pointer, frame.count, stride); get(keyValue); emit(0x39, 3, ...api.uleb(8*i));
    });
    values.forEach((value, i) => {
      address(frame.pointer, frame.count, stride); get(value);
      const offset = 8*(i+keys.length);
      api.store(payload[i].type, offset);
      if (payload[i].type === 'Bool') {
        address(frame.pointer, frame.count, stride); i32(0); api.store('Bool', offset+4);
      }
    });
    increment(frame.count);
    if (stream.mask) emit(0x0b);
    increment(index); loopEnd();

    const width = allocate('I32'), start = allocate('I32'), middle = allocate('I32');
    const end = allocate('I32'), left = allocate('I32'), right = allocate('I32');
    const out = allocate('I32'), chosen = allocate('I32'), swap = allocate('I32');
    i32(1); set(width);
    // All four loops (source/pass/run/row) use the ordinary invocation meter.
    loopHeader(() => { get(width); get(frame.count); emit(0x4f); });
    i32(0); set(start);
    loopHeader(() => { get(start); get(frame.count); emit(0x4f); });
    get(start); get(width); emit(0x6a); set(middle);
    get(middle); get(frame.count); emit(0x4b, 0x04, 0x40);
    get(frame.count); set(middle); emit(0x0b);
    get(start); get(width); i32(2); emit(0x6c, 0x6a); set(end);
    get(end); get(frame.count); emit(0x4b, 0x04, 0x40);
    get(frame.count); set(end); emit(0x0b);
    get(start); set(left); get(middle); set(right); get(start); set(out);
    const takeLeft = () => { get(left); set(chosen); increment(left); };
    const takeRight = () => { get(right); set(chosen); increment(right); };
    loopHeader(() => { get(out); get(end); emit(0x4f); });
    get(left); get(middle); emit(0x49, 0x04, 0x40);
      get(right); get(end); emit(0x49, 0x04, 0x40);
        // Compare cached components only. All key expressions and finite checks
        // already ran at the materialization barrier, including later keys.
        function lessEqual(component) {
          const offset = api.uleb(8*component);
          address(frame.pointer, left, stride); emit(0x2b, 3, ...offset);
          if (component === keys.length-1) {
            address(frame.pointer, right, stride); emit(0x2b, 3, ...offset);
            emit(0x65); // Scalar/singleton path retains its original instructions.
            return;
          }
          const a = allocate('Num'), b = allocate('Num'); set(a);
          address(frame.pointer, right, stride); emit(0x2b, 3, ...offset); set(b);
          get(a); get(b); emit(0x61, 0x04, 0x7f);
          lessEqual(component+1);
          emit(0x05); get(a); get(b); emit(0x65, 0x0b);
        }
        lessEqual(0); emit(0x04, 0x40); // Left bias preserves complete-key ties.
        takeLeft(); emit(0x05); takeRight(); emit(0x0b);
      emit(0x05); takeLeft(); emit(0x0b);
    emit(0x05); takeRight(); emit(0x0b);
    for (let offset = 0; offset < stride; offset += 8) {
      address(other, out, stride); address(frame.pointer, chosen, stride);
      // Copy bits, including signed zeros and nonfinite payloads, without f64 arithmetic.
      emit(0x29, 3, ...api.uleb(offset), 0x37, 3, ...api.uleb(offset));
    }
    increment(out); loopEnd();
    get(end); set(start); loopEnd();
    get(frame.pointer); set(swap); get(other); set(frame.pointer); get(swap); set(other);
    get(width); i32(2); emit(0x6c); set(width); loopEnd();
    i32(1); set(frame.flag);
    emit(0x0b);
    return frame.pointer;
  }
  return { materialize, frame: node => frames.get(node.id) };
}
