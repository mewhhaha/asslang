// Compiler-side forward AD. This module has no ambient host capabilities.
export function forwardLinearize(f, point, direction, api, at) {
  const {scalar,num,boolean,shape,leaves,invoke,substitute,fail}=api;
  const numeric=v=>{
    const out=leaves(v,at);
    if(out.some(n=>n.type!=='Num')) fail('Differentiation requires Num leaves',at,'E_DIFF_TYPE');
    return out;
  };
  const inputs=numeric(point), seeds=numeric(direction);
  if(inputs.length!==seeds.length) fail('Differentiation seed shape mismatch',at,'E_DIFF_TYPE');
  const replacements=new Map(), tangents=new Map();let cursor=0;
  const symbolic=shape(point,value=>{
    const root=scalar('guard','Num',[boolean(true),value],undefined,true);
    // Substitution can clone graph nodes; the perturbation tag survives clones.
    root.data={differentialSeed:root.id};
    replacements.set(root.id,value);tangents.set(root.id,seeds[cursor++]);return root;
  });
  const value=invoke(f,[symbolic],at);numeric(value);
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
        if(depends(n))fail('Cannot differentiate a host invocation',at,'E_DIFF_EFFECT');
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
        if(depends(n))fail('Cannot differentiate a memory address, index, or extent',at,'E_DIFF_CONTROL');
        result=num(0);break;
      default:fail(`Differentiation does not yet support '${n.op}'`,at,'E_DIFF_UNSUPPORTED');
    }
    cache.set(n.id,result);return result;
  }
  const tangent=shape(value,n=>{
    const d=derivative(n);
    // Both arms agree, but evaluating the condition retains primal demand even
    // for NaN, a constant derivative, or a primal-only range/bounds check.
    return select(scalar('==','Bool',[n,n]),d,d);
  });
  return {kind:'record',fields:new Map([
    ['value',substitute(value,replacements)],['tangent',substitute(tangent,replacements)],
  ])};
}

export function stopGradient(value,api,at) {
  return api.shape(value,n=>{
    if(n.kind!=='scalar'||n.type!=='Num')api.fail('stop_gradient requires Num leaves',at,'E_DIFF_TYPE');
    return api.scalar('guard','Num',[api.boolean(true),n],{stopGradient:true},true);
  });
}
