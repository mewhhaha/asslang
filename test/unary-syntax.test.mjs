import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { compile, compileSources, createCompiler, CompileError, verifyCertificate } from '../src/compiler.mjs';
import { parse, infer, tokenize } from '../src/frontend.mjs';
import { createRuntime, createCapability } from '../src/abi.mjs';
import { unaryCases } from './unary-cases.mjs';

const plain = v => ArrayBuffer.isView(v) ? Array.from(v) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v;
const rejects = (source, code) => assert.throws(() => compile(source), e => e instanceof CompileError && e.code === code);
for (const c of unaryCases) test(`unary: ${c.name}`, async () => {
  for (const experimentalReductionFusion of [false, true]) {
    const compiled = compile(c.source, { experimentalReductionFusion });
    assert.deepEqual(plain((await createRuntime(compiled)).call('main', c.args)), c.expected);
    assert.equal(verifyCertificate(compiled.certificate.steps), true);
    assert.equal(compiled.stats.kernelHeapAllocationSites, 0);
  }
});

test('unary call AST has one argument per application; arrows retain compact parameter vectors', () => {
  const p = parse('fn add = x -> y -> x+y; export fn main = (x:Num) -> add x 2;');
  assert.deepEqual(p.definitions[0].params, ['x', 'y']);
  const call = p.definitions[1].body;
  assert.equal(call.kind, 'call'); assert.equal(call.args.length, 1);
  assert.equal(call.callee.kind, 'call'); assert.equal(call.callee.args.length, 1);
  assert.equal(call.callee.callee.name, 'add');
  assert.equal(infer(p).signatures.add, 'Num -> Num -> Num');
  const tokens = tokenize('x -> y');
  assert.deepEqual(tokens.slice(0, 3).map(t => [t.text,t.pos]), [['x',0],['->',2],['y',5]]);
});

test('function-valued arguments are parenthesized in canonical signatures', () => {
  const c = compile('fn apply = (f:Num -> Num) -> (x:Num) -> f x; export fn main = (x:Num) -> apply (y -> y+1) x;');
  assert.equal(c.signatures.apply, '(Num -> Num) -> Num -> Num');
});

test('tuple shape is exact and not implicitly spread into curried parameters', () => {
  for (const value of ['(1,)', '(1,2,3)', '1', '{}'])
    rejects(`fn pair = (x,y) -> x+y; export fn main = () -> pair ${value};`, 'E_TYPE');
  rejects('fn add = x -> y -> x+y; export fn main = () -> add (1,2);', 'E_TYPE');
  rejects('export fn main = (x:Bool) -> x+1;', 'E_TYPE');
  rejects('fn f = ((x,y):Num) -> x+y; export fn main = () -> 1;', 'E_TYPE');
});

test('duplicate fields, pattern bindings, parameters, and local bindings are errors', () => {
  for (const source of [
    'fn f = (x,x) -> x;', 'fn f = x -> x -> x;', 'fn f = ({x},x) -> x;',
    'fn f = {x:a,y:a} -> a;', 'fn f = {x,x:y} -> x;',
    'export fn main = (x:Num) -> {x,x:2};',
    'export fn main = () -> do {let x=1;let x=2;x};',
    'fn f = x -> x; fn f = x -> x;',
    'host fn h: Num -> Num; host fn h: Num -> Num; fn f = x -> x;',
  ]) rejects(source, 'E_NAME');
});

test('canonical syntax rejects legacy calls, lambdas, implicit blocks, and missing delimiters', () => {
  for (const source of [
    'fn f = 1;', 'fn f = x -> ;', 'fn f = (x,) => x;',
    'fn f = x -> abs(x);', 'fn f = x -> x(2);', 'fn f = x -> (abs)(x);',
    'fn f = x -> {let y=x;y};', 'fn f = x -> map (range x) y -> y;',
    'fn f = x -> (x,,);', 'fn f = x -> {x,,};', 'fn f = x -> do {};',
    'fn f = (x -> x;', 'fn f = x -> (x,2;', 'fn f = x -> x',
    'fn f = x -> x |> ;', 'fn f = x -> x -> -> x;', 'fn f = x -> x y => y;',
  ]) rejects(source, 'E_PARSE');
});

test('canonical errors preserve linked source-local offsets', () => {
  const source = '// second file\nexport fn main = (x:Num) -> missing x;';
  assert.throws(() => compileSources([{name:'lib.ass',source:'fn id = x -> x;'}, {name:'app.ass',source}]), e => {
    assert.equal(e.code, 'E_NAME'); assert.equal(e.sourceName, 'app.ass');
    assert.equal(e.offset, source.indexOf('missing')); assert.match(e.format(source), /app\.ass:2:/); return true;
  });
  const bad = 'fn f = x -> abs(x);';
  assert.throws(() => parse(bad), e => e.code === 'E_PARSE' && e.offset === bad.indexOf('(x)'));
});

test('occurs checks, recursion, and concrete ABI restrictions remain enforced', () => {
  rejects('fn omega = x -> x x; export fn main = () -> 1;', 'E_OCCURS');
  rejects('fn f = x -> f x; export fn main = () -> 1;', 'E_RECURSION');
  rejects('export fn main = x -> x;', 'E_ABI');
  rejects('export fn main = (x:Num) -> do {let f=y -> y+x; f};', 'E_ABI');
  rejects('export fn main = (f:Num -> Num) -> f 1;', 'E_ABI');
});

test('canonical functions link with the unchanged legacy reducer library', async () => {
  const library = readFileSync(new URL('../lib/reducers.ass', import.meta.url), 'utf8');
  const c = compileSources([{name:'reducers.ass',source:library}, {name:'app.ass',source:
    'export fn main = (xs:[Num]) -> reduce_with xs (reducer_map_input (sum_reducer ()) (x -> x*x));'}]);
  assert.equal((await createRuntime(c)).call('main', [[1,2,3]]), 14);
});

test('curried host calls are direct, saturated, capability-checked, and sequenced once', async () => {
  const source = 'host fn add: Num -> Num -> Num; export fn main = (x:Num) -> effect {let a=perform add x 2; perform add a 3; a+a};';
  const runtime = await createRuntime(compile(source));
  const seen = [], capability = createCapability({add:{parameters:['Num','Num'],result:'Num',call:(a,b)=>(seen.push([a,b]),a+b)}}, {maxCalls:2});
  assert.throws(() => runtime.call('main',[4]), e => e.code === 'E_CAPABILITY');
  assert.equal(runtime.call('main',[4],{capability}), 12);
  assert.deepEqual(seen, [[4,2],[6,3]]); assert.equal(capability.remaining, 0);
  for (const body of ['add x 2', 'do {let f=add x; f 2}', 'effect {perform add x; 0}',
    'effect {perform add x 2 3; 0}', 'effect {let f=x -> x; perform f x; 0}'])
    rejects(`host fn add: Num -> Num -> Num; export fn main = (x:Num) -> ${body};`, 'E_EFFECT');
});

test('unit host signatures and legacy nullary host calls keep exact ABI arity', async () => {
  for (const [declaration,parameters,args] of [
    ['host fn read: () -> Num;',[{kind:'Record',fields:[]}],[{}]],
    ['host fn read():Num;',[],[]],
  ]) {
    const c=compile(`${declaration} export fn main = () -> effect {let x=perform read (); x};`);
    const seen=[],capability=createCapability({read:{parameters,result:'Num',call:(...x)=>(seen.push(x),5)}},{maxCalls:1});
    assert.equal((await createRuntime(c)).call('main',[{}],{capability}),5);
    assert.deepEqual(seen,[args]);
  }
});

test('patterns at the effect boundary keep destructuring pure and the effect explicit', async () => {
  const c = compile('host fn emit: Num -> Num; export fn main = (x:Num,y:Num) -> effect {let n=perform emit (x+y); n};');
  const capability=createCapability({emit:{parameters:['Num'],result:'Num',call:x=>x*2}},{maxCalls:1});
  assert.equal((await createRuntime(c)).call('main',[{_0:3,_1:4}],{capability}),14);
});

test('curried stopping folds avoid demanding a trapping causal suffix in every lowering mode', async () => {
  const source = 'export fn main = (xs:[Num]) -> fold_until (scan xs 0 (s -> x -> require (x>=0) (s+x))) 0 (s -> x -> {state:x,done:x>=3});';
  for (const memoizeReductions of [false,true]) for (const experimentalReductionFusion of [false,true]) {
    const runtime = await createRuntime(compile(source,{memoizeReductions,experimentalReductionFusion}));
    assert.deepEqual(runtime.call('main',[[1,2,-10]]),{state:3,steps:2,done:true});
    assert.deepEqual(runtime.call('main',[[]]),{state:0,steps:0,done:false});
  }
});

test('canonical calls do not weaken event alignment or causal access checks', () => {
  rejects('export fn main = (xs:[Num]) -> (ys:[Num]) -> zip xs ys (x -> y -> x+y) |> sum;', 'E_DOMAIN');
  rejects('export fn main = (xs:[Num]) -> at (scan xs 0 (s -> x -> s+x)) 1;', 'E_CAUSAL_ACCESS');
});

test('wide patterns parse without speculative rescanning; nested syntax fails with E_LIMIT', () => {
  const names=Array.from({length:1000},(_,i)=>`x${i}`);
  const p=parse(`fn wide = (${names.join(',')}) -> x0;`);
  assert.equal(p.definitions[0].body.bindings.length,1000);
  for (const source of [
    'fn deep = x -> '+'('.repeat(257)+'x'+')'.repeat(257)+';',
    'fn deep = '+'x -> '.repeat(300)+'x;',
    'fn huge = x -> {'+Array.from({length:51000},(_,i)=>`f${i}:x`).join(',')+'};',
  ]) assert.throws(()=>parse(source),e=>e instanceof CompileError&&e.code==='E_LIMIT');
});

test('seeded canonical programs agree with hand-written JS across partial applications and products', async () => {
  let seed=3819;
  const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let i=0;i<100;i++) {
    const a=random()%11-5,b=random()%13-6,xs=Array.from({length:random()%20},()=>random()%17-8);
    const source=`fn affine = (a,b) -> x -> a*x+b; export fn main = (xs:[Num]) -> do {
      let transform=affine ((${a}),(${b})); xs |> map transform |> fold 0 (s -> x -> s+x)
    };`;
    const result=(await createRuntime(compile(source,{experimentalReductionFusion:Boolean(i%2)}))).call('main',[xs]);
    assert.equal(result,xs.reduce((s,x)=>s+a*x+b,0));
  }
});

test('canonical compilation is deterministic and compiler-session snapshots remain isolated', () => {
  const source=unaryCases.find(c => c.name.includes('qualified stream-first')).source,session=createCompiler();
  const a=session.compile(source),bytes=a.bytes.slice(); a.bytes.fill(0);
  const b=session.compile(source); assert.equal(b.cache.hit,true); assert.deepEqual(b.bytes,bytes);
  assert.deepEqual(compile(source).bytes,bytes);
});

test('CLI executes a canonical source file through the normal compiler entry point', () => {
  const result=spawnSync(process.execPath,['src/cli.mjs','test/fixtures/unary.ass','--run','main','--args','[[1,-2,3]]'],
    {cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr); assert.deepEqual(JSON.parse(result.stdout),{energy:14,total:2});
});

test('truncated canonical forms report compiler errors rather than native exceptions', () => {
  for (const source of [
    'fn f = ({a:(x,y)},z) -> do {let n=x+y; (n,z)};',
    'host fn audit: {x:Num} -> Bool; export fn f = (x:Num) -> effect {perform audit {x}; true};',
    'fn twice = (f:Num -> Num) -> x -> f (f x);',
  ]) for (let end=0;end<source.length;end++) {
    try { parse(source.slice(0,end)); }
    catch (error) { assert.ok(error instanceof CompileError, `${end}: ${error.stack}`); }
  }
});

test('reserved canonical names and invalid annotations fail explicitly', () => {
  rejects('fn do = x -> x;', 'E_NAME');
  rejects('host fn do: Num -> Num; fn f = x -> x;', 'E_NAME');
  rejects('fn f = (x:Nope) -> x;', 'E_ANNOTATION');
  rejects('host fn h: Num; fn f = x -> x;', 'E_ANNOTATION');
  rejects('host fn h: Num -> [Num]; fn f = x -> x;', 'E_ABI');
});
