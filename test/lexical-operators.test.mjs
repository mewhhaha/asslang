import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {compile,compileSources,check,checkSources,createCompiler,verifyCertificate} from '../src/compiler.mjs';
import {parse,tokenize,primitiveArities} from '../src/frontend.mjs';
import {createRuntime,createCapability} from '../src/abi.mjs';
import {reference} from './reference.mjs';
import {lexicalOperatorCases,lexicalProgram as program} from './lexical-operator-cases.mjs';
import {runLexicalOperatorBrowserChecks} from './lexical-operators-browser.mjs';
const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>[false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const plain=x=>ArrayBuffer.isView(x)||Array.isArray(x)?Array.from(x,plain):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const reject=(source,code)=>assert.throws(()=>compile(source),e=>e.code===code,source);
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const files=paths=>Promise.all(paths.map(async name=>({name,source:await read(name)})));

for(const c of lexicalOperatorCases)test('lexical infix: '+c.name,async()=>{
  const source=program(c.body);
  for(const mode of modes){
    const compiled=compile(source,mode);
    assert(verifyCertificate(compiled.certificate.steps));
    assert.equal(compiled.stats.intermediateBufferBytes,0);
    assert.deepEqual(plain((await createRuntime(compiled)).call('main',[{}])),c.expected);
    assert.deepEqual(plain(reference(source,'main',[{}])),c.expected);
  }
});

test('arithmetic meaning can be supplied by a lexical dictionary, not global instances',async()=>{
  const source=`fn formula = algebra -> x -> y -> do {infixl (+)=algebra.add;infixl (*)=algebra.multiply;x*x+y};
    fn numeric = () -> {add:(+),multiply:(*)};
    fn points = () -> {add:a -> b -> {x:a.x+b.x,y:a.y+b.y},multiply:a -> b -> {x:a.x*b.x,y:a.y*b.y}};
    export fn main = () -> {scalar:formula (numeric ()) 3 4,point:formula (points ()) {x:2,y:3} {x:4,y:5}};`;
  for(const mode of modes){const c=compile(source,mode);assert.deepEqual((await createRuntime(c)).call('main',[{}]),{scalar:13,point:{x:8,y:14}});}
  const missing=source.replace('multiply:(*)','multiply:true');reject(missing,'E_TYPE');
});

test('operator declarations enforce callable shape without losing generalization',()=>{
  for(const body of ['infixl (%%)=3;0','infixl (%%)=x -> 3;0','infixl (%%)=true;0'])reject(program(body),'E_TYPE');
  reject('fn bad = f -> do {infixl (%%)=f;let a=1 %% 2;let b=true %% false;a};export fn main=()->0;','E_TYPE');
  reject(program('infixl (%%)= x -> y -> x x; 0'),'E_OCCURS');
  reject(program('infixl (%%)=(+); (%%)'),'E_ABI');
  reject(program('infixl (%%)=(%%);0'),'E_OPERATOR');
  assert.equal(Object.keys(primitiveArities).length,33);
});

test('operator-valued factories and higher-order results retain lexical meaning',async()=>{
  const source=`fn make = multiplier -> do {
      infixl (%%)=a -> b -> a*b*multiplier;
      {combine:(%%),fixed:(%%) 2}
    };
    export fn main = () -> do {let left=make 3;let right=make 5;
      infixl (%%)=left.combine; {a:2 %% 4,b:right.fixed 4}
    };`;
  assert.deepEqual((await createRuntime(compile(source))).call('main',[{}]),{a:24,b:40});
  const ternary=program('infixl (%%)=a -> b -> c -> a+b+c; let apply=1 %% 2; apply 3');
  assert.equal((await createRuntime(compile(ternary))).call('main',[{}]),6);
});

test('partial orders reject only competing unrelated or incompatible fixities',async()=>{
  for(const body of [
    'infixl (%%)=(+);infixl (^^)=(+);1 %% 2 ^^ 3',
    'infixl (%%) like (+)=(+);infixr (^^) like (%%)=(+);1 %% 2 ^^ 3',
    'infix (<~>) like (<)=(+);1 <~> 2 <~> 3',
    'infixl (%%) above (*) below (+)=(+);0',
    'infixl (%%) below (|>)=(+);0',
    'infixl (%%) like (|>)=(+);0',
    'infixl (%%) like (+) below (*)=(+);0',
    'infixr (+)=(+);0',
    'infixl (+) above (*)=(+);0',
  ])reject(program(body),'E_FIXITY');
  reject(program('infixl (%%) above (^^)=(+);0'),'E_OPERATOR');
  const bounded=program('infixl (%%) below (+)=(+);infixl (^^) above (%%) below (+)=(+);infixl (<+>) above (%%) below (+)=(+); 1 ^^ 2 %% 3 <+> 4');
  assert.equal((await createRuntime(compile(bounded))).call('main',[{}]),10);
  const standalone=program('infix (<~>) like (<) = (<);(1 <~> 2) && (3 <~> 4)');
  assert.equal((await createRuntime(compile(standalone))).call('main',[{}]),true);
});

test('fixity-group identity survives nested symbol rebinding and never leaks',async()=>{
  const source=program(`infixl (%%) like (+) = (+);infixl (^^) like (%%) = (*);
    let inside=do {infixl (%%) above (*) = x -> y -> x-y; 10 ^^ 6 %% 2};
    {inside,outside:10 ^^ 6 %% 2}`);
  assert.deepEqual((await createRuntime(compile(source))).call('main',[{}]),{inside:40,outside:62});
  for(const body of ['let ignored=do {infixl (%%)=(+);0};1 %% 2','infixl (%%)=(+);infixl (%%)=(*);0'])
    reject(program(body),body.startsWith('let')?'E_OPERATOR':'E_NAME');
  const failed='export fn main=()->do {infixl (%%)=(+);';assert(!check(failed).ok);
  reject(program('1 %% 2'),'E_OPERATOR');
});

test('linked libraries do not export notation or depend on link order',async()=>{
  const lib={name:'lib.ass',source:'fn combine = x -> y -> do {infixl (%%) like (+)=(+); x %% y};'};
  const client={name:'client.ass',source:'export fn main = () -> do {infixl (%%) = combine; 3 %% 4};'};
  assert.deepEqual(compileSources([lib,client]).bytes,compileSources([client,lib]).bytes);
  assert.equal((await createRuntime(compileSources([lib,client]))).call('main',[{}]),7);
  assert.equal(checkSources([lib,{...client,source:'export fn main=()->3 %% 4;'}]).diagnostics[0].code,'E_OPERATOR');
  const outside='fn add = x -> y -> x+y;export fn main=()->do {infixl (+)=(*);add 3 4};';
  assert.equal((await createRuntime(compile(outside))).call('main',[{}]),7);
});

test('structural punctuation and legacy declarations cannot be overridden',()=>{
  for(const op of ['=>','=','->'])reject(program(`infixl (${op})=(+);0`),'E_OPERATOR');
  reject('infixl (%%)=(+);export fn main=()->0;','E_PARSE');
  reject('export fn main()={infixl (%%)=(+);1};','E_PARSE');
  reject(program('infixl (@)=(+);0'),'E_LEX');
  for(const expr of ['(+)3','(+ 3)','(3 +)'])assert(!check(program(expr)).ok);
  const old=['x*-y','x--y','x<=-y','true&&!!false'];
  for(const fragment of old)assert(!tokenize(fragment).some(t=>t.text.includes('*-')||t.text.includes('--')||t.text.includes('!!')));
});

test('error positions point at local symbols, source expressions and anchors',()=>{
  const cases=[
    [program('infixl (%%)=(+); 1 %% true'),'E_TYPE','%% true'],
    [program('infixl (%%)=missing;0'),'E_NAME','missing'],
    [program('infixl (%%) above (^^)=(+);0'),'E_OPERATOR','^^'],
    [program('infixl (%%)=(+);infixl (^^)=(+);1 %% 2 ^^ 3'),'E_FIXITY','^^ 3'],
    [program('infixl (%%)=1;0'),'E_TYPE','%%'],
  ];
  for(const [source,code,token] of cases){
    const d=checkSources([{name:'lib.ass',source:'fn identity=x -> x;'}, {name:'client.ass',source}]).diagnostics[0];
    assert.equal(d.code,code);assert.equal(d.sourceName,'client.ass');assert.equal(d.range.start.offset,source.indexOf(token));
  }
});

test('operator sugar preserves source demand, but is not a macro that hides type errors',async()=>{
  const lazy=program('infixl (%%) = first -> second -> first; 7 %% require false 99');
  for(const mode of modes)assert.equal((await createRuntime(compile(lazy,mode))).call('main',[{}]),7);
  reject(program('infixl (%%) = first -> second -> first; 7 %% (true+1)'),'E_TYPE');
  reject(program('infixl (%%) = first -> second -> first; 7 %% missing'),'E_NAME');
  const demanded=program('infixl (%%) = require; false %% 7');
  const r=await createRuntime(compile(demanded));assert.throws(()=>r.call('main',[{}]),WebAssembly.RuntimeError);
});

test('direct effects cannot be smuggled through operator aliases',async()=>{
  for(const body of ['infixl (%%)=audit;7','infixl (%%)=(+);let x=perform (%%) 1 2;x'])
    reject(`host fn audit:Num -> Num -> Num;export fn main=()->effect {${body}};`,'E_EFFECT');
  const source=`host fn audit:Num -> Num;export fn main=()->effect {
    let factor=perform audit 3;
    infixl (%%) like (*) = a -> b -> a*b*factor;
    let ignored=perform audit 4;
    2 %% 5
  };`;
  const r=await createRuntime(compile(source)),seen=[];
  assert.throws(()=>r.call('main',[{}]),e=>e.code==='E_CAPABILITY');
  const cap=createCapability({audit:{parameters:['Num'],result:'Num',call:x=>(seen.push(x),x)}},{maxCalls:2});
  assert.equal(r.call('main',[{}],{capability:cap}),30);assert.deepEqual(seen,[3,4]);
});

test('differentiation sees ordinary source arithmetic and retains unsupported-graph errors',async()=>{
  const s='export fn main=(x:Num)->do {infixl (%%) like (*)=a -> b -> a*b; grad (v -> v %% v + v) x};';
  const explicit='export fn main=(x:Num)->do {let multiply=a -> b -> a*b; grad (v -> multiply v v + v) x};';
  for(const mode of modes){const c=compile(s,mode);assert.deepEqual(c.bytes,compile(explicit,mode).bytes);assert.equal((await createRuntime(c)).call('main',[3]),7);}
  reject('export fn main=(x:Num)->do {infixl (%%)=a -> b -> sum (range a);grad (v -> v %% 0) x};','E_DIFF_UNSUPPORTED');
});

// Independently enumerate parenthesizations. The source parser's graph and Pratt
// routine are not called by this oracle. Numeric codes preserve tree shape.
function trees(values,ops){
  if(!ops.length)return [values[0]];
  const out=[];
  for(let i=0;i<ops.length;i++)for(const left of trees(values.slice(0,i+1),ops.slice(0,i)))
    for(const right of trees(values.slice(i+1),ops.slice(i+1)))out.push({op:ops[i],left,right});
  return out;
}
function legal(tree,less,assoc){
  if(typeof tree==='number')return true;
  for(const side of ['left','right']){
    const child=tree[side];if(typeof child==='number')continue;
    if(child.op===tree.op){if(assoc[tree.op]!==side)return false;}
    else if(!less.has(tree.op+child.op))return false;
    if(!legal(child,less,assoc))return false;
  }
  return true;
}
const evaluateTree=t=>typeof t==='number'?t:101*evaluateTree(t.left)+evaluateTree(t.right)+t.op.charCodeAt(0);
test('partial-order parsing agrees with an exhaustive independent tree oracle',async t=>{
  const glyph={a:'%%',b:'^^',c:'<+>'};let accepted=0,rejected=0;
  for(const assoc of ['left','right','none']) {
    const keyword={left:'infixl',right:'infixr',none:'infix'}[assoc];
    const declarations=`${keyword} (%%) = x -> y -> 101*x+y+97;
      ${keyword} (^^) above (%%) = x -> y -> 101*x+y+98;
      ${keyword} (<+>) = x -> y -> 101*x+y+99;`;
    const relation=new Set(['ab']);
    for(let code=0;code<81;code++){
      let q=code;const ops=Array.from({length:4},()=>{const a='abc'[q%3];q=Math.floor(q/3);return a;});
      const legalTrees=trees([1,2,3,4,5],ops).filter(tree=>legal(tree,relation,{a:assoc,b:assoc,c:assoc}));
      assert(legalTrees.length<=1);
      const expression='1 '+ops.map((op,i)=>glyph[op]+' '+(i+2)).join(' ');
      const s=program(declarations+expression);
      if(!legalTrees.length){assert.equal(check(s).diagnostics[0].code,'E_FIXITY');rejected++;}
      else {assert.equal((await createRuntime(compile(s))).call('main',[{}]),evaluateTree(legalTrees[0]));accepted++;}
    }
  }
  t.diagnostic(JSON.stringify({parenthesizationPrograms:accepted+rejected,accepted,rejected}));
});

test('all pattern and operator syntax stays bounded',()=>{
  const glyph=i=>'%'+i.toString(4).split('').map(d=>'^~?%'[Number(d)]).join('');
  const decl=i=>`infixl (${glyph(i)})=(+);`;
  assert(check(program(Array.from({length:64},(_,i)=>decl(i)).join('')+'0')).ok);
  reject(program(Array.from({length:65},(_,i)=>decl(i)).join('')+'0'),'E_LIMIT');
  const many=Array.from({length:257},(_,i)=>`fn f${i}=()->do {infixl (%%)=(+);0};`).join('');
  reject(many+'export fn main=()->0;','E_LIMIT');
  assert(check(program(`infixl (${'%'.repeat(16)})=(+);0`)).ok);
  reject(program(`infixl (${'%'.repeat(17)})=(+);0`),'E_LIMIT');
  reject(program('infixr (^^)=(+);'+Array(300).fill('1').join(' ^^ ')),'E_LIMIT');
  assert.throws(()=>compile(program('infixl (%%)=(+);1 %% 2'),{maxExpansion:1}),e=>e.code==='E_LIMIT');
});

test('operator declarations emit only existing AST kinds and include the initializer once',()=>{
  const ast=parse('fn make=x->a->b->a+b+x;'+program('infixl (%%)=make 1;2 %% 3'));
  let calls=0;const kinds=new Set();
  function visit(x){if(!x||typeof x!=='object')return;if(x.kind)kinds.add(x.kind);if(x.kind==='name'&&x.name==='make')calls++;for(const value of Object.values(x))visit(value);}
  visit(ast);assert.equal(calls,1);for(const k of kinds)assert(['definition','lambda','call','name','number','binary','unary','field','block','record'].includes(k));
});

test('canonical source with comments, CRLF and vertical operators is layout invariant',()=>{
  const s=program(`infixl (>>>) below (+) = f -> g -> x -> g (f x);
    let f = (x -> x+1)
      >>> (x -> x*2)
      >>> (x -> x+3);
    f 4`);
  for(const mode of modes){const c=compile(s,mode);assert.deepEqual(c.bytes,compile(s.replace(/\s+/g,' '),mode).bytes);assert.deepEqual(c.bytes,compile(s.replaceAll('\n','\r\n'),mode).bytes);}
  assert.deepEqual(compile(s).bytes,compile(s.replace('below','// relation\nbelow')).bytes);
});

test('core-only linkage, caches and prepared calls retain ordinary semantics',async()=>{
  const source='export fn main=(xs:[Num])->do {infixl (%%) like (*)=(*); map xs (x -> x %% x)};';
  const c=compile(source,{prelude:false});assert.deepEqual(c.bytes,compile(source).bytes);
  const compiler=createCompiler();compiler.compile(source).bytes.fill(0);const cached=compiler.compile(source);assert(cached.cache.hit);
  const r=await createRuntime(cached),input=[1,2,3],lease=r.prepare('main',[input]);
  try{const one=lease.run();input[0]=9;one[0]=9;assert.deepEqual([...lease.run()],[1,4,9]);}finally{lease.dispose();}
  assert.throws(()=>lease.run(),e=>e.code==='E_LEASE_EXPIRED');
});

test('registered source examples and explicit named expansions execute identically',async()=>{
  const {notationExamples}=await import('../examples/interop/lexical-operators.mjs');
  const results=await notationExamples();assert.equal(results.length,3);assert(results.every(r=>r.sameBytes));
});

test('polynomial operators execute scalar and dual arithmetic across shapes and widths',async()=>{
  const fs=await files(['lib/polynomials.ass','examples/case-studies/notation/polynomial.ass']);
  for(const mode of modes){const r=await createRuntime(compileSources(fs,mode));
    for(const coeffs of [[],[3],[2,3,5],[-1,0,2,0,1]])for(const x of [-2,-0,0,0.5,2]){
      // Independent coefficient/power formula; small exact inputs avoid
      // conflating distinct floating-point evaluation orders with wrong values.
      let value=0,derivative=0;for(let i=0;i<coeffs.length;i++){const power=coeffs.length-i-1;value+=coeffs[i]*x**power;if(power)derivative+=coeffs[i]*power*x**(power-1);}
      const got=r.call('polynomial',[coeffs,x]);assert.equal(got.value+0,value+0);assert.equal(got.derivative+0,derivative+0);
    }
  }
});

test('array aliases retain alignment, causal stopping and native budget failure',async()=>{
  const source='export fn main=(xs:[Num])->do {infixl (<>) like (+)=concat;let {left,right}=split_at xs 1;let ys=left <> right;zip xs ys (x -> y -> x+y) |> scan 0 (+) |> fold_until 0 (s -> x -> {state:x,done:x>=6})};';
  for(const mode of modes){const c=compile(source,{...mode,maxLoopIterations:2});assert.equal(c.stats.functions[0].runtimeZipChecks,0);const r=await createRuntime(c);assert.equal(r.call('main',[[1,2,9]]).steps,2);}
  reject('export fn main=(xs:[Num])->do {infixl (<>)=concat;let {left,right}=split_at xs 1;zip xs (right <> left) (+)};','E_DOMAIN');
});

test('documented examples, CLI and browser module execute',async()=>{
  const doc=await read('docs/LEXICAL-OPERATORS.md');
  const examples=[...doc.matchAll(/<!-- notation-example: ([\w-]+) -->\n```ass\n([\s\S]*?)\n```/g)];
  assert.equal(examples.length,2);
  for(const [,name,source] of examples)assert.equal(source+'\n',await read(`examples/case-studies/notation/${name}.ass`));
  const result=spawnSync(process.execPath,['examples/case-studies/app.mjs','notation-polynomial'],{cwd:new URL('../',import.meta.url),input:'[[2,3,5],2]',encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{value:19,derivative:11});
  const report={checks:0,cases:[]};await runLexicalOperatorBrowserChecks({compile,check},createRuntime,report);assert.equal(report.checks,33);
});


test('operator tokenization never swallows a following comment, even without a gap',async()=>{
  for(const op of ['+','*','>=','==','&&','||','|>']) {
    const tokens=tokenize(`a${op}// comment\nb`).map(t=>t.text);
    assert.deepEqual(tokens,['a',op,'b','<eof>']);
  }
  const source=program('infixl (%%) like (+)=(+);1%%// add\n2');
  assert.equal((await createRuntime(compile(source))).call('main',[{}]),3);
  assert.deepEqual(compile(program('1+// add\n2')).bytes,compile(program('1+2')).bytes);
  assert.deepEqual(tokenize('x->// identity\nx').map(t=>t.text),['x','->','x','<eof>']);
});

test('operators may select ordinary runtime branches without runtime function objects',async()=>{
  const source='export fn main=(flag:Bool)->do {infixl (%%)=if flag then (+) else (*);3 %% 4};';
  const r=await createRuntime(compile(source));assert.equal(r.call('main',[true]),7);assert.equal(r.call('main',[false]),12);
  const scalar='export fn main=()->do {let infixl=f -> f 2 3;infixl (+)};';
  assert.equal((await createRuntime(compile(scalar))).call('main',[{}]),5);
});

test('alpha-renamed symbols and escaped operator values keep ordinary function identity',async()=>{
  const source=program('let saved=do {infixl (%%)=(*);(%%)};infixl (%%)=(+);{saved:saved 3 4,current:3 %% 4}');
  for(const mode of modes){
    const c=compile(source,mode),renamed=compile(source.replaceAll('%%','<+>'),mode);
    assert.deepEqual(c.bytes,renamed.bytes);assert.deepEqual(c.certificate,renamed.certificate);
    assert.deepEqual((await createRuntime(c)).call('main',[{}]),{saved:12,current:7});
  }
});
