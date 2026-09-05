// Deliberately allocation-heavy reference semantics, independent of JTE and Wasm.
// Used ONLY in tests, never included in a compiled program.
import { parse } from '../src/frontend.mjs';
const memo = thunk => {
  let ready = false, value;
  return () => { if (!ready) { value = thunk(); ready = true; } return value; };
};
const constant = value => () => value;
const stream = items => ({ items: memo(items) });
const recordTag=Symbol('reference record');
function snapshot(value) {
  if(!value?.[recordTag])return value;
  const result={[recordTag]:true};
  for(const key of Object.keys(value))Object.defineProperty(result,key,{value:snapshot(value[key]),enumerable:true});
  return result;
}
function output(value) {
  if(value?.items)return value.items().map(x=>output(x()));
  if(value?.[recordTag])return Object.fromEntries(Object.keys(value).map(k=>[k,output(value[k])]));
  return value;
}
function input(value) {
  if(Array.isArray(value) || value instanceof Float64Array)return stream(()=>Array.from(value,x=>constant(input(x))));
  if(value && typeof value==='object' && !(value instanceof Uint8Array))return Object.assign({[recordTag]:true},Object.fromEntries(Object.entries(value).map(([k,v])=>[k,input(v)])));
  return value;
}
export function reference(source, name, args, {hosts={}}={}) {
  const definitions = new Map(parse(source).definitions.map(d => [d.name, d]));
  function builtin(name, thunks) {
    const xs = () => thunks[0]().items();
    switch (name) {
      case 'range': return stream(() => {
        const n = thunks[0]();
        if (!Number.isInteger(n) || n < 0 || n > 2147483647) throw new RangeError('Invalid range extent');
        return Array.from({ length: n }, (_, i) => constant(i));
      });
      case 'map': return stream(() => xs().map(x => memo(() => invoke(thunks[1](), [x]))));
      case 'filter': return stream(() => xs().filter(x => invoke(thunks[1](), [x])));
      case 'zip': case 'zip_checked': return stream(() => {
        const a = xs(), b = thunks[1]().items();
        if (a.length !== b.length) throw new RangeError('Mismatched extents');
        return a.map((x, i) => memo(() => invoke(thunks[2](), [x, b[i]])));
      });
      case 'sum': { let total = 0; for (const x of xs()) total += x(); return total; }
      case 'count': return xs().length;
      case 'fold': {
        let total = snapshot(thunks[1]()); const f = thunks[2]();
        for (const x of xs()) total = snapshot(invoke(f, [constant(total), x]));
        return total;
      }
      case 'scan': case 'transduce': return stream(()=>{
        let state,initialized=false;const result=[],f=thunks[2]();
        for(const x of xs()) {
          if(!initialized){state=snapshot(thunks[1]());initialized=true;}
          const transition=invoke(f,[constant(state),x]);
          if(name==='scan'){state=snapshot(transition);result.push(constant(state));}
          else {
            const next=snapshot(transition.state),emit=transition.emit;
            if(emit)result.push(constant(snapshot(transition.value)));
            state=next;
          }
        }
        return result;
      });
      case 'iterate': {
        const limit=thunks[1]();
        if(!Number.isInteger(limit)||limit<0||limit>2147483647)throw new RangeError('Invalid iteration budget');
        let state=snapshot(thunks[0]()),steps=0,done=false;const f=thunks[2]();
        while(steps<limit&&!done){const next=invoke(f,[constant(state)]);state=snapshot(next.state);done=next.done;steps++;}
        return {[recordTag]:true,state,steps,done};
      }
      case 'require': if(!thunks[0]())throw new RangeError('Contract failed');return thunks[1]();
      case 'at': {
        const items=xs(),index=thunks[1]();
        if(!Number.isInteger(index) || index<0 || index>=items.length)throw new RangeError('Index out of bounds');
        return items[index]();
      }
      case 'utf8': return new TextEncoder().encode(thunks[0]());
      case 'byte_length': return thunks[0]().length;
      case 'byte_values': return stream(()=>Array.from(thunks[0](),constant));
      case 'floor': return Math.floor(thunks[0]());
      case 'sqrt': return Math.sqrt(thunks[0]());
      case 'abs': return Math.abs(thunks[0]());
      case 'min': return Math.min(thunks[0](), thunks[1]());
      case 'max': return Math.max(thunks[0](), thunks[1]());
      default: throw new Error(`Unknown builtin ${name}`);
    }
  }
  function invoke(callee, args) {
    if (callee.builtin) return builtin(callee.builtin, args);
    const env = new Map(callee.env);
    callee.params.forEach((p, i) => env.set(p, args[i]));
    return evaluate(callee.body, env);
  }
  function evaluate(ast, env) {
    switch (ast.kind) {
      case 'record': {
        const record={[recordTag]:true};
        for(const f of ast.fields)Object.defineProperty(record,f.name,{get:memo(()=>evaluate(f.value,env)),enumerable:true});
        return record;
      }
      case 'field': return evaluate(ast.value,env)[ast.name];
      case 'effect': {
        const local=new Map(env);
        for(const b of ast.bindings) {
          if(b.performed) {
            const call=b.value,values=call.args.map(a=>output(evaluate(a,local)));
            if(!Object.hasOwn(hosts,call.callee.name))throw new Error('Reference host not provided');
            const value=hosts[call.callee.name](...values);
            if(b.name)local.set(b.name,constant(value));
          } else {const previous=new Map(local);local.set(b.name,memo(()=>evaluate(b.value,previous)));}
        }
        return evaluate(ast.result,local);
      }
      case 'number': case 'boolean': return ast.value;
      case 'name': {
        if (env.has(ast.name)) return env.get(ast.name)();
        const d = definitions.get(ast.name);
        return d ? { ...d, env: new Map() } : { builtin: ast.name };
      }
      case 'lambda': return { ...ast, env: new Map(env) };
      case 'call': return invoke(evaluate(ast.callee, env), ast.args.map(a => memo(() => evaluate(a, env))));
      case 'block': {
        const local = new Map(env);
        for (const b of ast.bindings) {
          const previous = new Map(local);
          local.set(b.name, memo(() => evaluate(b.value, previous)));
        }
        return evaluate(ast.result, local);
      }
      case 'if': return evaluate(ast.condition, env) ? evaluate(ast.yes, env) : evaluate(ast.no, env);
      case 'unary': return ast.op === '-' ? -evaluate(ast.value, env) : !evaluate(ast.value, env);
      case 'binary': {
        const a = evaluate(ast.left, env);
        if (ast.op === '&&') return a && evaluate(ast.right, env);
        if (ast.op === '||') return a || evaluate(ast.right, env);
        const b = evaluate(ast.right, env);
        switch (ast.op) {
          case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b;
          case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b;
          case '==': return a === b; case '!=': return a !== b;
        }
      }
    }
    throw new Error(`Unknown syntax ${ast.kind}`);
  }
  const d = definitions.get(name);
  return output(invoke({ ...d, env: new Map() }, args.map(a => constant(input(a)))));
}
