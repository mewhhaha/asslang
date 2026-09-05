// Deliberately allocation-heavy reference semantics, independent of JTE and Wasm.
// Used ONLY in tests, never included in a compiled program.
import { parse } from '../src/frontend.mjs';
const memo = thunk => {
  let ready = false, value;
  return () => { if (!ready) { value = thunk(); ready = true; } return value; };
};
const constant = value => () => value;
const stream = items => ({ items: memo(items) });
export function reference(source, name, args) {
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
        let total = thunks[1](); const f = thunks[2]();
        for (const x of xs()) total = invoke(f, [constant(total), x]);
        return total;
      }
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
  return invoke({ ...d, env: new Map() }, args.map(a => constant(Array.isArray(a) ? stream(() => a.map(constant)) : a)));
}
