import { numericLeaves, prepareDifferential } from './differential.mjs';

// The checked topology contains no weights or adjoints and is safe to reuse.
function analyzeReverse(roots, outputs, api, at) {
  const {fail}=api;
  const rootMap=new Map(roots.map(n=>[n.id,n]));
  // Substitution inside nested transforms can clone a tagged input boundary.
  const canonical=n=>rootMap.get(n.data?.differentialSeed??n.id)??n;

  // Address/effect dependence includes control operands, unlike the numeric
  // reverse edges below. An explicit stack bounds compiler call-stack usage.
  const dependencies=new Map();
  function depends(node) {
    const pending=[[canonical(node),false]];
    while(pending.length) {
      const [n,done]=pending.pop();
      if(dependencies.has(n.id))continue;
      if(rootMap.has(n.id)) {dependencies.set(n.id,true);continue;}
      if(done)dependencies.set(n.id,n.args.some(a=>dependencies.get(canonical(a).id)));
      else {
        pending.push([n,true]);
        for(let i=n.args.length-1;i>=0;i--)pending.push([canonical(n.args[i]),false]);
      }
    }
    return dependencies.get(canonical(node).id);
  }
  function children(n) {
    if(rootMap.has(n.id)||n.op==='guard'&&n.data?.stopGradient)return [];
    switch(n.op) {
      case '+':case '-':case '*':case '/':case 'min':case 'max':return n.args;
      case 'neg':case 'sqrt':case 'abs':return [n.args[0]];
      case 'if':return n.args.slice(1);
      case 'guard':return [n.args[1]];
      case 'floor':case 'const':case 'wire':case 'index':case 'acc':case 'cell':return [];
      case 'host_call':
        if(depends(n))fail('Cannot differentiate a host invocation',at,'E_DIFF_EFFECT');
        return [];
      case 'load':case 'bool_load':case 'byte_load':case 'to_num':
        if(depends(n))fail('Cannot differentiate a memory address, index, or extent',at,'E_DIFF_CONTROL');
        return [];
      default:fail(`Differentiation does not yet support '${n.op}'`,at,'E_DIFF_UNSUPPORTED');
    }
  }
  const order=[],info=new Map(),pending=outputs.map(n=>[canonical(n),false]).reverse();
  while(pending.length) {
    const [n,done]=pending.pop();
    if(done) {
      const entry=info.get(n.id);
      entry.reachesRoot=rootMap.has(n.id)||entry.children.some(a=>info.get(a.id).reachesRoot);
      order.push(n);
    } else if(!info.has(n.id)) {
      const edges=children(n).map(canonical);
      info.set(n.id,{children:edges,reachesRoot:false});
      pending.push([n,true]);
      for(let i=edges.length-1;i>=0;i--)pending.push([edges[i],false]);
    }
  }

  return {canonical,rootMap,order,info};
}

// Every application owns its accumulation state; only the topology is shared.
function accumulateReverse(point, seeds, roots, outputs, plan, api) {
  const {canonical,rootMap,order,info}=plan;
  const {scalar,num,boolean}=api;
  const op=(name,...args)=>scalar(name,'Num',args);
  const bool=(name,...args)=>scalar(name,'Bool',args);
  const zero=num(0),yes=boolean(true);
  const select=(condition,a,b)=>op('if',condition,a,b);
  // Canonical unconditional activity avoids deeply nested, redundant branches.
  // These are compiler activity identities, not floating-point simplifications.
  const either=(a,b)=>a===yes||b===yes?yes:a===b?a:bool('||',a,b);
  const both=(a,b)=>a===yes?b:b===yes||a===b?a:bool('&&',a,b);

  const adjoints=new Map();
  function add(node,term,activity) {
    const n=canonical(node),previous=adjoints.get(n.id);
    adjoints.set(n.id,previous?{
      term:op('+',previous.term,term),activity:either(previous.activity,activity),
    }:{term,activity});
  }
  function edge(node,activity,term) {
    if(info.get(canonical(node).id).reachesRoot)
      // Gate the entire coefficient expression, not merely its incoming weight.
      add(node,activity===yes?term():select(activity,term(),zero),activity);
  }
  for(let i=0;i<outputs.length;i++)if(info.get(canonical(outputs[i]).id).reachesRoot)
    add(outputs[i],seeds[i],yes);
  for(let i=order.length-1;i>=0;i--) {
    const n=order[i],adjoint=adjoints.get(n.id);
    if(!adjoint||rootMap.has(n.id))continue;
    const {term:u,activity}=adjoint,[a,b]=n.args;
    const gated=c=>both(activity,c);
    const split=(condition,left,right)=>{
      edge(left,gated(condition),()=>u);
      edge(right,gated(bool('not',condition)),()=>u);
    };
    switch(n.op) {
      case '+':edge(a,activity,()=>u);edge(b,activity,()=>u);break;
      case '-':edge(a,activity,()=>u);edge(b,activity,()=>op('neg',u));break;
      case '*':edge(a,activity,()=>op('*',u,b));edge(b,activity,()=>op('*',u,a));break;
      case '/':
        edge(a,activity,()=>op('/',u,b));
        edge(b,activity,()=>op('/',op('neg',op('*',u,a)),op('*',b,b)));break;
      case 'neg':edge(a,activity,()=>op('neg',u));break;
      case 'sqrt':edge(a,activity,()=>op('/',u,op('*',num(2),n)));break;
      case 'abs':
        edge(a,gated(bool('>',a,zero)),()=>u);
        edge(a,gated(bool('<',a,zero)),()=>op('neg',u));break;
      case 'min':case 'max':split(bool(n.op==='min'?'<=':'>=',a,b),a,b);break;
      case 'if':split(a,b,n.args[2]);break;
      case 'guard':edge(b,activity,()=>scalar('guard','Num',[a,u]));break;
    }
  }

  // A contraction demands every numeric primal output. Each clause is true even
  // for NaN, but must evaluate its output; short-circuiting cannot skip a leaf.
  let demand=yes;
  for(const n of outputs)demand=bool('&&',demand,bool('||',bool('==',n,n),yes));
  let coordinate=0;
  const cotangent=api.shape(point,()=>{
    const d=adjoints.get(roots[coordinate++].id)?.term??zero;
    return select(demand,d,d);
  });
  return cotangent;
}

// VJP retains its eager validation order, including for value-only projections.
export function reverseVJP(f, point, weights, api, at) {
  numericLeaves(point,api,at);
  const seeds=numericLeaves(weights,api,at);
  const {value,roots,replacements}=prepareDifferential(f,point,api,at);
  const outputs=numericLeaves(value,api,at);
  if(outputs.length!==seeds.length)
    api.fail('Differentiation seed shape mismatch',at,'E_DIFF_TYPE');
  const plan=analyzeReverse(roots,outputs,api,at);
  const cotangent=accumulateReverse(point,seeds,roots,outputs,plan,api);
  return api.substitute({kind:'record',fields:new Map([
    ['value',value],['cotangent',cotangent],
  ])},replacements);
}

export function reusablePullback(f, point, api, at) {
  numericLeaves(point,api,at);
  const {value,roots,replacements}=prepareDifferential(f,point,api,at);
  const outputs=numericLeaves(value,api,at);
  let plan;
  // This unary callable remains compiler data, just like a saved pushforward.
  const pullback={kind:'linearized_callable',apply(weights,callAt) {
    const seeds=numericLeaves(weights,api,callAt);
    if(outputs.length!==seeds.length)
      api.fail('Differentiation seed shape mismatch',callAt,'E_DIFF_TYPE');
    // Value-only uses never analyze derivative edges. The first application
    // reports graph errors at its own source location; later calls reuse facts.
    plan??=analyzeReverse(roots,outputs,api,callAt);
    const cotangent=accumulateReverse(point,seeds,roots,outputs,plan,api);
    return api.substitute(cotangent,replacements);
  }};
  return {kind:'record',fields:new Map([
    ['value',api.substitute(value,replacements)],['pullback',pullback],
  ])};
}
