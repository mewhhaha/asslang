import {operatorSource} from './operator-source.mjs';

// This table connects fixed syntax roles to source factory names, not meanings.
// The scalar record below is the explicit bootstrap boundary; no source operator
// is used circularly to define itself. Everything else is ordinary core AST.
export const sourceOperatorNames = Object.freeze({
  '+':'add', '-':'subtract', '*':'multiply', '/':'divide',
  '==':'equal', '!=':'not_equal', '<':'less', '<=':'less_equal',
  '>':'greater', '>=':'greater_equal', '&&':'and', '||':'or', '|>':'pipe',
});
export const sourcePrefixNames = Object.freeze({'-':'negate', '!':'not'});
const numeric = Object.entries(sourceOperatorNames).filter(([symbol]) => !['&&','||','|>'].includes(symbol));

// The bootstrap file cannot depend on the operator environment it creates.
export function validateOperatorText(source, tokenize) {
  for (const token of tokenize(source)) if (Object.hasOwn(sourceOperatorNames,token.text) || Object.hasOwn(sourcePrefixNames,token.text))
    throw new Error('Operator factories must use scalar fields, not default operator syntax');
}
function validateClosedFactory(definition) {
  function visit(ast, names) {
    if (ast.kind==='name') {
      if (!names.has(ast.name)) throw new Error(`Free name in source operator factory: ${ast.name}`);
    } else if (ast.kind==='lambda') visit(ast.body,new Set([...names,...ast.params]));
    else if (ast.kind==='block') {
      const local=new Set(names);
      for (const b of ast.bindings) { visit(b.value,local); local.add(b.name); }
      visit(ast.result,local);
    } else {
      for (const value of Object.values(ast)) {
        if (value?.kind) visit(value,names);
        else if (Array.isArray(value)) for (const item of value) {
          if (item?.kind) visit(item,names); else if (item?.value?.kind) visit(item.value,names);
        }
      }
    }
  }
  if (definition.exported || definition.params[0]!=='scalar') throw new Error('Invalid source operator factory');
  visit(definition.body,new Set(definition.params));
}
export function createSourceOperators(parse, node, tokenize) {
  let templates, pending = new Map(), serial = 0;
  const name = (value, pos) => node('name', pos, {name:value});
  const call = (callee, arg, pos) => node('call', pos, {callee,args:[arg]});
  const clone = (value, pos) => {
    if (Array.isArray(value)) return value.map(v => clone(v,pos));
    if (value instanceof Map) return new Map([...value].map(([k,v]) => [k,clone(v,pos)]));
    if (!value || typeof value !== 'object') return value;
    const fields = Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'pos' && k !== 'kind')
      .map(([k,v]) => [k,clone(v,pos)]));
    return value.kind ? node(value.kind,pos,fields) : fields;
  };
  function scalarRecord(pos) {
    const fields = numeric.map(([op,key]) => {
      const a='$scalarLeft', b='$scalarRight';
      return {name:key, value:node('lambda',pos,{params:[a,b],
        annotations:[{tag:'Num'},{tag:'Num'}],
        body:node('binary',pos,{op,left:name(a,pos),right:name(b,pos)})})};
    });
    fields.push({name:'negate',value:node('lambda',pos,{params:['$scalarValue'],annotations:[{tag:'Num'}],
      body:node('unary',pos,{op:'-',value:name('$scalarValue',pos)})})});
    return node('record',pos,{fields});
  }
  return {
    begin() { pending = new Map(); },
    value(symbol,pos,prefix=false) {
      const key=(prefix?sourcePrefixNames:sourceOperatorNames)[symbol];
      if (!key) throw new Error('Unknown default expression operator');
      if (!templates) {
        validateOperatorText(operatorSource,tokenize);
        const definitions=parse(operatorSource).definitions;
        definitions.forEach(validateClosedFactory);
        templates = new Map(definitions.map(d => [d.name,d]));
      }
      if (!pending.has(key)) {
        const d=templates.get(`operator_${key}`);
        if (!d) throw new Error(`Missing source operator factory: ${key}`);
        const factory=node('lambda',pos,{params:d.params,annotations:clone(d.annotations,pos),body:clone(d.body,pos)});
        pending.set(key,{sourceOperatorDefault:key,name:`$defaultOperator${serial++}`,value:call(factory,name('$scalarInstructions',pos),pos)});
      }
      return name(pending.get(key).name,pos);
    },
    finish(definition) {
      if (!pending.size) return definition;
      const pos=definition.pos;
      const bindings=[{sourceOperatorDefault:'$scalar',name:'$scalarInstructions',value:scalarRecord(pos)},...pending.values()];
      if (definition.body.kind==='effect') definition.body={...definition.body,
        bindings:[...bindings.map(b=>({...b,performed:false})),...definition.body.bindings]};
      else definition.body=node('block',pos,{bindings,result:definition.body});
      return definition;
    },
  };
}
