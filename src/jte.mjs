import { flatTypes, isScalarSchema } from './abi-schema.mjs';
import { fail, prune, showType } from './frontend.mjs';

// JTE v0 encodes relational observations of values, not sizes in ordinary types.
// A domain identifies an ordered sequence of iteration events. A positional
// runtime check introduces a NEW domain; it never equates two input origins.
export function verifyCertificate(steps) {
  const facts = [];
  for (const step of steps) {
    if (step.id !== facts.length) throw new Error('JTE: noncanonical step id');
    const parents = step.parents.map(id => {
      if (!Number.isInteger(id) || id < 0 || id >= facts.length) throw new Error('JTE: invalid parent');
      const parent = facts[id];
      if (parent.domain === null) throw new Error('JTE: scalar used as a stream');
      return parent;
    });
    let fact;
    const arity = n => { if (parents.length !== n) throw new Error('JTE: invalid rule arity'); };
    switch (step.rule) {
      case 'source':
        arity(0); fact = { domain: step.id, dense: true, seekable: true }; break;
      case 'map':
        arity(1); fact = { ...parents[0] }; break;
      case 'scan':
        arity(1); fact = { ...parents[0], seekable: false }; break;
      case 'transduce':
        arity(1); fact = { domain:step.id, dense:false, seekable:false }; break;
      case 'filter':
        arity(1); fact = { domain: step.id, dense: false, seekable: false }; break;
      case 'zip':
        arity(2);
        if (parents[0].domain !== parents[1].domain) throw new Error('JTE: unmatched iteration domains');
        fact = { ...parents[0], seekable:parents.every(p=>p.seekable) }; break;
      case 'choose':
        arity(2); fact = {domain:step.id,dense:parents.every(p=>p.dense),seekable:parents.every(p=>p.seekable)}; break;
      case 'zip_checked':
        arity(2);
        if (!parents.every(p => p.dense)) throw new Error('JTE: checked zip needs dense streams');
        if (step.obligation !== 'equal-extent-before-iteration') throw new Error('JTE: missing dynamic obligation');
        fact = { domain: step.id, dense: true, seekable: parents.every(p=>p.seekable) }; break;
      case 'reduce':
        arity(1); fact = { domain: null, dense: false, seekable: false }; break;
      default: throw new Error(`JTE: unknown rule ${step.rule}`);
    }
    if (step.domain !== fact.domain || step.dense !== fact.dense || step.seekable !== fact.seekable) throw new Error('JTE: forged observation');
    facts.push(fact);
  }
  return true;
}

export function schemaOfType(type, at, depth=0, budget={count:0}) {
  if(depth>24 || ++budget.count>4096)fail('ABI schema resource limit exceeded',at,'E_ABI');
  const t = prune(type);
  if (['Num','Bool','Text','Bytes'].includes(t.tag)) return { kind: t.tag };
  if (t.tag === 'Stream' && ['Num','Bool'].includes(prune(t.element).tag)) return {kind:'Stream',element:{kind:prune(t.element).tag}};
  if (t.tag === 'Record') {
    const fields=new Map(t.fields); let tail=t.tail && prune(t.tail);
    while (tail?.tag === 'Record') { for(const [k,v] of tail.fields) fields.set(k,v); tail=tail.tail && prune(tail.tail); }
    if (tail) fail('Exported record rows must be closed with an annotation',at,'E_ABI');
    if(fields.size>128)fail('ABI records are limited to 128 fields per level',at,'E_ABI');
    return {kind:'Record',fields:[...fields].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,type])=>({name,schema:schemaOfType(type,at,depth+1,budget)}))};
  }
  fail(`Type ${showType(t)} has no supported concrete ABI; annotate the export boundary`,at,'E_ABI');
}

export function stage(program, inferred, { maxExpansion = 100_000 } = {}) {
  const definitions = new Map(program.definitions.map(d => [d.name, d]));
  const steps = [], kernels = [], nodes = [], intern = new Map();
  let work = 0, staticZips = 0, checkedZips = 0;
  let activeIndices = new Set();
  let nextMachine = 0;
  if((program.hosts?.length??0)>256 || program.definitions.filter(d=>d.exported).length>1024 || [...program.definitions,...(program.hosts??[])].some(d=>d.params.length>128))fail('ABI function table resource limit exceeded',null,'E_ABI');
  const hostDeclarations = (program.hosts ?? []).map((h,index) => ({name:h.name,index,
    parameters:h.annotations.map(t=>schemaOfType(t,h)),result:schemaOfType(h.resultAnnotation,h)}));
  // Host calls intentionally support scalar and borrowed text/byte arguments only.
  function hostSupported(s) { return ['Num','Bool','Text','Bytes'].includes(s.kind) || s.kind==='Record' && s.fields.every(f=>hostSupported(f.schema)); }
  for (const h of hostDeclarations) if (!h.parameters.every(hostSupported)) fail('Host stream arguments require explicit materialization, not implemented yet',null,'E_ABI');
  const hostByName = new Map(hostDeclarations.map(h=>[h.name,h]));
  function scalar(op, type, args = [], data = undefined, unique = false) {
    const key = `${op}:${type}:${args.map(n => n.id).join(',')}:${
      Object.is(data, -0) ? '-0' : JSON.stringify(data)}`;
    if (nodes.length >= maxExpansion) fail('Scalar graph expansion limit exceeded',null,'E_LIMIT');
    if (!unique && intern.has(key)) return intern.get(key);
    const value = { kind: 'scalar', id: nodes.length, op, type, args, data };
    nodes.push(value);
    if (!unique) intern.set(key, value);
    return value;
  }
  const num = value => scalar('const', 'Num', [], value);
  const int = value => scalar('const','I32',[],value);
  const boolean = value => scalar('const', 'Bool', [], value ? 1 : 0);
  function record(rule, parents = [], extra = {}) {
    const id = steps.length, pp = parents.map(p => steps[p.proof]);
    const domain = rule === 'reduce' ? null : ['map', 'zip', 'scan'].includes(rule) ? pp[0].domain : id;
    const dense = rule==='choose' ? pp.every(p=>p.dense) : ['source', 'zip_checked'].includes(rule) || ['map', 'zip', 'scan'].includes(rule) && pp[0].dense;
    const seekable = rule === 'source' || ['map','zip','choose','zip_checked'].includes(rule) && pp.every(p=>p.seekable);
    const step = { id, rule, seekable: Boolean(seekable), parents: parents.map(p => p.proof), domain, dense: Boolean(dense), ...extra };
    steps.push(step); return id;
  }
  const requireScalar = (v, at) => {
    if (v.kind !== 'scalar') fail('Expected a scalar computation; streams/closures cannot be used here', at, 'E_LOWER');
    return v;
  };
  const requireStream = (v, at) => {
    if (v.kind !== 'stream') fail('Expected a stream', at, 'E_LOWER');
    return v;
  };
  const union = (a, b) => [...new Set([...a, ...b])];
  const fields = value => [...value.fields].sort(([a],[b])=>a<b?-1:a>b?1:0);
  function leaves(value,at) {
    if (value.kind==='record') return fields(value).flatMap(([,v])=>leaves(v,at));
    return [requireScalar(value,at)];
  }
  function shape(value, transform) {
    if (value.kind==='record') return {kind:'record',fields:new Map(fields(value).map(([k,v])=>[k,shape(v,transform)]))};
    return transform(value);
  }
  function choose(condition,yes,no,at) {
    if(yes.kind==='blob' && no.kind==='blob')return {kind:'blob',type:yes.type,
      pointer:scalar('if','I32',[condition,yes.pointer,no.pointer]),extent:scalar('if','I32',[condition,yes.extent,no.extent])};
    if(yes.kind==='stream' && no.kind==='stream' && (yes.machines.length || no.machines.length))
      fail('Choose the source before scan/transduce, or branch inside the transition; selecting stateful streams is not implemented',at,'E_STATE_BRANCH');
    if(yes.kind==='stream' && no.kind==='stream')return {kind:'stream',proof:record('choose',[yes,no]),
      machines:[],extent:scalar('if','I32',[condition,yes.extent,no.extent]),indices:union(yes.indices,no.indices),
      mask:yes.mask||no.mask?scalar('if','Bool',[condition,yes.mask??boolean(true),no.mask??boolean(true)]):null,
      item:choose(condition,yes.item,no.item,at),
      guards:[...yes.guards.map(g=>scalar('if','Bool',[condition,g,boolean(true)])),...no.guards.map(g=>scalar('if','Bool',[condition,boolean(true),g]))]};
    if (yes.kind==='record' && no.kind==='record') return {kind:'record',fields:new Map(fields(yes).map(([k,v])=>[k,choose(condition,v,no.fields.get(k),at)]))};
    return scalar('if',requireScalar(yes,at).type,[condition,yes,requireScalar(no,at)]);
  }
  function guardValue(condition,value,at) {
    if(value.kind==='stream') return {...value,guards:union(value.guards,[condition])};
    if(value.kind==='record') return shape(value,v=>guardValue(condition,v,at));
    if(value.kind==='blob') return {...value,pointer:scalar('guard','I32',[condition,value.pointer]),extent:scalar('guard','I32',[condition,value.extent])};
    return scalar('guard',requireScalar(value,at).type,[condition,value]);
  }
  // Substitute a dense stream cursor, including captures in nested reductions.
  function substitute(value,replacements) {
    const cache=new Map();
    const visitValue=v=>v.kind==='record' ? shape(v,visitValue) : visit(v);
    const visitPlan=p=>({...p,item:visitValue(p.item),extent:visit(p.extent),mask:p.mask&&visit(p.mask),guards:p.guards.map(visit),
      machines:p.machines.map(m=>({...m,initial:m.initial.map(visit),body:m.body.map(visit),
        outputs:m.outputs.map(visit),emission:visit(m.emission),gate:m.gate&&visit(m.gate)}))});
    function visit(n) {
      if(replacements.has(n.id)) return replacements.get(n.id);
      if(cache.has(n.id)) return cache.get(n.id);
      if(['wire','index','acc','cell','const'].includes(n.op)) return n;
      const r=scalar(n.op,n.type,n.args.map(visit),n.data,['reduce','reduce_group','iterate_group'].includes(n.op)); cache.set(n.id,r);
      if(n.op==='reduce') Object.assign(r,{stream:visitPlan(n.stream),initial:visit(n.initial),acc:n.acc,body:visit(n.body)});
      if(n.op==='reduce_group') Object.assign(r,{stream:visitPlan(n.stream),initial:n.initial.map(visit),acc:n.acc,body:n.body.map(visit)});
      if(n.op==='iterate_group') Object.assign(r,{initial:n.initial.map(visit),acc:n.acc,body:n.body.map(visit),limit:visit(n.limit),done:visit(n.done)});
      return r;
    }
    return visitValue(value);
  }
  // Observation identity is not a lexical loop-variable identity. Only rename
  // cursors when staging a traversal nested inside an active use of that source.
  function scopedPlan(plan) {
    if(!plan.indices.some(i=>activeIndices.has(i.id)))return plan;
    const replacements=new Map(plan.indices.map(i=>[i.id,scalar('index','I32',[],null,true)]));
    for(const m of plan.machines)for(const n of [...m.acc,...m.cells])replacements.set(n.id,scalar(n.op,n.type,[],null,true));
    const visit=n=>substitute(n,replacements);
    return {...plan,indices:plan.indices.map(i=>replacements.get(i.id)),
      item:substitute(plan.item,replacements),mask:plan.mask&&visit(plan.mask),
      machines:plan.machines.map(m=>({...m,id:nextMachine++,initial:m.initial.map(visit),body:m.body.map(visit),
        outputs:m.outputs.map(visit),emission:visit(m.emission),gate:m.gate&&visit(m.gate),
        acc:m.acc.map(n=>replacements.get(n.id)),cells:m.cells.map(n=>replacements.get(n.id))}))};
  }
  function iteration(plans,run) {
    const previous=activeIndices;
    activeIndices=new Set([...previous,...plans.flatMap(p=>p.indices.map(i=>i.id))]);
    try{return run();}finally{activeIndices=previous;}
  }
  function source(extent, item, index, name) {
    const proof = record('source', [], { name });
    return { kind: 'stream', proof, extent, item, indices: [index], mask: null, guards: [], machines: [] };
  }
  function invoke(callee, args, at) {
    if (++work > maxExpansion) fail('Staging expansion limit exceeded; recursive/expansive abstraction is not supported', at, 'E_LIMIT');
    if (callee.kind === 'closure') {
      if (callee.params.length !== args.length) fail('Wrong argument count', at, 'E_ARITY');
      const local = new Map(callee.env);
      callee.params.forEach((p, i) => local.set(p, args[i]));
      return expression(callee.body, local);
    }
    if (callee.kind !== 'builtin') fail('Only statically known functions can be called', at, 'E_LOWER');
    const name = callee.name;
    if (name === 'range') {
      const index = scalar('index', 'I32', [], null, true);
      const extent = scalar('extent', 'I32', [requireScalar(args[0], at)]);
      return source(extent, scalar('to_num', 'Num', [index]), index, 'range');
    }
    if (['sqrt', 'abs', 'min', 'max', 'floor'].includes(name)) {
      return scalar(name, 'Num', args.map(v => requireScalar(v, at)));
    }
    if (name==='require') return guardValue(requireScalar(args[0],at),args[1],at);
    if (name==='utf8') return {...args[0],type:'Bytes'};
    if (name==='byte_length') return scalar('to_num','Num',[args[0].extent]);
    if (name==='byte_values') {
      const b=args[0], index=scalar('index','I32',[],null,true);
      return source(b.extent,scalar('byte_load','Num',[b.pointer,index]),index,'bytes');
    }
    if(name==='iterate') {
      const initial=leaves(args[0],at), acc=initial.map(v=>scalar('acc',v.type,[],null,true));
      let cursor=0;const state=shape(args[0],()=>acc[cursor++]);
      const transition=invoke(args[2],[state],at), next=transition.fields.get('state');
      const body=leaves(next,at), done=requireScalar(transition.fields.get('done'),at);
      if(body.length!==initial.length || body.some((v,i)=>v.type!==initial[i].type))fail('Iteration state changed representation',at,'E_LOWER');
      const group=scalar('iterate_group','Group',[],null,true);
      Object.assign(group,{initial,acc,body,done,limit:scalar('extent','I32',[requireScalar(args[1],at)])});
      cursor=0;return {kind:'record',fields:new Map([
        ['state',shape(next,v=>scalar('iterate_field',v.type,[group],cursor++))],
        ['steps',scalar('iterate_field','Num',[group],body.length)],
        ['done',scalar('iterate_field','Bool',[group],body.length+1)]])};
    }
    const input = scopedPlan(requireStream(args[0], at));
    if (name==='at') {
      if (input.mask) fail('at requires a dense stream; filtered random access needs materialization',at,'E_DENSE');
      if(!steps[input.proof].seekable)fail('at cannot seek through evolving state. Traverse the stream, or materialize it across an ABI boundary first',at,'E_CAUSAL_ACCESS');
      const index=scalar('checked_index','I32',[requireScalar(args[1],at),input.extent]);
      let item=substitute(input.item,new Map(input.indices.map(i=>[i.id,index])));
      // The bound check is demanded even when a mapped value ignores its index.
      const valid=scalar('index_valid','Bool',[index]);
      for(const guard of [...input.guards,valid]) item=guardValue(guard,item,at);
      return item;
    }
    if (name === 'map') {
      const item = iteration([input],()=>invoke(args[1], [input.item], at));
      leaves(item,at);
      return { ...input, item, proof: record('map', [input]) };
    }
    if(name==='scan' || name==='transduce') {
      const initial=leaves(args[1],at), acc=initial.map(v=>scalar('acc',v.type,[],null,true));
      let cursor=0;const state=shape(args[1],()=>acc[cursor++]);
      const transition=iteration([input],()=>invoke(args[2],[state,input.item],at));
      const next=name==='scan'?transition:transition.fields.get('state');
      const output=name==='scan'?next:transition.fields.get('value');
      const emission=name==='scan'?boolean(true):requireScalar(transition.fields.get('emit'),at);
      const body=leaves(next,at),outputs=leaves(output,at);
      if(body.length!==initial.length || body.some((v,i)=>v.type!==initial[i].type))fail('Transition state changed representation',at,'E_LOWER');
      const cells=[...outputs.map(v=>scalar('cell',v.type,[],null,true)),scalar('cell','Bool',[],null,true)];
      const machine={id:nextMachine++,initial,acc,body,outputs,emission,cells,gate:input.mask};
      cursor=0;const item=shape(output,()=>cells[cursor++]);
      const emitted=cells.at(-1);
      const mask=name==='scan'?input.mask:input.mask?scalar('&&','Bool',[input.mask,emitted]):emitted;
      return {...input,item,mask,machines:[...input.machines,machine],proof:record(name,[input])};
    }
    if (name === 'filter') {
      const condition = requireScalar(iteration([input],()=>invoke(args[1], [input.item], at)), at);
      const mask = input.mask ? scalar('&&', 'Bool', [input.mask, condition]) : condition;
      return { ...input, mask, proof: record('filter', [input]) };
    }
    if (name === 'zip' || name === 'zip_checked') {
      const other = scopedPlan(requireStream(args[1], at));
      let guards = union(input.guards, other.guards);
      if (name === 'zip') {
        if (steps[input.proof].domain !== steps[other.proof].domain) {
          fail('zip requires the same iteration domain. Share the source/filter binding, or use zip_checked for dense positional pairing. Equal lengths alone do not prove event alignment.', at, 'E_DOMAIN');
        }
        staticZips++;
      } else {
        if (!steps[input.proof].dense || !steps[other.proof].dense) {
          fail('zip_checked currently accepts only dense streams; independently filtered streams need a future two-cursor implementation', at, 'E_DENSE');
        }
        guards = union(guards, [scalar('same_extent', 'Bool', [input.extent, other.extent])]);
        checkedZips++;
      }
      const item = iteration([input,other],()=>invoke(args[2], [input.item, other.item], at));
      leaves(item,at);
      const proof = record(name, [input, other], name === 'zip_checked' ? { obligation: 'equal-extent-before-iteration' } : {});
      return { ...input, item, proof, guards, machines:union(input.machines,other.machines), indices: union(input.indices, other.indices) };
    }
    if (name==='count' && steps[input.proof].dense && !input.machines.length) {
      let result=scalar('to_num','Num',[input.extent]);
      for(const guard of input.guards)result=guardValue(guard,result,at);
      record('reduce',[input]);return result;
    }
    if (['sum', 'count', 'fold'].includes(name)) {
      if (name==='fold' && args[1].kind==='record') {
        const initial=leaves(args[1],at), acc=initial.map(v=>scalar('acc',v.type,[],null,true));
        let cursor=0; const accumulator=shape(args[1],()=>acc[cursor++]);
        const resultShape=iteration([input],()=>invoke(args[2],[accumulator,input.item],at)), body=leaves(resultShape,at);
        if (body.length!==initial.length || body.some((v,i)=>v.type!==initial[i].type)) fail('Fold representation changed',at,'E_LOWER');
        const group=scalar('reduce_group','Group',[],null,true); Object.assign(group,{stream:input,initial,acc,body});
        record('reduce',[input]); cursor=0;
        return shape(resultShape,v=>scalar('reduce_field',v.type,[group],cursor++));
      }
      const initial = name === 'fold' ? requireScalar(args[1], at) : num(0);
      const acc = scalar('acc', initial.type, [], null, true);
      const body = name === 'fold' ? requireScalar(iteration([input],()=>invoke(args[2], [acc, input.item], at)), at) :
        scalar('+', 'Num', [acc, name === 'count' ? num(1) : input.item]);
      const result = scalar('reduce', initial.type, [], null, true);
      result.stream = input; result.initial = initial; result.acc = acc; result.body = body;
      record('reduce', [input]); return result;
    }
    fail(`Unknown builtin '${name}'`, at, 'E_NAME');
  }
  function expression(ast, env) {
    if (++work > maxExpansion) fail('Staging expansion limit exceeded', ast, 'E_LIMIT');
    switch (ast.kind) {
      case 'record': return {kind:'record',fields:new Map(ast.fields.map(f=>[f.name,expression(f.value,env)]))};
      case 'field': {
        const value=expression(ast.value,env);
        if(value.kind!=='record' || !value.fields.has(ast.name)) fail('Missing staged record field',ast,'E_LOWER');
        return value.fields.get(ast.name);
      }
      case 'number': return num(ast.value);
      case 'boolean': return boolean(ast.value);
      case 'name': {
        if (env.has(ast.name)) return env.get(ast.name);
        const d = definitions.get(ast.name);
        return d ? { kind: 'closure', params: d.params, body: d.body, env: new Map() } : { kind: 'builtin', name: ast.name };
      }
      case 'lambda': return { kind: 'closure', params: ast.params, body: ast.body, env: new Map(env) };
      case 'call': return invoke(expression(ast.callee, env), ast.args.map(a => expression(a, env)), ast);
      case 'block': {
        const local = new Map(env);
        // Pure graph bindings share computations; only demanded values execute.
        for (const b of ast.bindings) local.set(b.name, expression(b.value, local));
        return expression(ast.result, local);
      }
      case 'unary': {
        const value = requireScalar(expression(ast.value, env), ast);
        return scalar(ast.op === '-' ? 'neg' : 'not', value.type, [value]);
      }
      case 'binary': {
        const left = requireScalar(expression(ast.left, env), ast), right = requireScalar(expression(ast.right, env), ast);
        const type = ['+', '-', '*', '/'].includes(ast.op) ? 'Num' : 'Bool';
        return scalar(ast.op, type, [left, right]);
      }
      case 'if': {
        const condition = requireScalar(expression(ast.condition, env), ast);
        return choose(condition,expression(ast.yes,env),expression(ast.no,env),ast);
      }
      default: fail(`Unsupported syntax ${ast.kind}`, ast, 'E_LOWER');
    }
  }
  function flattenHost(value,schema,at) {
    if(schema.kind==='Record') return schema.fields.flatMap(f=>flattenHost(value.fields.get(f.name),f.schema,at));
    if(['Text','Bytes'].includes(schema.kind)) return [value.pointer,value.extent];
    return [requireScalar(value,at)];
  }
  for (const d of program.definitions.filter(d => d.exported)) {
    const type = prune(inferred.schemes.get(d.name).type), env = new Map();
    const parameters = [], abi = [], inputLeaves=[], effects=[];
    function input(schema,path) {
      if (schema.kind==='Record') return {kind:'record',fields:new Map(schema.fields.map(f=>[f.name,input(f.schema,path+'.'+f.name)]))};
      const slots=[abi.length];
      if (isScalarSchema(schema)) {
        const value=scalar('wire',schema.kind,[],{kernel:d.name,index:abi.length}); abi.push(schema.kind);
        inputLeaves.push({name:path,type:schema.kind,slots}); return value;
      }
      const pointer=scalar('wire','I32',[],{kernel:d.name,index:abi.length});
      const extent=scalar('wire','I32',[],{kernel:d.name,index:abi.length+1}); slots.push(abi.length+1);
      abi.push('I32','I32');
      const stride=schema.kind==='Stream' ? (schema.element.kind==='Num'?8:4) : 1;
      inputLeaves.push({name:path,type:schema.kind,slots,stride});
      if(schema.kind!=='Stream') return {kind:'blob',type:schema.kind,pointer,extent};
      const index=scalar('index','I32',[],null,true);
      return source(extent,scalar(schema.element.kind==='Num'?'load':'bool_load',schema.element.kind,[pointer,index]),index,path);
    }
    for (let i=0;i<d.params.length;i++) {
      const schema=schemaOfType(type.args[i],d), start=abi.length, value=input(schema,d.params[i]);
      parameters.push({name:d.params[i],type:showType(type.args[i]),schema,slots:Array.from({length:abi.length-start},(_,j)=>start+j)});
      env.set(d.params[i],value);
    }
    const resultSchema=schemaOfType(type.result,d);
    const indirect=!isScalarSchema(resultSchema), resultType=indirect?'I32':resultSchema.kind;
    let result;
    if(d.body.kind==='effect') {
      for(const b of d.body.bindings) {
        let value;
        if(b.performed) {
          const h=hostByName.get(b.value.callee.name);
          const values=b.value.args.map(a=>expression(a,env));
          const args=values.flatMap((v,i)=>flattenHost(v,h.parameters[i],b.value));
          value=scalar('host_call',h.result.kind,[int(effects.length),...args],h.index,true);
          effects.push(value);
        } else value=expression(b.value,env);
        if(b.name) env.set(b.name,value);
      }
      result=expression(d.body.result,env);
    } else result=expression(d.body,env);
    const outputSlots=indirect?[abi.length,abi.length+1,abi.length+2]:[];
    if(indirect) abi.push('I32','I32','I32'); // result descriptor, output start, output byte capacity
    kernels.push({name:d.name,parameters,inputLeaves,abi,resultSchema,resultType,result,indirect,outputSlots,effects});
  }
  if (!kernels.length) fail('At least one export fn is required', null, 'E_ABI');
  function observe(value) {
    if(value.kind==='record')return {kind:'Record',fields:Object.fromEntries(fields(value).map(([name,v])=>[name,observe(v)]))};
    if(value.kind==='stream') {
      const fact=steps[value.proof];
      return {kind:'Stream',domain:fact.domain,dense:fact.dense,access:fact.seekable?'indexed':'sequential',
        recurrenceScalars:value.machines.reduce((n,m)=>n+m.initial.length,0)};
    }
    return {kind:value.type};
  }
  const observations=Object.fromEntries(kernels.map(k=>[k.name,observe(k.result)]));
  verifyCertificate(steps);
  return { kernels, observations, hostDeclarations, certificate: { version: 'jte-1-causal', steps }, nodes: nodes.length, work, staticZips, checkedZips };
}
