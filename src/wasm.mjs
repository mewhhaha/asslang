import { planReductionFusion } from './fusion.mjs';

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

function lowerKernel(kernel, steps, experimentalReductionFusion) {
  const code = [], locals = [], fusionGroups = []; let loops = 0, runtimeChecks = 0;
  const emit = (...bytes) => code.push(...bytes);
  const allocate = type => { locals.push(type); return kernel.abi.length + locals.length - 1; };
  const get = local => emit(0x20, ...uleb(local));
  const set = local => emit(0x21, ...uleb(local));
  const i32 = value => emit(0x41, ...sleb(value));
  const f64 = value => emit(0x44, ...f64bytes(value));
  const trapUnless = () => emit(0x45, 0x04, 0x40, 0x00, 0x0b);
  const copyContext = ctx => ({ ...ctx, cache: new Map(ctx.cache), indices: new Map(ctx.indices), accumulators: new Map(ctx.accumulators) });
  const root = { cache: new Map(), indices: new Map(), accumulators: new Map(),
    fusionAllowed: experimentalReductionFusion, groups: new Map() };
  function load(node, ctx) { get(evaluate(node, ctx)); }
  function loadRegion(node, ctx) {
    const groups = ctx.fusionAllowed ? planReductionFusion(node, steps, ctx.cache) : new Map();
    load(node, { ...ctx, groups });
  }
  function reduce(nodes, ctx, target) {
    const stream = nodes[0].stream;
    const targets = [target, ...nodes.slice(1).map(n => allocate(n.type))];
    for (const guard of stream.guards) { load(guard, ctx); trapUnless(); runtimeChecks++; }
    const extent = evaluate(stream.extent, ctx);
    nodes.forEach((node, i) => { load(node.initial, ctx); set(targets[i]); });
    const index = allocate('I32'); i32(0); set(index);
    const bodyContext = copyContext(ctx);
    // Do not carry outer cohorts into per-iteration scopes. Nested reductions
    // remain on the baseline path until their capture/lifetime rules are proved.
    bodyContext.fusionAllowed = false; bodyContext.groups = new Map();
    for (const identity of stream.indices) bodyContext.indices.set(identity.id, index);
    nodes.forEach((node, i) => bodyContext.accumulators.set(node.acc.id, targets[i]));
    loops++;
    emit(0x02, 0x40, 0x03, 0x40); // block(exit) { loop(next) {
    get(index); get(extent); emit(0x4f, 0x0d, 0x01); // br_if exit when i >= length
    if (stream.mask) { load(stream.mask, bodyContext); emit(0x04, 0x40); }
    // One independent accumulator per reduction: never reassociate f64 folds.
    // The shared context reuses demanded loads, maps and predicates per event.
    nodes.forEach((node, i) => { load(node.body, bodyContext); set(targets[i]); });
    if (stream.mask) emit(0x0b);
    get(index); i32(1); emit(0x6a); set(index);
    emit(0x0c, 0x00, 0x0b, 0x0b); // br next; end loop; end block
    nodes.forEach((node, i) => ctx.cache.set(node.id, targets[i]));
    if (nodes.length > 1) fusionGroups.push({ domain: steps[stream.proof].domain,
      reductions: nodes.map(n => n.id), streams: nodes.map(n => n.stream.proof) });
    return target;
  }
  function evaluate(node, ctx) {
    if (ctx.cache.has(node.id)) return ctx.cache.get(node.id);
    if (node.op === 'wire') return node.data.index;
    if (node.op === 'index') {
      if (!ctx.indices.has(node.id)) throw new Error('Unbound iteration index');
      return ctx.indices.get(node.id);
    }
    if (node.op === 'acc') {
      if (!ctx.accumulators.has(node.id)) throw new Error('Unbound reduction accumulator');
      return ctx.accumulators.get(node.id);
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
    } else if (node.op === 'load') {
      load(a[0], ctx); load(a[1], ctx); i32(3); emit(0x74, 0x6a, 0x2b, 0x03, 0x00);
    } else if (node.op === 'to_num') {
      load(a[0], ctx); emit(0xb8);
    } else if (node.op === 'same_extent') {
      load(a[0], ctx); load(a[1], ctx); emit(0x46);
    } else if (node.op === 'reduce') {
      const cohort = ctx.groups.get(node.id) ?? [];
      const peers = cohort.filter(n => n !== node && !ctx.cache.has(n.id));
      return reduce([node, ...peers], ctx, target);
    } else {
      const operations = {
        '+': 0xa0, '-': 0xa1, '*': 0xa2, '/': 0xa3,
        '==': 0x61, '!=': 0x62, '<': 0x63, '>': 0x64, '<=': 0x65, '>=': 0x66,
        neg: 0x9a, not: 0x45, abs: 0x99, sqrt: 0x9f, min: 0xa4, max: 0xa5,
      };
      if (operations[node.op] === undefined) throw new Error(`No Wasm lowering for ${node.op}`);
      for (const arg of a) load(arg, ctx);
      emit(operations[node.op]);
    }
    set(target); ctx.cache.set(node.id, target); return target;
  }
  // Borrowed spans are validated before any kernel work. The 64-bit arithmetic
  // prevents pointer+length overflow from bypassing the object-bound check.
  for (const parameter of kernel.parameters) {
    if (parameter.type === '[Num]') {
      const [pointer, length] = parameter.slots;
      get(pointer); i32(7); emit(0x71, 0x45); trapUnless();
      get(length); i32(2147483647); emit(0x4d); trapUnless();
      get(pointer); emit(0xad); // i64.extend_i32_u
      get(length); emit(0xad, 0x42, 0x08, 0x7e, 0x7c); // ptr + len * 8
      emit(0x3f, 0x00, 0xad, 0x42, ...sleb(65536), 0x7e, 0x58); // <= memory.size * 65536
      trapUnless();
    } else if (parameter.type === 'Bool') {
      get(parameter.slots[0]); i32(1); emit(0x4d); trapUnless();
    }
  }
  loadRegion(kernel.result, root); emit(0x0b);
  const declarations = vector(locals.map(type => [1, wasmType(type)]));
  const body = [...declarations, ...code];
  return { bytes: [...uleb(body.length), ...body], locals: locals.length,
    localBytes: locals.reduce((n, t) => n + (t === 'Num' ? 8 : 4), 0), loops, runtimeChecks,
    reductionFusion: { enabled: experimentalReductionFusion, groups: fusionGroups,
      eliminatedLoops: fusionGroups.reduce((n, group) => n + group.reductions.length - 1, 0) } };
}

export function emitModule(staged, { experimentalReductionFusion = false } = {}) {
  const kernels = staged.kernels;
  const bodies = kernels.map(k => lowerKernel(k, staged.certificate.steps, experimentalReductionFusion));
  const needsMemory = kernels.some(k => k.parameters.some(p => p.type === '[Num]'));
  const types = kernels.map(k => [0x60, ...vector(k.abi.map(t => [wasmType(t)])), 1, wasmType(k.resultType)]);
  const pieces = [
    [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
    section(1, vector(types)),
  ];
  if (needsMemory) pieces.push(section(2, vector([[...text('env'), ...text('memory'), 0x02, 0x00, 0x00]])));
  pieces.push(section(3, vector(kernels.map((_, i) => uleb(i)))));
  pieces.push(section(7, vector(kernels.map((k, i) => [...text(k.name), 0x00, ...uleb(i)]))));
  pieces.push(section(10, vector(bodies.map(b => b.bytes))));
  return { bytes: Uint8Array.from(pieces.flat()), needsMemory,
    functions: kernels.map((k, i) => ({ name: k.name, loops: bodies[i].loops,
      wasmLocals: bodies[i].locals, wasmLocalValueBytes: bodies[i].localBytes,
      runtimeZipChecks: bodies[i].runtimeChecks, reductionFusion: bodies[i].reductionFusion })) };
}
