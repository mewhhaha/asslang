import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileSources, checkSources } from '../src/compiler.mjs';
import { createRuntime } from '../src/abi.mjs';

const products = {name:'products.ass',source:await readFile(new URL('../lib/products.ass',import.meta.url),'utf8')};
const optimization = {name:'optimization.ass',source:await readFile(new URL('../lib/optimization.ass',import.meta.url),'utf8')};
const files = source => [products,optimization,{name:'app.ass',source}];
const modes = [false,true].flatMap(simd=>[false,true].flatMap(reductionFusion=>
  [false,true].map(memoizeReductions=>({simd,reductionFusion,memoizeReductions}))));

const target = {gain:2,model:{bias:-1,slope:4}};
const start = {gain:0,model:{bias:1,slope:2}};
const objective = `p ->
  (p.gain-2)*(p.gain-2) +
  (p.model.bias+1)*(p.model.bias+1) +
  (p.model.slope-4)*(p.model.slope-4)`;

const plain = value => ArrayBuffer.isView(value) ? [...value] : value;

test('source gradient steps specialize over scalar and nested numeric products with no update loop', async () => {
  const scalar = `export fn main = (x:Num) -> product_gradient_step (y -> (y-3)*(y-3)) x 0.25;`;
  const nested = `export fn main = (p:{gain:Num,model:{bias:Num,slope:Num}}) ->
    product_gradient_step (${objective}) p 0.25;`;
  for (const options of modes) {
    const a=compileSources(files(scalar),options), ar=await createRuntime(a);
    assert.equal(ar.call('main',[0]),1.5);
    assert.equal(a.stats.functions[0].loops,0);
    assert.equal(a.stats.intermediateBufferBytes,0);
    assert.equal(a.abi.version,1);

    const b=compileSources(files(nested),options), br=await createRuntime(b);
    assert.deepEqual(br.call('main',[start]),{gain:1,model:{bias:0,slope:3}});
    assert.equal(b.stats.functions[0].loops,0);
    assert.equal(b.stats.intermediateBufferBytes,0);
    assert.equal(b.abi.version,1);
  }
});

test('two source momentum steps carry explicit state and reach the independent nested-record oracle', async () => {
  const source = `export fn main = (p:{gain:Num,model:{bias:Num,slope:Num}}) -> do {
    let vector=numeric_vector p;
    let first=momentum_step_with vector (${objective})
      {point:p,velocity:vector.zero} 0.25 0.5;
    momentum_step_with vector (${objective}) first 0.25 0.5
  };`;
  for (const options of modes) {
    const artifact=compileSources(files(source),options), runtime=await createRuntime(artifact);
    assert.deepEqual(runtime.call('main',[start]),{
      point:target,
      velocity:{gain:-4,model:{bias:4,slope:-4}},
    });
    assert.equal(artifact.stats.functions[0].loops,0);
    assert.equal(artifact.stats.intermediateBufferBytes,0);
  }
});

test('gradient_step_with is an ordinary row-polymorphic source dictionary consumer', async () => {
  const source=`export fn main = (x:Num) -> do {
    let clipped={axpy:point -> direction -> rate ->
      point + rate*(if direction < -1 then -1 else if direction > 1 then 1 else direction)};
    gradient_step_with clipped (y -> (y-3)*(y-3)) x 0.5
  };`;
  const artifact=compileSources(files(source));
  assert.equal((await createRuntime(artifact)).call('main',[0]),0.5);
  assert.equal(artifact.stats.functions[0].loops,0);
});

test('numeric-vector witnesses and unused dictionary fields retain lazy demand', async () => {
  const source=`export fn main = () -> do {
    let vector=numeric_vector {a:require false 1};
    vector.axpy {a:2} {a:3} 4
  };`;
  const artifact=compileSources(files(source));
  assert.deepEqual((await createRuntime(artifact)).call('main',[{}]),{a:14});
});

test('optimizer shape errors survive unused callers and keep client source locations', () => {
  for (const bad of [
    `fn unused = () -> product_momentum_step (p -> p.a*p.a)
      {point:{a:1},velocity:{b:0}} 0.1 0.9; export fn main = () -> 0;`,
    `fn unused = () -> product_momentum_step (p -> p.a*p.a)
      {point:{a:1},velocity:{a:true}} 0.1 0.9; export fn main = () -> 0;`,
  ]) {
    const checked=checkSources(files(bad));
    assert.equal(checked.ok,false,bad);
    assert.equal(checked.diagnostics[0].code,'E_TYPE');
    assert.equal(checked.diagnostics[0].sourceName,'app.ass');
  }
  const missing=checkSources(files(`// local diagnostic
    export fn main = (x:Num) -> gradient_step_with {axpy:p -> d -> r -> missing}
      (y -> y*y) x 0.1;`));
  assert.equal(missing.ok,false);
  assert.equal(missing.diagnostics[0].code,'E_NAME');
  assert.equal(missing.diagnostics[0].sourceName,'app.ass');
});

test('optimizer names are not compiler hooks and a gradient step matches its direct source expansion', () => {
  const via=`export fn main = (p:{gain:Num,model:{bias:Num,slope:Num}}) -> (rate:Num) -> do {
    let loss=${objective};
    product_gradient_step loss p rate
  };`;
  const explicit=`export fn main = (p:{gain:Num,model:{bias:Num,slope:Num}}) -> (rate:Num) -> do {
    let loss=${objective};
    product_axpy p (grad loss p) (-rate)
  };`;
  const renamed={name:'optimization.ass',source:optimization.source.replaceAll('product_gradient_step','shape_gradient_step')};
  for (const options of modes) {
    const compiled=compileSources(files(via),options);
    const expanded=compileSources([products,{name:'app.ass',source:explicit}],options);
    assert.deepEqual(compiled.bytes,expanded.bytes);
    const renamedCompiled=compileSources([products,renamed,{name:'app.ass',source:via.replace('product_gradient_step','shape_gradient_step')}],options);
    assert.deepEqual(compiled.bytes,renamedCompiled.bytes);
  }
});

test('clipped gradient steps reuse dot, scale and axpy over scalar and nested products', async () => {
  const scalar=`export fn main = (x:Num) ->
    product_clipped_gradient_step (y -> 6*y) x 0.25 2;`;
  const nested=`export fn main = (p:{gain:Num,model:{bias:Num,slope:Num}}) ->
    product_clipped_gradient_step
      (q -> 6*q.gain + 8*q.model.slope) p 0.1 5;`;
  for (const options of modes) {
    const a=compileSources(files(scalar),options), ar=await createRuntime(a);
    assert.equal(ar.call('main',[0]),-0.5);
    assert.equal(a.stats.functions[0].loops,0);
    assert.equal(a.stats.intermediateBufferBytes,0);
    assert.equal(a.abi.version,1);

    const b=compileSources(files(nested),options), br=await createRuntime(b);
    const point={gain:1,model:{bias:1,slope:2}};
    const got=br.call('main',[point]);
    const factor=Math.min(1,5/Math.hypot(6,8));
    assert.deepEqual(got,{
      gain:point.gain-0.1*6*factor,
      model:{bias:point.model.bias,slope:point.model.slope-0.1*8*factor},
    });
    assert.equal(b.stats.functions[0].loops,0);
    assert.equal(b.stats.intermediateBufferBytes,0);
    assert.equal(b.abi.version,1);
  }
});

test('clipping preserves branch demand, zero-bound behavior and the explicit nonnegative contract', async () => {
  const lazy=`export fn main = (x:Num) -> do {
    let vector={
      dot:left -> right -> left*right,
      scale:value -> factor -> require false (value*factor),
      axpy:value -> direction -> rate -> value+rate*direction,
    };
    clipped_gradient_step_with vector (y -> y*y/2) x 0.5 2
  };`;
  assert.equal((await createRuntime(compileSources(files(lazy)))).call('main',[2]),1);

  const zero=`export fn main = (x:Num) ->
    product_clipped_gradient_step (y -> 3*y) x 0.5 0;`;
  assert.equal((await createRuntime(compileSources(files(zero)))).call('main',[7]),7);

  const negative=`export fn main = (x:Num) ->
    product_clipped_gradient_step (y -> require false (y*y)) x 0.5 (-1);`;
  const runtime=await createRuntime(compileSources(files(negative)));
  assert.throws(()=>runtime.call('main',[2]),WebAssembly.RuntimeError);
});

test('clipped dictionary and product constraints survive unused generic callers', () => {
  for (const bad of [
    `fn unused = x -> clipped_gradient_step_with
      {scale:v -> f -> v*f,axpy:v -> d -> r -> v+r*d}
      (y -> y*y) x 0.1 1; export fn main = () -> 0;`,
    `fn unused = () -> product_clipped_gradient_step
      (p -> if p.a then 1 else 0) {a:true} 0.1 1; export fn main = () -> 0;`,
  ]) {
    const checked=checkSources(files(bad));
    assert.equal(checked.ok,false,bad);
    assert.equal(checked.diagnostics[0].code,'E_TYPE');
    assert.equal(checked.diagnostics[0].sourceName,'app.ass');
  }
});

test('clipped optimizer names are not hooks and match an explicit source expansion', () => {
  const via=`export fn main = (p:{x:Num,y:Num}) -> (rate:Num) -> (maxNorm:Num) ->
    product_clipped_gradient_step (q -> 6*q.x + 8*q.y) p rate maxNorm;`;
  const explicit=`export fn main = (p:{x:Num,y:Num}) -> (rate:Num) -> (maxNorm:Num) ->
    require (maxNorm>=0) (do {
      let gradient=grad (q -> 6*q.x + 8*q.y) p;
      let norm=sqrt (product_dot gradient gradient);
      let direction=if norm>maxNorm then product_scale gradient (maxNorm/norm) else gradient;
      product_axpy p direction (-rate)
    });`;
  const renamed={name:'optimization.ass',source:optimization.source
    .replaceAll('clipped_gradient_step_with','bounded_step_with')
    .replaceAll('product_clipped_gradient_step','bounded_product_step')};
  for (const options of modes) {
    const compiled=compileSources(files(via),options);
    const expanded=compileSources([products,{name:'app.ass',source:explicit}],options);
    assert.deepEqual(compiled.bytes,expanded.bytes);
    const renamedCompiled=compileSources([products,renamed,{name:'app.ass',source:via.replace('product_clipped_gradient_step','bounded_product_step')}],options);
    assert.deepEqual(compiled.bytes,renamedCompiled.bytes);
  }
});
