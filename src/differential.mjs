// Compiler-side forward AD. This module has no ambient host capabilities.
const MAX_GRADIENT_LEAVES = 64;

export function numericLeaves(value, api, at) {
  const out = api.leaves(value, at);
  if (out.some(n => n.type !== 'Num'))
    api.fail('Differentiation requires Num leaves', at, 'E_DIFF_TYPE');
  return out;
}

// Shared preparation for forward and reverse transforms. Callers validate the
// numeric input shape before introducing these private perturbation identities.
export function prepareDifferential(f, point, api, at) {
  const {scalar,boolean,shape,invoke}=api;
  const replacements=new Map(), roots=[];
  const symbolic=shape(point,value=>{
    const root=scalar('guard','Num',[boolean(true),value],undefined,true);
    // Substitution can clone graph nodes; the perturbation tag survives clones.
    root.data={differentialSeed:root.id};
    replacements.set(root.id,value);roots.push(root);return root;
  });
  const value=invoke(f,[symbolic],at);numericLeaves(value,api,at);
  return {value,roots,replacements};
}

// Each direction gets its own cache, sharing the original tagged primal graph.
function prepareLinearization(f, point, api, at) {
  const {scalar,num,shape,substitute,fail}=api;
  const {value,roots,replacements}=prepareDifferential(f,point,api,at);
  function pushforward(seeds, callAt=at) {
    const tangents=new Map(roots.map((root,i)=>[root.id,seeds[i]]));
    const cache=new Map(), dependencies=new Map();
    const depends=n=>{
      if(tangents.has(n.data?.differentialSeed??n.id))return true;
      if(dependencies.has(n.id))return dependencies.get(n.id);
      const result=n.args.some(depends);dependencies.set(n.id,result);return result;
    };
    const op=(name,...args)=>scalar(name,'Num',args);
    const select=(condition,yes,no)=>scalar('if','Num',[condition,yes,no]);
    function derivative(n) {
      const key=n.data?.differentialSeed??n.id;
      if(tangents.has(key))return tangents.get(key);
      if(cache.has(n.id))return cache.get(n.id);
      const [a,b]=n.args;let result;
      if(n.op==='guard' && n.data?.stopGradient)result=num(0);
      else switch(n.op) {
        case 'const':case 'wire':case 'index':case 'acc':case 'cell':result=num(0);break;
        case 'host_call':
          if(depends(n))fail('Cannot differentiate a host invocation',callAt,'E_DIFF_EFFECT');
          result=num(0);break;
        case '+':case '-':result=op(n.op,derivative(a),derivative(b));break;
        case '*':result=op('+',op('*',derivative(a),b),op('*',a,derivative(b)));break;
        case '/':result=op('/',op('-',op('*',derivative(a),b),op('*',a,derivative(b))),op('*',b,b));break;
        case 'neg':result=op('neg',derivative(a));break;
        case 'sqrt':result=op('/',derivative(a),op('*',num(2),n));break;
        case 'abs':result=select(scalar('>','Bool',[a,num(0)]),derivative(a),
          select(scalar('<','Bool',[a,num(0)]),op('neg',derivative(a)),num(0)));break;
        case 'min':case 'max':result=select(scalar(n.op==='min'?'<=':'>=','Bool',[a,b]),derivative(a),derivative(b));break;
        case 'floor':result=num(0);break;
        case 'if':result=select(a,derivative(b),derivative(n.args[2]));break;
        case 'guard':result=scalar('guard','Num',[a,derivative(b)]);break;
        case 'load':case 'bool_load':case 'byte_load':case 'to_num':
          if(depends(n))fail('Cannot differentiate a memory address, index, or extent',callAt,'E_DIFF_CONTROL');
          result=num(0);break;
        default:fail(`Differentiation does not yet support '${n.op}'`,callAt,'E_DIFF_UNSUPPORTED');
      }
      cache.set(n.id,result);return result;
    }
    const tangent=shape(value,n=>{
      const d=derivative(n);
      // Both arms agree, but evaluating the condition retains primal demand even
      // for NaN, a constant derivative, or a primal-only range/bounds check.
      return select(scalar('==','Bool',[n,n]),d,d);
    });
    return substitute(tangent,replacements);
  }
  return {value:substitute(value,replacements),pushforward};
}

export function forwardLinearize(f, point, direction, api, at) {
  const inputs=numericLeaves(point,api,at), seeds=numericLeaves(direction,api,at);
  if(inputs.length!==seeds.length)
    api.fail('Differentiation seed shape mismatch',at,'E_DIFF_TYPE');
  const linear=prepareLinearization(f,point,api,at);
  return {kind:'record',fields:new Map([
    ['value',linear.value],['tangent',linear.pushforward(seeds)],
  ])};
}

export function reusableLinearize(f, point, api, at) {
  const inputs=numericLeaves(point,api,at);
  const linear=prepareLinearization(f,point,api,at);
  // This callable exists only during staging. Applying it walks the saved graph;
  // it never invokes the source objective again or exports a guest closure.
  const pushforward={kind:'linearized_callable',apply(direction,callAt) {
    const seeds=numericLeaves(direction,api,callAt);
    if(inputs.length!==seeds.length)
      api.fail('Differentiation seed shape mismatch',callAt,'E_DIFF_TYPE');
    return linear.pushforward(seeds,callAt);
  }};
  return {kind:'record',fields:new Map([
    ['value',linear.value],['pushforward',pushforward],
  ])};
}

export function valueAndGradient(f, point, api, at) {
  const inputs=numericLeaves(point,api,at);
  if(inputs.length===0)
    api.fail('Gradients require at least one Num input leaf',at,'E_DIFF_TYPE');
  if(inputs.length>MAX_GRADIENT_LEAVES)
    api.fail(`Gradients are limited to ${MAX_GRADIENT_LEAVES} input leaves`,at,'E_LIMIT');
  const linear=prepareLinearization(f,point,api,at);
  if(linear.value.kind!=='scalar'||linear.value.type!=='Num')
    api.fail('Gradient objective must return Num',at,'E_DIFF_TYPE');
  const zero=api.num(0), one=api.num(1);
  let coordinate=0;
  const gradient=api.shape(point,()=>{
    const index=coordinate++;
    return linear.pushforward(inputs.map((_,i)=>i===index?one:zero));
  });
  return {kind:'record',fields:new Map([
    ['value',linear.value],['gradient',gradient],
  ])};
}

export function stopGradient(value,api,at) {
  return api.shape(value,n=>{
    if(n.kind!=='scalar'||n.type!=='Num')api.fail('stop_gradient requires Num leaves',at,'E_DIFF_TYPE');
    return api.scalar('guard','Num',[api.boolean(true),n],{stopGradient:true},true);
  });
}
