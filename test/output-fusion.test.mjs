import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compile, compileSources, checkSources, createCompiler, instantiate, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime, createCapability, Arena, prepareCall } from '../src/abi.mjs';
import { reference } from './reference.mjs';
import { createMonitor, initialMonitorState } from '../examples/case-studies/workflows/monitor.mjs';

const modes = [false, true].flatMap(simd => [false, true].flatMap(reductionFusion =>
  [false, true].map(memoizeReductions => ({ simd, reductionFusion, memoizeReductions }))));
const monitor = await readFile(new URL('../examples/case-studies/workflows/monitor.ass', import.meta.url), 'utf8');
const config = { alpha: 0.5, low: 3, high: 6 };
const plain = x => Array.isArray(x) || ArrayBuffer.isView(x) ? Array.from(x, plain) : x && typeof x === 'object'
  ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, plain(v)])) : x;
const summary = c => c.stats.functions[0];
const corpus = [[], [0], [0, 8, 8, 0, 0], [6, 3, 9, -1, 10, 10, 0]];

for (const mode of modes) test(`unchanged monitor uses one shared traversal when enabled ${JSON.stringify(mode)}`, async () => {
  const c = compile(monitor, mode), s = summary(c), r = await createRuntime(c);
  assert.equal(s.loops, mode.reductionFusion ? 1 : 3);
  assert.equal(s.stateMachines, mode.reductionFusion ? 1 : 3);
  assert.equal(s.outputFusion.eliminatedLoops, mode.reductionFusion ? 2 : 0);
  assert(verifyCertificate(c.certificate.steps));
  for (const xs of corpus) {
    const expected = plain(reference(monitor, 'monitor_chunk', [xs, initialMonitorState, config]));
    assert.deepEqual(plain(r.call('monitor_chunk', [xs, initialMonitorState, config])), expected);
    for (let split = 0; split <= xs.length; split++) {
      const a = r.call('monitor_chunk', [xs.slice(0, split), initialMonitorState, config]);
      const b = r.call('monitor_chunk', [xs.slice(split), a.state, config]);
      assert.deepEqual({ state: b.state, alarms: [...a.alarms, ...b.alarms], smoothed: [...a.smoothed, ...b.smoothed] }, expected);
    }
  }
});

test('exact budgets and host checkpoint commits reflect one versus three traversals', async () => {
  for (const mode of modes) {
    const units = mode.reductionFusion ? 3 : 9;
    const m = await createMonitor(config, null, { ...mode, maxLoopIterations: units });
    assert.equal(m.process([0, 8, 8]).checkpoint.state.seen, 3);
    const small = await createMonitor(config, null, { ...mode, maxLoopIterations: units - 1 });
    const before = small.checkpoint();
    assert.throws(() => small.process([0, 8, 8]), WebAssembly.RuntimeError);
    assert.deepEqual(small.checkpoint(), before);
    assert.equal(small.process([1]).checkpoint.state.seen, 1);
    const restored = await createMonitor(config, JSON.parse(JSON.stringify(m.checkpoint())), mode);
    assert.deepEqual(plain(restored.process([0, 0])), plain(m.process([0, 0])));
  }
});

const mixed = `export fn main = (xs:[Num]) -> do {
  let h = scan xs 0 (s -> x -> s+x);
  let values = map h (x -> x*2);
  {a:map h (x -> x>0), b:{numbers:values, again:values}, last:fold h 0 (s -> x -> x)}
};`;
const expectedBytes = n => Math.ceil(n * 4 / 8) * 8 + n * 16;
async function rawFrame(c, xs, bytes) {
  const memory = new WebAssembly.Memory({ initial: 2, maximum: 2 });
  new Uint8Array(memory.buffer).fill(0xa5);
  const arena = new Arena(memory), frame = prepareCall(arena, c.abi.exports[0], [xs], { outputBytes: bytes });
  const instance = await instantiate(c, { memory });
  return { memory, frame, call: slots => instance.exports.main(...(slots ?? frame.slots)) };
}

test('raw descriptors, duplicate buffers, alignment, end cursors and bytes match unfused ASABI', async () => {
  const on = compile(mixed), off = compile(mixed, { reductionFusion: false });
  assert.equal(summary(on).loops, 1); assert.equal(summary(off).loops, 4);
  assert.deepEqual(on.abi, off.abi);
  for (const n of [0, 1, 2, 3, 7, 16, 31]) {
    const xs = Array.from({ length: n }, (_, i) => i - 3), bytes = expectedBytes(n);
    const a = await rawFrame(on, xs, bytes), b = await rawFrame(off, xs, bytes);
    const ae = a.call(), be = b.call();
    assert.equal(ae, be); assert.equal(ae, a.frame.outputStart + bytes);
    assert.deepEqual(plain(a.frame.lift(ae)), plain(b.frame.lift(be)));
    assert.deepEqual(new Uint8Array(a.memory.buffer), new Uint8Array(b.memory.buffer));
    const fields = on.abi.exports[0].result.layout.fields;
    const ptr = f => new DataView(a.memory.buffer).getUint32(a.frame.resultPointer + f.offset, true);
    assert.equal(ptr(fields[0]) % 8, 0);
    const bFields = fields[1].fields;
    const first = ptr({ offset: fields[1].offset + bFields[0].offset });
    const second = ptr({ offset: fields[1].offset + bFields[1].offset });
    if (n) assert.notEqual(first, second, 'duplicate result arrays retain distinct output slices');
    assert.equal(first % 8, 0); assert.equal(second % 8, 0);
    assert(new Uint8Array(a.memory.buffer, ae, 16).every(x => x === 0xa5));
    if (bytes) {
      const short = await rawFrame(on, xs, bytes - 1);
      assert.throws(() => short.call(), WebAssembly.RuntimeError);
      assert(new Uint8Array(short.memory.buffer, short.frame.outputStart, bytes + 8).every(x => x === 0xa5),
        'insufficient capacity is detected before materialization');
    }
  }
});

test('raw alias, bogus length and capacity requests trap without overwriting inputs', async () => {
  const c = compile(mixed), x = await rawFrame(c, [1, 2, 3], expectedBytes(3));
  const before = new Uint8Array(x.memory.buffer).slice();
  const [ret, out, capacity] = c.abi.exports[0].result.slots;
  for (const change of [
    slots => { slots[out] = slots[0]; },
    slots => { slots[out] = slots[ret]; },
    slots => { slots[ret] = slots[0]; },
    slots => { slots[capacity] = -1; },
    slots => { slots[1] = 0x7fffffff; },
    slots => { slots[out] += 1; },
  ]) {
    const slots = [...x.frame.slots]; change(slots);
    assert.throws(() => x.call(slots), WebAssembly.RuntimeError);
    assert.deepEqual(new Uint8Array(x.memory.buffer), before);
  }
  assert.equal(x.frame.lift(x.call()).last, 6);
});

test('huge dense range outputs reject multiplication overflow before loops or stores', async () => {
  const c = compile(`export fn main = (n:Num) -> do {
    let h=scan (range n) 0 (s -> x -> s+x); {a:h,b:map h (x -> x>0)}
  };`, { maxLoopIterations: 0 });
  assert.equal(summary(c).outputFusion.eliminatedLoops, 1);
  const memory = new WebAssembly.Memory({ initial: 1 });
  new Uint8Array(memory.buffer).fill(0xa5);
  const arena = new Arena(memory), frame = prepareCall(arena, c.abi.exports[0], [2147483647], { outputBytes: 16 });
  const instance = await instantiate(c, { memory }), before = new Uint8Array(memory.buffer).slice();
  assert.throws(() => instance.exports.main(...frame.slots), WebAssembly.RuntimeError);
  assert.deepEqual(new Uint8Array(memory.buffer), before);
});

test('output reservation does not spend loop allowance or alter empty-seed demand', async () => {
  const source = `export fn main = (xs:[Num]) -> do {
    let h=scan xs (require false 0) (s -> x -> s+x); {a:h,b:map h (x -> x>0),last:fold h 7 (s -> x -> x)}
  };`;
  for (const reductionFusion of [false, true]) {
    const r = await createRuntime(compile(source, { reductionFusion, maxLoopIterations: 0 }));
    assert.deepEqual(plain(r.call('main', [[]])), { a: [], b: [], last: 7 });
    assert.throws(() => r.call('main', [[1]]), WebAssembly.RuntimeError);
    const strictFold = source.replace('fold h 7', 'fold h (require false 7)');
    const s = await createRuntime(compile(strictFold, { reductionFusion }));
    assert.throws(() => s.call('main', [[]]), WebAssembly.RuntimeError);
  }
});

test('arrays alone and direct scalar sinks can share multiple chained causal machines', async () => {
  const source = `export fn main = (xs:[Num]) -> do {
    let a=scan xs 0 (s -> x -> s+x); let b=scan a 1 (s -> x -> s*x);
    {numbers:b,flags:map b (x -> x>0),total:sum b,last:fold b 1 (s -> x -> x)}
  };`;
  const on = compile(source), off = compile(source, { reductionFusion: false });
  assert.equal(summary(on).loops, 1); assert.equal(summary(on).stateMachines, 2);
  assert.equal(summary(on).outputFusion.eliminatedLoops, 3);
  const r = await createRuntime(on), b = await createRuntime(off);
  for (const xs of [[], [1], [1, 2, 3], [1, -1, 2]]) assert.deepEqual(plain(r.call('main', [xs])), plain(b.call('main', [xs])));
  const arrays = compile(source.replace(',total:sum b,last:fold b 1 (s -> x -> x)', ''));
  assert.equal(summary(arrays).loops, 1); assert.equal(summary(arrays).stateMachines, 2);
});

test('record fold updates are simultaneous and preserve signed-zero and cancellation order', async () => {
  const source = `export fn main = (xs:[Num]) -> do {
    let h=scan xs {left:0,right:1} (s -> x -> {left:s.right+x,right:s.left-x});
    {a:map h (s -> s.left),b:map h (s -> s.right),
      state:fold h {left:0,right:0} (s -> x -> {left:s.right+x.left,right:s.left+x.right})}
  };`;
  for (const simd of [false, true]) for (const memoizeReductions of [false, true]) {
    const on = compile(source, { simd, memoizeReductions }), off = compile(source, { simd, memoizeReductions, reductionFusion: false });
    const a = await createRuntime(on), b = await createRuntime(off);
    assert.equal(summary(on).loops, 1);
    for (const xs of [[], [-0], [1e16, 1, -1e16, 1], [Infinity, -Infinity], [NaN]])
      assert.deepEqual(plain(a.call('main', [xs])), plain(b.call('main', [xs])));
  }
});

test('ignoring fold/count bodies do not demand their unused mapped item', async () => {
  const source = `export fn main = (xs:[Num]) -> do {
    let h=scan xs 0 (s -> x -> s+x);
    {a:h,n:count (map h (x -> sum (range (-1))))}
  };`;
  const c = compile(source), r = await createRuntime(c);
  assert.equal(summary(c).loops, 1);
  assert.deepEqual(plain(r.call('main', [[1, 2, 3]])), { a: [1, 3, 6], n: 3 });
});

const fallback = [
  ['sparse output', 'let h=filter (scan xs 0 (s -> x -> s+x)) (x -> x>0); {a:h,b:map h (x -> x>1)}'],
  ['different scan identities', 'let a=scan xs 0 (s -> x -> s+x); let b=scan xs 0 (s -> x -> s+x); {a,b}'],
  ['different guards', 'let h=scan xs 0 (s -> x -> s+x); {a:require (n>0) h,b:require (n>1) h}'],
  ['conditional scalar', 'let h=scan xs 0 (s -> x -> s+x); {a:h,b:if n>0 then sum h else 0}'],
  ['nested reduction in map', 'let h=scan xs 0 (s -> x -> s+x); {a:h,b:map h (x -> sum (range n))}'],
  ['stopping fold', 'let h=scan xs 0 (s -> x -> s+x); {a:h,b:fold_until h 0 (s -> x -> {state:x,done:x>0})}'],
  ['conditional initialization with nested reduction', 'let h=scan xs (sum (range n)) (s -> x -> s+x); {a:h,b:map h (x -> x>0)}'],
];
for (const [label, body] of fallback) test(`conservative fallback: ${label}`, async () => {
  const source = `export fn main = (xs:[Num]) -> (n:Num) -> do {${body}};`;
  const c = compile(source), b = compile(source, { reductionFusion: false });
  assert.equal(summary(c).outputFusion.groups.length, 0);
  const r = await createRuntime(c), s = await createRuntime(b);
  for (const xs of [[], [1, -3, 4]]) assert.deepEqual(plain(r.call('main', [xs, 2])), plain(s.call('main', [xs, 2])));
});

test('sparse outputs retain exact-sized compact arenas rather than reserving an upper bound', async () => {
  const source = 'export fn main = (xs:[Num]) -> do { let h=filter (scan xs 0 (s -> x -> s+x)) (x -> x>100); {a:h,b:map h (x -> x>0)} };';
  const c = compile(source); assert.equal(summary(c).outputFusion.groups.length, 0);
  const r = await createRuntime(c);
  assert.deepEqual(plain(r.call('main', [[1, 2, 3]], { outputBytes: 0 })), { a: [], b: [] });
});

test('unrelated input origins and stateless SIMD outputs never enter an output cohort', async () => {
  const separate = compile('export fn main = (xs:[Num]) -> (ys:[Num]) -> {a:scan xs 0 (s -> x -> s+x),b:scan ys 0 (s -> x -> s+x)};');
  assert.equal(summary(separate).outputFusion.groups.length, 0);
  const source = 'export fn main = (xs:[Num]) -> {a:map xs (x -> x*x),b:map xs (x -> x+1)};';
  const on = compile(source, { simd: true }), off = compile(source, { simd: true, reductionFusion: false });
  assert.equal(summary(on).simd.vectorizedLoops, 2); assert.equal(summary(on).outputFusion.groups.length, 0);
  assert.deepEqual(on.bytes, off.bytes);
  assert.throws(() => compile('export fn main = (xs:[Num]) -> (ys:[Num]) -> zip xs ys (x -> y -> x+y);'), e => e.code === 'E_DOMAIN');
});

test('source projection and per-element branches retain their demand', async () => {
  const projected = `export fn main = (xs:[Num]) -> do {let h=scan xs 0 (s -> x -> s+x);
    {a:h,b:map h (x -> require false x)}.a};`;
  const c = compile(projected), r = await createRuntime(c);
  assert.equal(summary(c).outputFusion.groups.length, 0);
  assert.deepEqual(plain(r.call('main', [[1, 2]])), [1, 3]);
  const branches = `export fn main = (xs:[Num]) -> do {let h=scan xs 0 (s -> x -> s+x);
    {a:h,b:map h (x -> if x>=0 then x else require false x)}};`;
  const b = await createRuntime(compile(branches));
  assert.deepEqual(plain(b.call('main', [[1, 2]])), { a: [1, 3], b: [1, 3] });
  assert.throws(() => b.call('main', [[-1]]), WebAssembly.RuntimeError);
  assert.deepEqual(plain(b.call('main', [[]])), { a: [], b: [] });
});

test('matching guards are enforced on empty input and invalid current state', async () => {
  const r = await createRuntime(compile(monitor));
  for (const [seed, cfg] of [[{ ...initialMonitorState, raised: 1 }, config], [initialMonitorState, { ...config, alpha: 0 }]])
    assert.throws(() => r.call('monitor_chunk', [[], seed, cfg]), WebAssembly.RuntimeError);
  assert.throws(() => r.call('monitor_chunk', [[Infinity], initialMonitorState, config]), WebAssembly.RuntimeError);
  assert.equal(r.call('monitor_chunk', [[1], initialMonitorState, config]).state.mean, 1);
});

test('effects remain ordered before output, capabilities and source-local diagnostics remain intact', async () => {
  const source = `host fn audit:Num -> Bool;
    export fn main = (xs:[Num]) -> effect {
      perform audit 1; perform audit 2;
      let h=scan xs 0 (s -> x -> s+x); {a:h,b:map h (x -> x>0)}
    };`;
  const c = compile(source, { maxLoopIterations: 0 }), r = await createRuntime(c), seen = [];
  assert.equal(summary(c).outputFusion.eliminatedLoops, 1);
  assert.throws(() => r.call('main', [[1]]), e => e.code === 'E_CAPABILITY');
  const capability = createCapability({ audit: { parameters: ['Num'], result: 'Bool', call: n => (seen.push(n), true) } }, { maxCalls: 2 });
  assert.throws(() => r.call('main', [[1]], { capability }), WebAssembly.RuntimeError);
  assert.deepEqual(seen, [1, 2]); assert.equal(capability.remaining, 0);
  const local = 'export fn bad = (xs:[Num]) -> do {let h=scan xs 0 (s -> x -> s+x); {a:h,b:map h (x -> missing x)}};';
  const checked = checkSources([{ name: 'client.ass', source: local }]);
  assert.equal(checked.diagnostics[0].code, 'E_NAME'); assert.equal(checked.diagnostics[0].sourceName, 'client.ass');
  assert.equal(checked.diagnostics[0].range.start.offset, local.indexOf('missing'));
  assert.throws(() => compile('export fn bad = (xs:[Num]) -> at (scan xs 0 (s -> x -> s+x)) 0;'), e => e.code === 'E_CAUSAL_ACCESS');
  assert.throws(() => compile('export fn bad = (xs:[Num]) -> map xs (x -> {value:x});'), e => e.code === 'E_ABI');
});

test('cache options and prepared leases preserve output ownership and post-trap reset', async () => {
  const compiler = createCompiler(), first = compiler.compile(mixed); first.bytes.fill(0);
  const cached = compiler.compile(mixed); assert(cached.cache.hit); assert(WebAssembly.validate(cached.bytes));
  assert.equal(summary(compiler.compile(mixed, { reductionFusion: false })).outputFusion.eliminatedLoops, 0);
  const r = await createRuntime(cached), inputs = [1, 2, 3], lease = r.prepare('main', [inputs], { outputBytes: expectedBytes(3) });
  try {
    const a = lease.run(); inputs[0] = 99; const b = lease.run();
    assert.deepEqual(plain(a), plain(b));
    a.b.numbers[0] = 99;
    assert.equal(a.b.again[0], 2); assert.equal(b.b.numbers[0], 2);
  } finally { lease.dispose(); }
  assert.throws(() => lease.run(), e => e.code === 'E_LEASE_EXPIRED');
  assert.throws(() => r.call('main', [[1, 2, 3]], { outputBytes: 1 }), WebAssembly.RuntimeError);
  assert.equal(r.call('main', [[2]]).last, 2);
});

test('seeded dense output families agree with separate traversals and the interpreter', async t => {
  let seed = 2709, evaluations = 0, programs = 0;
  const random = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  for (let i = 0; i < 32; i++) {
    const start = random() % 7 - 3, factor = random() % 5 + 1, cut = random() % 11 - 5;
    const source = `export fn main = (xs:[Num]) -> do {
      let h=scan xs (${start}) (s -> x -> s+x);
      {a:map h (x -> x>${cut}),b:map h (x -> x*${factor}),
       last:fold h (${start}) (s -> x -> x),count:count h,total:sum h}
    };`;
    for (const mode of modes) {
      const c = compile(source, mode), r = await createRuntime(c);
      assert.equal(summary(c).loops, mode.reductionFusion ? 1 : 5);
      for (let j = 0; j < 10; j++) {
        const xs = Array.from({ length: random() % 18 }, () => random() % 19 - 9);
        assert.deepEqual(plain(r.call('main', [xs])), plain(reference(source, 'main', [xs])));
        evaluations++;
      }
      programs++;
    }
  }
  assert.equal(evaluations, 2560);
  t.diagnostic(JSON.stringify({ programs, evaluations }));
});

test('Boolean inputs keep value checks and mixed output strides in the shared loop', async () => {
  const source = `export fn main = (xs:[Bool]) -> do {
    let h=scan xs false (s -> x -> if s then !x else x);
    {a:h,b:map h (x -> if x then 1 else 0),last:fold h false (s -> x -> x)}
  };`;
  const c = compile(source); assert.equal(summary(c).loops, 1);
  const r = await createRuntime(c);
  assert.deepEqual(plain(r.call('main', [[true, false, true]])), { a: [true, true, false], b: [1, 1, 0], last: false });
  const memory = new WebAssembly.Memory({ initial: 1 }), arena = new Arena(memory);
  const frame = prepareCall(arena, c.abi.exports[0], [[true]], { outputBytes: 16 });
  new DataView(memory.buffer).setUint32(frame.slots[0], 2, true);
  const instance = await instantiate(c, { memory });
  assert.throws(() => instance.exports.main(...frame.slots), WebAssembly.RuntimeError);
});

test('published comparison command runs the unchanged workflow and reports actual lowering', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)(process.execPath, ['examples/interop/output-fusion.mjs'],
    { cwd: new URL('../', import.meta.url), timeout: 15000 });
  const report = JSON.parse(stdout);
  assert(report.sameResult);
  assert.deepEqual(report.reports.map(r => r.loops), [3, 1]);
  assert.deepEqual(report.reports.map(r => r.stateMachines), [3, 1]);
  assert(report.reports[1].wasmBytes < report.reports[0].wasmBytes);
  assert.deepEqual(report.result.smoothed, [0, 4, 6, 3, 1.5]);
});
