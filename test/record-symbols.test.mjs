import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compile,compileSources,check,checkSources,createCompiler,verifyCertificate} from '../src/compiler.mjs';
import {parse,infer} from '../src/frontend.mjs';
import {createRuntime,createCapability} from '../src/abi.mjs';

const modes=[false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));
const run=async(source,args,options={})=>(await createRuntime(compile(source,options))).call('main',args);
const reject=(source,code)=>assert.throws(()=>compile(source),e=>e.code===code);

for(const options of modes)test(`typed symbol protocols specialize to plain code ${JSON.stringify(options)}`,async()=>{
  const source=`symbol state; symbol apply;
    fn evaluate = object -> object[apply] object[state];
    fn quadratic = x -> {[state]:x,[apply]:y -> y*y+3*y+2};
    export fn main = (x:Num) -> evaluate (quadratic x);`;
  const direct='export fn main = (x:Num) -> x*x+3*x+2;';
  const c=compile(source,options),d=compile(direct,options),r=await createRuntime(c);
  assert.deepEqual(c.bytes,d.bytes);
  assert.equal(c.stats.needsMemory,false);
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(c.bytes)),[]);
  assert.equal(c.stats.kernelHeapAllocationSites,0);
  assert.equal(c.stats.intermediateBufferBytes,0);
  assert.match(c.signatures.evaluate,/\[apply\]/);
  assert.doesNotMatch(JSON.stringify(c.signatures),/\$symbol/);
  for(let x=-50;x<50;x++)assert.equal(r.call('main',[x]),x*x+3*x+2);
});

test('symbol fields differ from ordinary fields and from other declared keys',async()=>{
  const source=`symbol slot; symbol other;
    export fn main = () -> do {let r={slot:2,[slot]:3,[other]:5};
      {plain:r.slot,symbol:r[slot],other:r[other]}};`;
  assert.deepEqual(await run(source,[{}]),{plain:2,symbol:3,other:5});
  for(const record of ['{slot:3}','{[other]:3}'])
    reject(`symbol slot; symbol other; fn get = r -> r[slot]; export fn main = () -> get ${record};`,'E_TYPE');
  reject('symbol slot; export fn main = () -> {[slot]:3}.slot;','E_TYPE');
});

test('declarations are order-independent and live in a separate key namespace',async()=>{
  const source=`fn symbol = x -> x+1;
    export fn main = () -> do {let key=false; let r={[key]:3,key}; symbol r[key]};
    symbol key;`;
  assert.equal(await run(source,[{}]),4);
  // A key is not a value binding; a local value cannot supply a computed key.
  reject('symbol key; export fn main = () -> key;','E_NAME');
  reject('export fn main = () -> do {let key=1; {[key]:3}[key]};','E_SYMBOL');
});

test('patterns, annotations, chained selectors, and pipes use the same key identity',async()=>{
  const source=`symbol box; symbol fnkey; symbol state;
    fn unpack = { [box]: (x,{[state]:y}), ordinary:z } -> x+y+z;
    fn typed = (r:{[state]:Num}) -> r[state];
    export fn main = () -> do {
      let outer={[box]:{method:{[fnkey]:x -> y -> x+y}}};
      {pattern:unpack {[box]:(2,{[state]:3}),ordinary:5,extra:false},
       annotation:typed {[state]:7},
       call:outer[box].method[fnkey] 4 6,
       pipe:4 |> outer[box].method[fnkey] 6}
    };`;
  assert.deepEqual(await run(source,[{}]),{pattern:10,annotation:7,call:10,pipe:10});
  const p=parse('symbol k; fn get = r -> r[k]; export fn main = () -> get {[k]:3};');
  assert.equal(p.symbols.length,1);
  assert.equal(p.definitions[0].body.kind,'field');
  assert.equal(p.definitions[0].body.name,p.symbols[0].key);
  assert.match(infer(p).signatures.get,/\[k\]/);
});

test('record-symbol helpers remain row-polymorphic and capture lexical values',async()=>{
  const source=`symbol value; symbol run;
    fn get = r -> r[value];
    fn with_value = x -> {[value]:x};
    export fn main = (x:Num) -> do {
      let read=get;
      let object={[value]:x,[run]:y -> x+y};
      {number:read (with_value x),flag:read {[value]:true,other:2},
       nested:read {[value]:(x,x+1)},capture:object[run] 2}
    };`;
  for(const options of modes)assert.deepEqual(await run(source,[3],options),{
    number:3,flag:true,nested:{_0:3,_1:4},capture:5,
  });
});

test('finite protocol choices specialize methods without implicit receivers',async()=>{
  const source=`symbol payload; symbol apply;
    fn evaluate = r -> r[apply] r[payload];
    export fn main = (flag:Bool) -> (x:Num) -> do {
      let selected=if flag then {[payload]:x,[apply]:y -> y*y}
        else {[payload]:x+1,[apply]:y -> 3*y};
      evaluate selected
    };`;
  for(const options of modes)for(const flag of [false,true])
    assert.equal(await run(source,[flag,4],options),flag?16:15);
  reject('symbol call; export fn main = () -> {[call]:x -> x}.call 1;','E_TYPE');
});

test('legacy record construction, annotations, selections, and qualified pipes agree',async()=>{
  const files=[{name:'keys.ass',source:'symbol slot; symbol call;'},
    {name:'legacy.ass',source:'fn get(r:{[slot]:Num})=r[slot]; fn build(x)={[slot]:x,[call]:y=>y+2};'},
    {name:'main.ass',source:'export fn main = (x:Num) -> do {let r=build x; get {[slot]:x} |> r[call]};'}];
  assert.equal((await createRuntime(compileSources(files))).call('main',[3]),5);
  assert.equal(await run('symbol call; export fn main()={let r={[call]:x=>x+2}; 3 |> r[call]};',[]),5);
});

test('symbols do not eagerly evaluate fields, implicit hooks, or inactive methods',async()=>{
  const programs=[
    ['do {let r={[key]:require false 3,ordinary:7}; r.ordinary}',7],
    ['do {let r={[key]:x -> require false x}; 7}',7],
    ['do {let r={[key]:require false (x -> x)}; 7}',7],
    ['do {let r=if true then {[key]:x -> x*x} else {[key]:x -> require false x}; r[key] 3}',9],
    ['do {let r={[dispose]:x -> require false x}; 7}',7],
  ];
  for(const options of modes)for(const [expression,expected] of programs)
    assert.equal(await run(`symbol key; symbol dispose; export fn main = () -> ${expression};`,[{}],options),expected);
  for(const options of modes)for(const expression of [
    '{[key]:require false 3}[key]',
    '(require false {[key]:3})[key]',
    '(require false {[key]:x -> x})[key] 3',
    '{[key]:require false (x -> x)}[key] 3',
  ])await assert.rejects(()=>run(`symbol key; export fn main = () -> ${expression};`,[{}],options),WebAssembly.RuntimeError);
});

test('wrapped streams retain provenance and sequential access restrictions',async()=>{
  const source=`symbol stream;
    export fn main = (xs:[Num]) -> do {
      let wrapped={[stream]:scan xs 0 (s -> x -> s+x)};
      zip xs wrapped[stream] (x -> total -> x+total)
    };`;
  for(const options of modes) {
    const c=compile(source,options);
    assert.equal(verifyCertificate(c.certificate.steps),true);
    assert.equal(c.observations.main.access,'sequential');
    assert.deepEqual(Array.from((await createRuntime(c)).call('main',[[1,2,3]])),[2,5,9]);
  }
  reject('symbol s; export fn main = (xs:[Num]) -> at {[s]:scan xs 0 (s -> x -> s+x)}[s] 1;','E_CAUSAL_ACCESS');
  reject('symbol s; export fn main = (a:[Num]) -> (b:[Num]) -> zip {[s]:a}[s] {[s]:b}[s] (x -> y -> x+y);','E_DOMAIN');
  reject('symbol s; export fn main = (xs:[Num]) -> do {let a={[s]:filter xs (x -> x>0)}; let b={[s]:filter xs (x -> x>0)}; zip a[s] b[s] (x -> y -> x+y)};','E_DOMAIN');
});

test('symbol-keyed recurrence state lowers to the same scalar machine',async()=>{
  const source=`symbol total; symbol count;
    export fn main = (xs:[Num]) -> map
      (scan xs {[total]:0,[count]:0} (s -> x -> {[total]:s[total]+x,[count]:s[count]+1}))
      (s -> s[total]/s[count]);`;
  for(const options of modes) {
    const c=compile(source,options),r=await createRuntime(c);
    assert.equal(c.stats.functions[0].stateSlots,2);
    assert.deepEqual(Array.from(r.call('main',[[2,4,6]])),[2,3,4]);
    assert.deepEqual(Array.from(r.call('main',[[]])),[]);
    const bad='symbol k; export fn main = (xs:[Num]) -> map (scan xs {[k]:require false 0} (s -> x -> {[k]:s[k]+x})) (r -> r[k]);';
    assert.deepEqual(Array.from(await run(bad,[[]],options)),[]);
    await assert.rejects(()=>run(bad,[[1]],options),WebAssembly.RuntimeError);
  }
});

test('scalar stream callbacks can use symbol methods without eager empty-stream traps',async()=>{
  for(const options of modes) {
    const source='symbol call; export fn main = (xs:[Num]) -> do {let r={[call]:x -> require false x}; map xs r[call]};';
    assert.deepEqual(Array.from(await run(source,[[]],options)),[]);
    await assert.rejects(()=>run(source,[[1]],options),WebAssembly.RuntimeError);
  }
});

test('numeric symbol products compose with forward and reverse AD',async()=>{
  const source=`symbol x; symbol y;
    fn f = p -> p[x]*p[x]+3*p[x]*p[y];
    export fn main = (x:Num) -> (y:Num) -> do {
      let point={[x]:x,[y]:y}; let g=grad f point;
      let reverse=pullback f point;
      let linear=linearize f point;
      let cotangent=reverse.pullback 2;
      let h=(jvp (grad f) point {[x]:4,[y]:5}).tangent;
      {gx:g[x],gy:g[y],cx:cotangent[x],cy:cotangent[y],
       direction:linear.pushforward {[x]:4,[y]:5},hx:h[x],hy:h[y]}
    };`;
  for(const options of modes)assert.deepEqual(await run(source,[2,4],options),{
    gx:16,gy:6,cx:32,cy:12,direction:94,hx:23,hy:12,
  });
  reject('symbol k; export fn main = (x:Num) -> grad (p -> p[k]*p[k]) {[k]:x};','E_ABI');
});

test('saved derivative callables may live behind explicit symbol protocol keys',async()=>{
  const source=`symbol forward; symbol reverse;
    export fn main = (x:Num) -> do {
      let methods={[forward]:(linearize (y -> y*y) x).pushforward,
                   [reverse]:(pullback (y -> y*y) x).pullback};
      {a:methods[forward] 2,b:methods[reverse] 3}
    };`;
  for(const options of modes)assert.deepEqual(await run(source,[3],options),{a:12,b:18});
});

test('wrapping performed results never replays a host call or grants authority',async()=>{
  const source=`symbol result; symbol read;
    host fn h: Num -> Num;
    export fn main = (x:Num) -> effect {
      let y=perform h x;
      let r={[result]:y,[read]:z -> z};
      {a:r[read] r[result],b:r[result]+r[result],d:grad (z -> z*r[result]) x}
    };`;
  for(const options of modes) {
    let calls=0;
    const capability=createCapability({h:{parameters:['Num'],result:'Num',call:x=>{calls++;return 3*x;}}},{maxCalls:1});
    const r=await createRuntime(compile(source,options));
    assert.throws(()=>r.call('main',[2]),e=>e.code==='E_CAPABILITY');
    assert.deepEqual(r.call('main',[2],{capability}),{a:6,b:12,d:6});
    assert.equal(calls,1);assert.equal(capability.remaining,0);
    assert.throws(()=>r.prepare('main',[2]),e=>e.code==='E_LEASE_EFFECT');
  }
  reject('symbol call; host fn h: Num -> Num; export fn main = () -> {[call]:h}[call] 1;','E_EFFECT');
  reject('symbol call; host fn h: Num -> Num; export fn main = () -> effect {let r={[call]:x -> x}; let y=perform r[call] 1; y};','E_EFFECT');
});

test('explicit ordinary projections are the only route across the ABI',async()=>{
  const source=`symbol hidden; symbol method;
    export fn main = (x:Num) -> do {
      let r={[hidden]:x,[method]:y -> y+1};
      {value:r[hidden],next:r[method] r[hidden]}
    };`;
  const c=compile(source);
  assert.doesNotMatch(JSON.stringify(c.abi),/\$symbol|hidden|method/);
  assert.deepEqual(await run(source,[3]),{value:3,next:4});
  for(const s of [
    'symbol k; export fn main = () -> {[k]:1};',
    'symbol k; export fn main = () -> {outer:{[k]:1},safe:2};',
    'symbol k; export fn main = (x:{[k]:Num}) -> x[k];',
    'symbol k; export fn main = (x:{outer:{[k]:Num}}) -> x.outer[k];',
    'symbol k; host fn h: {[k]:Num} -> Num; export fn main = () -> 1;',
    'symbol k; host fn h: {outer:{[k]:Num}} -> Num; export fn main = () -> 1;',
    'symbol k; host fn h(x:{[k]:Num}):Num; export fn main()=1;',
    'symbol k; export fn main = () -> {[k]:()};',
    'symbol k; export fn main = () -> {[k]:x -> x};',
  ])reject(s,'E_ABI');
});

test('symbol-wrapped spans retain snapshot lifetimes and independently owned outputs',async()=>{
  const source=`symbol bytes; symbol text; symbol stream; symbol apply;
    export fn main = (xs:[Num]) -> (b:Bytes) -> (t:Text) -> (scale:Num) -> do {
      let wrapper={[stream]:xs,[bytes]:b,[text]:t,[apply]:x -> x*scale};
      {values:map wrapper[stream] wrapper[apply],bytes:wrapper[bytes],text:wrapper[text]}
    };`;
  for(const options of modes) {
    const r=await createRuntime(compile(source,options)),xs=new Float64Array([1,2,3]),b=new Uint8Array([4,5]);
    const lease=r.prepare('main',[xs,b,'hello',2]);
    xs.fill(999);b.fill(99);
    try {
      const first=lease.run();
      assert.deepEqual(first,{values:new Float64Array([2,4,6]),bytes:new Uint8Array([4,5]),text:'hello'});
      first.values.fill(-1);first.bytes.fill(0);
      const second=lease.run({scale:3});
      assert.deepEqual(second,{values:new Float64Array([3,6,9]),bytes:new Uint8Array([4,5]),text:'hello'});
      assert.throws(()=>r.call('main',[[1],new Uint8Array(),'a',1]),e=>e.code==='E_LEASE_BUSY');
      lease.dispose();
      assert.deepEqual(second.values,new Float64Array([3,6,9]));
      assert.throws(()=>lease.run(),e=>e.code==='E_LEASE_EXPIRED');
    } finally {lease.dispose();}
  }
});

test('symbol syntax failures are structured and source-local in both compiler entrypoints',()=>{
  const bad=[
    ['export fn main = () -> {[missing]:3};','E_SYMBOL','missing'],
    ['export fn main = () -> {x:3}[missing];','E_SYMBOL','missing'],
    ['fn f = (r:{[missing]:Num}) -> r; export fn main = () -> 1;','E_SYMBOL','missing'],
    ['fn f = {[missing]:x} -> x; export fn main = () -> 1;','E_SYMBOL','missing'],
    ['symbol k; symbol k; export fn main = () -> 1;','E_NAME','k; export'],
    ['symbol k; export fn main = () -> {[k]:1,[k]:2}[k];','E_NAME','k]:2'],
    ['symbol k; fn f = {[k]:x,[k]:y} -> x+y; export fn main = () -> 1;','E_NAME','k]:y'],
    ['symbol k; fn f = {[k]:x,plain:x} -> x; export fn main = () -> 1;','E_NAME','x}'],
    ['symbol k; fn f = (r:{[k]:Num,[k]:Num}) -> 1; export fn main = () -> 1;','E_NAME','k]:Num}'],
    ['symbol k; export fn main = () -> {[k+1]:3};','E_SYMBOL','+'],
    ['symbol k; export fn main = () -> {[k]:3}[k+1];','E_SYMBOL','+'],
    ['symbol k; export fn main = () -> {[k]};','E_PARSE','}'],
    ['symbol k; fn f = {[k]} -> 1; export fn main = () -> 1;','E_PARSE','}'],
    ['symbol k; export fn main = () -> {[k]:3}[k]=4;','E_PARSE','=4'],
  ];
  for(const [source,code,mark] of bad) {
    const prefixed='// fixture\n'+source, files=[{name:'helpers.ass',source:'fn id = x -> x;'},{name:'symbols.ass',source:prefixed}];
    const d=checkSources(files).diagnostics[0];
    assert.equal(d?.code,code,source);assert.equal(d.sourceName,'symbols.ass');
    assert.equal(d.range.start.line,2);assert.equal(d.range.start.offset,prefixed.indexOf(mark));
    assert.throws(()=>compileSources(files),e=>e.code===code&&e.sourceName===d.sourceName&&e.offset===d.range.start.offset);
    assert.doesNotMatch(d.message,/\$symbol/);
  }
});

test('symbol declarations and uses obey fixed syntax/source limits',()=>{
  const declarations=n=>Array.from({length:n},(_,i)=>`symbol key${i};`).join('\n');
  assert.equal(check(declarations(256)+'\nexport fn main = () -> {[key255]:3}[key255];').ok,true);
  const d=check(declarations(257)+'\nexport fn main = () -> 1;').diagnostics[0];
  assert.equal(d.code,'E_LIMIT');assert.equal(d.range.start.line,257);
  assert.match(d.message,/256 symbol declarations/);
  const many=`symbol k; export fn main = () -> {${Array.from({length:17000},(_,i)=>`f${i}:{[k]:1}`).join(',')}};`;
  assert.throws(()=>parse(many),e=>e.code==='E_LIMIT'&&/Syntax node/.test(e.message));
  assert.equal(check('symbol k; export fn main = () -> '+ '({[k]:'.repeat(260)+'1'+'})'.repeat(260)+';').diagnostics[0].code,'E_LIMIT');
});

test('source composition and compiler sessions do not leak symbol registries',async()=>{
  const key={name:'keys.ass',source:'symbol k;'},helper={name:'helper.ass',source:'fn get = r -> r[k];'},
    main={name:'main.ass',source:'export fn main = (x:Num) -> get {[k]:x};'};
  const compiler=createCompiler();
  const first=compiler.compileSources([main,helper,key]),second=compiler.compileSources([key,helper,main]);
  assert.deepEqual(first.bytes,second.bytes);
  assert.deepEqual(first.signatures,second.signatures);
  first.bytes.fill(0);first.signatures.get='corrupted';
  assert.equal((await createRuntime(compiler.compileSources([main,helper,key]))).call('main',[7]),7);
  assert.throws(()=>compiler.compileSources([main,helper]),e=>e.code==='E_SYMBOL');
  const duplicate=checkSources([key,{name:'duplicate.ass',source:'// conflict\nsymbol k;'},main,helper]).diagnostics[0];
  assert.equal(duplicate.code,'E_NAME');assert.equal(duplicate.sourceName,'duplicate.ass');assert.equal(duplicate.range.start.line,2);
});

test('the documented reducer is executable and byte-identical to an explicit fold',async()=>{
  const doc=await readFile(new URL('../docs/RECORD-SYMBOLS.md',import.meta.url),'utf8');
  const source=doc.match(/```ass\n([\s\S]*?)\n```/)[1];
  const direct='export fn energy = (xs:[Num]) -> fold xs 0 (total -> x -> total+x*x);';
  for(const options of modes) {
    const c=compile(source,options),d=compile(direct,options);
    assert.deepEqual(c.bytes,d.bytes);assert.deepEqual(c.certificate,d.certificate);
    assert.equal(c.stats.functions[0].loops,d.stats.functions[0].loops);
    if (!options.simd) assert.equal(c.stats.functions[0].loops,1);
    const r=await createRuntime(c);
    assert.equal(r.call('energy',[[1,2,3]]),14);assert.equal(r.call('energy',[[]]),0);
    assert.equal(r.call('energy',[[-2,3,-4]]),29);
  }
});
