import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {compile,compileSources,check,checkSources,createCompiler,verifyCertificate} from '../src/compiler.mjs';
import {parse,tokenize,primitiveArities} from '../src/frontend.mjs';
import {createRuntime,createCapability} from '../src/abi.mjs';
import {operatorSource} from '../src/operator-source.mjs';
import {sourceOperatorNames,sourcePrefixNames,validateOperatorText} from '../src/operator-library.mjs';
import {reference} from './reference.mjs';
import {runAllSourceOperatorBrowserChecks} from './all-source-operators-browser.mjs';
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>[false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const main=body=>`export fn main = () -> do {${body}};`;
const run=async(source,args=[{}],options={})=>(await createRuntime(compile(source,options))).call('main',args);
const fail=(body,code)=>assert.equal(check(main(body)).diagnostics[0].code,code);

test('all fifteen expression roles have real source factories and a checked text snapshot',async()=>{
  const source=await readFile(new URL('../lib/expression-operators.ass',import.meta.url),'utf8');
  assert.equal(source,operatorSource);validateOperatorText(source,tokenize);
  const names=Object.values(sourceOperatorNames).concat(Object.values(sourcePrefixNames));
  assert.equal(names.length,15);assert.equal(new Set(names).size,15);
  assert.deepEqual(parse(source).definitions.map(d=>d.name).sort(),names.map(n=>'operator_'+n).sort());
  const process=spawnSync('node',['scripts/build-operators.mjs','--check'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  assert.equal(process.status,0,process.stderr);
  assert.throws(()=>validateOperatorText('fn recursive = scalar -> 1+2;',tokenize),/scalar fields/);
  assert.equal(Object.keys(primitiveArities).length,30);
});

test('default arithmetic, comparison, Boolean, unary and pipeline values across all modes',async()=>{
  const source=main(`let x=8;let y=2;
    {add:x+y,sub:x-y,mul:x*y,div:x/y,eq:x==y,ne:x!=y,lt:x<y,le:x<=y,gt:x>y,ge:x>=y,
      both:true && false,either:false || true,not:!false,neg:-y,piped:x |> (n -> n+y)}`);
  const expected={add:10,sub:6,mul:16,div:4,eq:false,ne:true,lt:false,le:false,gt:true,ge:true,both:false,either:true,not:true,neg:-2,piped:10};
  for(const mode of modes){const c=compile(source,mode);assert(verifyCertificate(c.certificate.steps));assert.deepEqual(await run(source,[{}],mode),expected);assert.deepEqual(reference(source,'main',[{}]),expected);}
});

test('every binary symbol can acquire source meaning with its existing fixity',async()=>{
  for(const symbol of Object.keys(sourceOperatorNames)) {
    const body=symbol==='|>' ? `infixl (${symbol}) = a -> f -> f a + 1;2 ${symbol} (x -> x+3)`
      : `infixl (${symbol}) = a -> b -> {first:a,second:b};2 ${symbol} 3`;
    const expected=symbol==='|>' ? 6 : {first:2,second:3};
    assert.deepEqual(await run(main(body)),expected,symbol);
  }
});

test('source Boolean factories retain both truth tables and lazy right operands',async()=>{
  for(const mode of modes)for(const a of [false,true])for(const b of [false,true]) {
    const source=`export fn main = (a:Bool) -> (b:Bool) -> {both:a&&b,either:a||b,not:!a};`;
    assert.deepEqual(await run(source,[a,b],mode),{both:a&&b,either:a||b,not:!a});
  }
  assert.equal(await run(main('false && require false true')),false);
  assert.equal(await run(main('true || require false false')),true);
  await assert.rejects(run(main('true && require false true')),WebAssembly.RuntimeError);
  await assert.rejects(run(main('false || require false false')),WebAssembly.RuntimeError);
  fail('false && 3','E_TYPE');fail('true || missing','E_NAME');
});

test('the same policy expression specializes to Boolean and numeric algebras',async()=>{
  const source=await readFile(new URL('../examples/case-studies/notation/source_policy.ass',import.meta.url),'utf8');
  for(const mode of modes) {
    const r=await createRuntime(compile(source,mode));
    assert.deepEqual(r.call('source_policy',[0.25,0.5,0.125]),{allowed:true,score:0.5});
    assert.equal(compile(source,mode).stats.functions[0].loops,0);
  }
});

test('prefix and binary minus have independent bindings and first-class captures',async()=>{
  const source=main(`let numericNegate=(prefix (-));let subtraction=(-);
    infixl (-) = a -> b -> a+b;
    prefix (-) = x -> x*10;
    prefix (~) = (prefix (-));
    {neg:-3,binary:3-2,old:numericNegate 3,subtract:subtraction 3 2,alias:~4}`);
  assert.deepEqual(await run(source),{neg:30,binary:5,old:-3,subtract:1,alias:40});
  assert.equal(await run(main('let invert=(!);infixl (&&)=(||);invert (false && true)')),false);
  fail('prefix (!)=3;0','E_TYPE');fail('prefix (-)=true;0','E_TYPE');
  fail('prefix (-)=x -> x;prefix (-)=x -> x;0','E_NAME');
  fail('prefix (->)=x -> x;0','E_OPERATOR');
});

test('inner prefix/Boolean/pipe notation restores scope and prior closures retain meaning',async()=>{
  const source=`fn outside = x -> !x;export fn main = () -> do {
    let before=x -> !x;
    let inner=do {prefix (!)=x -> x;!true};
    prefix (!)=x -> x;
    {inner,current:!true,before:before true,outside:outside true}
  };`;
  assert.deepEqual(await run(source),{inner:true,current:true,before:false,outside:false});
  assert.equal(await run(main('let discarded=do {prefix (~)=x -> x;0}; 3+4')),7);
  fail('let discarded=do {prefix (~)=x -> x;0};~3','E_OPERATOR');
  fail('prefix (~)=(prefix (~));0','E_OPERATOR');
});

test('pipe implementation is source-defined while data-first argument placement is unchanged',async()=>{
  const source=`fn minus = a -> b -> a-b;export fn main = () -> do {
    let original=(|>);
    let a=10 |> minus 3;
    let b=10 |> (minus 3);
    infixl (|>)=value -> transform -> {before:value,after:transform value};
    {a,b,record:3 |> (x -> x*x),captured:original 4 (x -> x+2)}
  };`;
  assert.deepEqual(await run(source),{a:7,b:-7,record:{before:3,after:9},captured:6});
  fail('infixr (|>)=(|>);0','E_FIXITY');
  fail('infixl (&&) above (*)=(&&);0','E_FIXITY');
});

test('source factories can be linked, renamed and changed without symbol-name recognition',async()=>{
  const library=operatorSource.replaceAll('operator_','renamed_');
  const client=`export fn main = () -> do {
    let add=renamed_add {add:(+)};
    let both=renamed_and ();
    {sum:add 3 4,flag:both false (require false true)}
  };`;
  const sources=[{name:'operators.ass',source:library},{name:'client.ass',source:client}];
  assert.deepEqual((await createRuntime(compileSources(sources))).call('main',[{}]),{sum:7,flag:false});
  sources[0].source=library.replace('scalar -> scalar.add','scalar -> a -> b -> scalar.add a (scalar.add b b)');
  assert.deepEqual((await createRuntime(compileSources(sources))).call('main',[{}]),{sum:11,flag:false});
  assert.equal(await run('fn operator_add=a -> b -> 99;export fn main=()->3+4;'),7);
});

test('numeric defaults keep IEEE signed zeros, nonfinite comparisons and differentiation',async()=>{
  for(const mode of modes){
    const negate=await createRuntime(compile('export fn main = (x:Num) -> -x;',mode));
    assert(Object.is(negate.call('main',[0]),-0));assert(Object.is(negate.call('main',[-0]),0));
    assert.equal(negate.call('main',[Infinity]),-Infinity);assert(Number.isNaN(negate.call('main',[NaN])));
    const c=await createRuntime(compile('export fn main = (a:Num) -> (b:Num) -> {eq:a==b,ne:a!=b,less:a<b};',mode));
    assert.deepEqual(c.call('main',[NaN,0]),{eq:false,ne:true,less:false});
    assert.deepEqual(c.call('main',[-0,0]),{eq:true,ne:false,less:false});
    assert.equal(await run('export fn main = (x:Num) -> grad (n -> n*n - n) x;',[3],mode),5);
  }
});

test('operator capture does not grant effects, and captured performed scalars execute once',async()=>{
  const bad='host fn audit:Num -> Num;export fn main = () -> effect {infixl (<+>)=audit;perform (<+>) 1 2;0};';
  assert.equal(check(bad).diagnostics[0].code,'E_EFFECT');
  const indirect='host fn audit:Num -> Num;export fn main = () -> effect {prefix (~)=audit;perform (~) 1;0};';
  assert.equal(check(indirect).diagnostics[0].code,'E_EFFECT');
  const source='host fn read:Num -> Num;export fn main = () -> effect {let offset=perform read 2;prefix (-)=x -> x+offset;(-3)+(-4)};';
  const r=await createRuntime(compile(source));const seen=[];
  const capability=createCapability({read:{parameters:['Num'],result:'Num',call:x=>(seen.push(x),x)}},{maxCalls:1});
  assert.equal(r.call('main',[{}],{capability}),11);assert.deepEqual(seen,[2]);
});

test('staging caches never merge source pipelines, scans, guards or caller-specific captures',async()=>{
  const source='fn make=xs -> scan xs 0 (+);export fn main=(xs:[Num]) -> {a:xs |> make,b:xs |> make};';
  const c=compile(source);assert.equal(c.stats.functions[0].stateMachines,2);
  const result=(await createRuntime(c)).call('main',[[1,2,3]]);
  assert.deepEqual([...result.a],[1,3,6]);assert.deepEqual([...result.b],[1,3,6]);
  const captured=main('let build=x -> do {prefix (~)=y -> x+y;(~)};let a=build 2;let b=build 7;a 1+b 1');
  assert.equal(await run(captured),11);
  const cache=createCompiler();cache.compile(main('!false')).bytes.fill(0);
  assert.equal((await createRuntime(cache.compile(main('!false')))).call('main',[{}]),true);
  assert.equal(await run(main('prefix (!)=x -> x;!false')),false);
  assert.equal(await run(main('!false')),true);
});

test('legacy syntax, core-only mode, linked locations and malformed declarations remain checked',async()=>{
  const legacy='export fn main(x)={let a=x+1;if !(a<0) && a>0 then a else 0};';
  assert.equal(await run(legacy,[3]),4);assert.equal(await run(main('3+4'),[{}],{prelude:false}),7);
  assert.equal(check('export fn main=(xs:[Num])->sum xs;',{prelude:false}).diagnostics[0].code,'E_NAME');
  const source=main('prefix (!)=missing;!true');
  const d=checkSources([{name:'policy.ass',source}]).diagnostics[0];
  assert.equal(d.sourceName,'policy.ass');assert.equal(d.range.start.offset,source.indexOf('missing'));
  for(const code of ['prefix (-) x -> x;0','prefix (!)=;0','prefix (=)=x -> x;0']) assert(!check(main(code)).ok);
  const wide=Array.from({length:65},(_,i)=>`infixl (${'%'.repeat(1+Math.floor(i/16))}${'^'.repeat(1+i%16)}) = (+);`).join('');
  assert(!check(main(wide+'0')).ok);
});

test('default primitive nodes appear only in the compiler bootstrap record',()=>{
  const program=parse('export fn main=(x:Num) -> x+1;');
  const body=program.definitions[0].body;
  const bootstrap=body.bindings.find(b=>b.sourceOperatorDefault==='$scalar');assert(bootstrap);
  assert.equal(bootstrap.value.fields.length,11);
  const uses=[];
  function visit(n){if(!n||typeof n!=='object')return;if(n.kind==='binary'||n.kind==='unary')uses.push(n);for(const v of Object.values(n))visit(v);}
  visit(body.result);assert.equal(uses.length,0);
  assert.equal(body.bindings.filter(b=>b.sourceOperatorDefault==='add').length,1);
});

test('browser checks and documented driver execute',async()=>{
  const report={checks:0,cases:[]};await runAllSourceOperatorBrowserChecks({compile,check},createRuntime,report);assert.equal(report.checks,24);
  const p=spawnSync('node',['examples/interop/all-source-operators.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);assert.equal(JSON.parse(p.stdout).policy.score,0.5);
});
