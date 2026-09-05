import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, instantiate, CompileError, verifyCertificate } from '../src/compiler.mjs';
import { reference } from './reference.mjs';

const example = name => readFileSync(new URL(`../examples/${name}.ass`, import.meta.url), 'utf8');
async function run(source, args = [], name = 'main') {
  const compiled = compile(source);
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
  const input = new Float64Array(memory.buffer), abi = [];
  let position = 0;
  for (const arg of args) {
    if (Array.isArray(arg)) { input.set(arg, position); abi.push(position * 8, arg.length); position += arg.length; }
    else abi.push(arg);
  }
  const instance = await instantiate(compiled, { memory });
  return { value: instance.exports[name](...abi), compiled, instance, memory, abi };
}
function rejects(source, code) {
  assert.throws(() => compile(source), error => error instanceof CompileError && error.code === code);
}
function equivalent(actual, expected) {
  if (typeof expected === 'boolean') assert.equal(actual, Number(expected));
  else if (Number.isNaN(expected)) assert.ok(Number.isNaN(actual));
  else assert.ok(Object.is(actual, expected), `${actual} differs from ${expected}`);
}

test('arithmetic and precedence', async () => {
  assert.equal((await run('export fn main(x) = x + 2 * 3;', [4])).value, 10);
});
test('empty, singleton, and ordinary ranges', async () => {
  const source = 'export fn main(n) = range(n) |> map(x => x*x) |> sum;';
  for (const n of [0, 1, 10, 100]) equivalent((await run(source, [n])).value, reference(source, 'main', [n]));
});
test('pure range module imports no memory and has no runtime imports', async () => {
  const c = compile('export fn main(n) = range(n) |> sum;');
  assert.equal(c.stats.needsMemory, false);
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(c.bytes)), []);
  assert.equal((await instantiate(c)).exports.main(10), 45);
});
test('borrowed memory energy', async () => {
  const result = await run(example('energy'), [[-2, 0, 3, 4]], 'energy');
  assert.equal(result.value, 29);
  assert.equal(result.compiled.signatures.energy, '([Num]) -> Num');
});
test('shared filtered cohort fuses to one loop and zero length guards', async () => {
  const source = example('cohort'), args = [[-7, 0, 1, 3, 5]];
  const { value, compiled } = await run(source, args, 'score');
  equivalent(value, reference(source, 'score', args));
  assert.equal(compiled.stats.functions[0].loops, 1);
  assert.equal(compiled.stats.functions[0].runtimeZipChecks, 0);
  assert.equal(compiled.stats.staticZips, 1);
  assert.equal(compiled.stats.intermediateBufferBytes, 0);
});
test('independent equal-length sources are not silently aligned', () => {
  rejects('export fn main(xs, ys) = zip(xs, ys, (x,y) => x*y) |> sum;', 'E_DOMAIN');
});
test('independent filters do not become equal merely because predicates look alike', () => {
  rejects(`export fn main(xs) = {
    let a = filter(xs, x => x > 0); let b = filter(xs, x => x > 0);
    zip(a, b, (x,y) => x+y) |> sum
  };`, 'E_DOMAIN');
  rejects(example('rejected'), 'E_DOMAIN');
});
test('explicit positional check works and traps on mismatch', async () => {
  const r = await run(example('dot'), [[2, 3], [4, 5]], 'dot');
  assert.equal(r.value, 23);
  assert.equal(r.compiled.stats.functions[0].runtimeZipChecks, 1);
  assert.throws(() => r.instance.exports.dot(0, 2, 16, 1), WebAssembly.RuntimeError);
});
test('positional check creates new domain; it does not equate old origins', () => {
  rejects(`export fn main(xs, ys) = {
    let paired = zip_checked(xs, ys, (x,y) => x+y);
    zip(paired, xs, (a,b) => a+b) |> sum
  };`, 'E_DOMAIN');
});
test('checked zip of separately filtered streams is explicitly unsupported', () => {
  rejects(`export fn main(xs) = zip_checked(filter(xs,x=>x>0), xs, (x,y)=>x+y) |> sum;`, 'E_DENSE');
});
test('nested checked zip preserves all upstream obligations', async () => {
  const source = `export fn main(a,b,c) = zip_checked(zip_checked(a,b,(x,y)=>x+y),c,(x,y)=>x*y) |> sum;`;
  const r = await run(source, [[1, 2], [3, 4], [5, 6]]);
  assert.equal(r.value, 56);
  assert.equal(r.compiled.stats.functions[0].runtimeZipChecks, 2);
  assert.throws(() => r.instance.exports.main(0, 2, 16, 1, 32, 2), WebAssembly.RuntimeError);
});
test('range extents reject negatives, fractions, NaN, infinity and overflow', async () => {
  const r = await run('export fn main(n) = count(range(n));', [0]);
  for (const n of [-1, 1.5, NaN, Infinity, -Infinity, 2147483648]) {
    assert.throws(() => r.instance.exports.main(n), WebAssembly.RuntimeError);
  }
  assert.equal(r.instance.exports.main(-0), 0);
});
test('span ABI checks alignment, object bounds, unsigned overflow and negative length', async () => {
  const r = await run('export fn main(xs) = sum(xs);', [[1, 2]]);
  for (const pair of [[1,1], [65536,1], [-8,2], [0,-1], [8,536870912], [65528,2]]) {
    assert.throws(() => r.instance.exports.main(...pair), WebAssembly.RuntimeError);
  }
  assert.equal(r.instance.exports.main(65536, 0), 0);
});
test('zero-page memory permits an empty span', async () => {
  const c = compile('export fn main(xs) = sum(xs);');
  const i = await instantiate(c, { memory: new WebAssembly.Memory({ initial: 0, maximum: 0 }) });
  assert.equal(i.exports.main(0, 0), 0);
});
test('memory is borrowed, never written or grown', async () => {
  const r = await run(example('cohort'), [[1, 2, -3, 4]], 'score');
  const before = new Uint8Array(r.memory.buffer).slice();
  for (let i = 0; i < 1000; i++) r.instance.exports.score(0, 4);
  assert.deepEqual(new Uint8Array(r.memory.buffer), before);
  assert.equal(r.memory.buffer.byteLength, 65536);
});
test('missing and shared memories are not accepted', async () => {
  const c = compile('export fn main(xs) = sum(xs);');
  await assert.rejects(() => instantiate(c), TypeError);
  const shared = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
  await assert.rejects(() => instantiate(c, { memory: shared }), WebAssembly.LinkError);
});
test('higher-order helpers are staged with lexical capture', async () => {
  const s = `fn apply(f, x) = f(x);
    fn transform(xs, f) = map(xs, f);
    export fn main(n,k) = transform(range(n), x => apply(y => y+k, x)) |> sum;`;
  assert.equal((await run(s, [5, 10])).value, 60);
});
test('let and top-level polymorphism', async () => {
  const s = `fn identity(x) = x;
    export fn main() = { let id = x => identity(x); if id(true) then id(42) else 0 };`;
  assert.equal((await run(s)).value, 42);
  assert.equal(compile(s).signatures.identity, "('a) -> 'a");
});
test('forward references are checked in dependency order', async () => {
  const s = 'export fn main(x) = square(x); fn square(y) = y*y;';
  assert.equal((await run(s, [9])).value, 81);
});
test('fold supports numeric and boolean accumulators', async () => {
  assert.equal((await run('export fn main(xs) = fold(xs,1,(a,x)=>a*x);', [[2,3,4]])).value, 24);
  assert.equal((await run('export fn main(xs) = fold(xs,true,(a,x)=>a && x>0);', [[2,-3,4]])).value, 0);
});
test('nested reductions correctly capture outer indices and accumulators', async () => {
  const s = 'export fn main(n) = range(n) |> fold(0,(a,x)=> a + sum(range(x) |> map(y=>y+x)));';
  equivalent((await run(s, [12])).value, reference(s, 'main', [12]));
});
test('scalar branch caches do not leak across control-flow paths', async () => {
  const s = 'export fn main(x,y) = (if x>0 then y*2 else y*3) + y*2;';
  for (const x of [-1,1]) equivalent((await run(s,[x,5])).value, reference(s,'main',[x,5]));
});
test('demand semantics: dead bindings and inactive branches do not execute', async () => {
  assert.equal((await run('export fn main() = { let unused = sum(range(-1)); 7 };')).value, 7);
  assert.equal((await run('export fn main() = if false then sum(range(-1)) else 9;')).value, 9);
  assert.equal((await run('export fn main() = false && sum(range(-1)) > 0;')).value, 0);
});
test('count does not demand map values', async () => {
  const s = 'export fn main(n) = range(n) |> map(x=>sum(range(-1))) |> count;';
  assert.equal((await run(s,[5])).value, 5);
});
test('floating point NaNs, infinities, signed zero and arithmetic order', async () => {
  const cases = [
    ['export fn main(x) = x * -0;', [2]],
    ['export fn main(x) = 1 / x;', [0]],
    ['export fn main(x) = sqrt(x);', [-1]],
    ['export fn main(x) = min(x,-0);', [0]],
    ['export fn main(xs) = sum(xs);', [[1e16,1,-1e16]]],
  ];
  for (const [s,args] of cases) equivalent((await run(s,args)).value, reference(s,'main',args));
});
test('boolean ABI is canonical', async () => {
  const r = await run('export fn main(x) = !x;', [true]);
  assert.equal(r.value, 0);
  assert.throws(() => r.instance.exports.main(2), WebAssembly.RuntimeError);
});
test('invalid types, occurs check, recursion, names and unsupported ABIs', () => {
  rejects('export fn main() = 1 + true;', 'E_TYPE');
  rejects('export fn main() = filter(range(10),x=>x) |> sum;', 'E_TYPE');
  rejects('fn omega(x) = x(x); export fn main() = 1;', 'E_OCCURS');
  rejects('export fn main(x) = main(x);', 'E_RECURSION');
  rejects('fn a(x)=b(x); fn b(x)=a(x); export fn main()=1;', 'E_RECURSION');
  rejects('export fn main() = nope;', 'E_NAME');
  rejects('export fn main(x) = x;', 'E_ABI');
  rejects('export fn main() = map(range(3), x=>range(x));', 'E_ABI');
  rejects('export fn main() = (x => x);', 'E_ABI');
});
test('syntax errors carry location and stable diagnostic code', () => {
  const s = '// first line\nexport fn main() = @;';
  try { compile(s); assert.fail('Expected failure'); }
  catch (e) { assert.equal(e.code,'E_LEX'); assert.match(e.format(s), /2:20/); }
  rejects('export fn main(x,x) = 1;', 'E_NAME');
  rejects('export fn main() = 1', 'E_PARSE');
  rejects('export fn main() = 1e999;', 'E_NUMBER');
});
test('expansion resource limit is explicit, not an inference timeout', () => {
  assert.throws(() => compile('export fn main(x) = x+1;', { maxExpansion: 1 }), e => e.code === 'E_LIMIT');
  assert.throws(() => compile('export fn main()=1;', { maxExpansion: 0 }), TypeError);
});
test('JTE checker rejects tampered derivations', () => {
  const c = compile(example('cohort'));
  assert.equal(verifyCertificate(c.certificate.steps), true);
  const steps = structuredClone(c.certificate.steps);
  steps.find(s => s.rule === 'map').domain = 999;
  assert.throws(() => verifyCertificate(steps), /forged observation/);
  const checked = structuredClone(compile(example('dot')).certificate.steps);
  delete checked.find(s => s.rule === 'zip_checked').obligation;
  assert.throws(() => verifyCertificate(checked), /missing dynamic obligation/);
});
test('binaries are deterministic and certificates are erased from Wasm', () => {
  const a = compile(example('cohort')), b = compile(example('cohort'));
  assert.deepEqual(a.bytes, b.bytes); assert.deepEqual(a.certificate,b.certificate);
  assert.deepEqual(WebAssembly.Module.customSections(new WebAssembly.Module(a.bytes),'jte'),[]);
});
test('250 seeded differential cases against independent reference semantics', async () => {
  let seed = 0x5eeda551;
  const random = () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed; };
  for (let trial=0; trial<250; trial++) {
    const values = Array.from({length: random()%30},()=>random()%41-20);
    const a = random()%7+1, b = random()%11-5, cut = random()%9-4;
    let s;
    switch (trial%5) {
      case 0: s=`export fn main(xs)=xs |> map(x=>x*${a}+(${b})) |> filter(x=>x>${cut}) |> sum;`; break;
      case 1: s=`export fn main(xs)={ let ys=filter(xs,x=>x>${cut}); zip(map(ys,x=>x*${a}),map(ys,x=>x+(${b})),(u,v)=>u*v) |> sum };`; break;
      case 2: s=`export fn main(xs)=xs |> map(x=>if x>${cut} then x*${a} else x+(${b})) |> fold(0,(a,x)=>a+x);`; break;
      case 3: s=`export fn main(xs)=xs |> filter(x=>x>${cut} && x<${cut+10}) |> count;`; break;
      case 4: s=`export fn main(xs)=zip_checked(xs,xs,(x,y)=>x*${a}+y) |> sum;`; break;
    }
    equivalent((await run(s,[values])).value,reference(s,'main',[values]));
  }
});

test('optional ABI annotations resolve otherwise unobservable element types', async () => {
  assert.equal((await run('export fn main(xs: [Num]): Num = count(xs);', [[1,2,3]])).value, 3);
  assert.equal((await run('export fn main(x: Bool): Bool = x;', [true])).value, 1);
  assert.equal((await run('export fn main(x: Num) = x;', [12])).value, 12);
  rejects('export fn main(x: Bool): Num = x;', 'E_TYPE');
  rejects('export fn main(x: Nope) = 1;', 'E_ANNOTATION');
});
test('fold can ignore non-demanded mapped values', async () => {
  const s='export fn main(n)=range(n) |> map(x=>sum(range(-1))) |> fold(0,(a,x)=>a+1);';
  equivalent((await run(s,[5])).value,reference(s,'main',[5]));
});
