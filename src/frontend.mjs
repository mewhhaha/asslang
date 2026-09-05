// The front end is deliberately independent of WebAssembly and the JTE ledger.
export class CompileError extends Error {
  constructor(message, offset = 0, code = 'E_COMPILE') {
    super(message);
    this.name = 'CompileError';
    this.offset = offset;
    this.code = code;
  }
  format(source) {
    const before = source.slice(0, this.offset).split('\n');
    return `${this.code} at ${before.length}:${before.at(-1).length + 1}: ${this.message}`;
  }
}
export const fail = (message, node, code) => {
  throw new CompileError(message, node?.pos ?? 0, code);
};

export function tokenize(source) {
  if (typeof source !== 'string') throw new TypeError('Source must be a string');
  if (source.length > 1_000_000) fail('Source limit is 1,000,000 characters', null, 'E_LIMIT');
  const tokens = [];
  const pattern = /\s+|\/\/[^\n]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|\|>|=>|==|!=|<=|>=|&&|\|\||[(){}\[\]:;,=+*/<>!\-]/y;
  let pos = 0;
  while (pos < source.length) {
    pattern.lastIndex = pos;
    const match = pattern.exec(source);
    if (!match) fail(`Unexpected character ${JSON.stringify(source[pos])}`, { pos }, 'E_LEX');
    const text = match[0];
    if (!/^\s|^\/\//.test(text)) tokens.push({ text, pos });
    pos = pattern.lastIndex;
  }
  tokens.push({ text: '<eof>', pos: source.length });
  return tokens;
}

export function parse(source) {
  const tokens = tokenize(source);
  let cursor = 0, nodes = 0;
  const peek = () => tokens[cursor];
  const at = text => peek().text === text;
  const take = () => tokens[cursor++];
  const eat = text => at(text) ? take() : null;
  const need = text => {
    if (!at(text)) fail(`Expected '${text}', found '${peek().text}'`, peek(), 'E_PARSE');
    return take();
  };
  const reserved = new Set(['fn', 'export', 'let', 'if', 'then', 'else', 'true', 'false']);
  const identifier = () => {
    if (!/^[A-Za-z_]\w*$/.test(peek().text) || reserved.has(peek().text)) {
      fail(`Expected an identifier, found '${peek().text}'`, peek(), 'E_PARSE');
    }
    return take();
  };
  const node = (kind, pos, rest = {}) => {
    if (++nodes > 50_000) fail('Syntax node limit exceeded', { pos }, 'E_LIMIT');
    return { kind, pos, ...rest };
  };
  const precedence = { '|>': 1, '||': 2, '&&': 3, '==': 4, '!=': 4,
    '<': 5, '<=': 5, '>': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7 };
  function annotation() {
    if (eat('[')) { const element = annotation(); need(']'); return { tag: 'Stream', element }; }
    const token = take();
    if (!['Num', 'Bool'].includes(token.text)) fail('Annotation must be Num, Bool, or [element]', token, 'E_ANNOTATION');
    return { tag: token.text };
  }
  function params(annotated = false) {
    need('(');
    const names = [], annotations = [];
    if (!at(')')) do {
      names.push(identifier().text);
      annotations.push(annotated && eat(':') ? annotation() : null);
    } while (eat(','));
    need(')');
    if (new Set(names).size !== names.length) fail('Duplicate parameter', peek(), 'E_NAME');
    return { names, annotations };
  }
  function lambdaAhead() {
    if (at('(')) {
      let j = cursor + 1;
      if (tokens[j].text === ')') return tokens[j + 1]?.text === '=>';
      while (/^[A-Za-z_]\w*$/.test(tokens[j]?.text ?? '')) {
        j++;
        if (tokens[j].text === ')') return tokens[j + 1]?.text === '=>';
        if (tokens[j++].text !== ',') break;
      }
    }
    return false;
  }
  function prefix() {
    const t = peek();
    if (eat('-') || eat('!')) return node('unary', t.pos, { op: t.text, value: expression(8) });
    if (eat('if')) {
      const condition = expression(); need('then');
      const yes = expression(); need('else');
      return node('if', t.pos, { condition, yes, no: expression() });
    }
    if (eat('{')) {
      const bindings = [];
      while (eat('let')) {
        const name = identifier(); need('=');
        const value = expression(); need(';');
        if (bindings.some(b => b.name === name.text)) fail('Duplicate local binding', name, 'E_NAME');
        bindings.push({ name: name.text, value });
      }
      const result = expression(); eat(';'); need('}');
      return node('block', t.pos, { bindings, result });
    }
    if (lambdaAhead()) {
      const { names } = params(); need('=>');
      return node('lambda', t.pos, { params: names, body: expression() });
    }
    if (/^[A-Za-z_]\w*$/.test(t.text) && tokens[cursor + 1]?.text === '=>') {
      const name = identifier(); need('=>');
      return node('lambda', t.pos, { params: [name.text], body: expression() });
    }
    if (eat('(')) { const value = expression(); need(')'); return value; }
    if (/^(?:\d|\.\d)/.test(t.text)) {
      take(); const value = Number(t.text);
      if (!Number.isFinite(value)) fail('Numeric literal is not finite', t, 'E_NUMBER');
      return node('number', t.pos, { value });
    }
    if (eat('true') || eat('false')) return node('boolean', t.pos, { value: t.text === 'true' });
    const name = identifier();
    return node('name', name.pos, { name: name.text });
  }
  function argumentsList() {
    need('('); const args = [];
    if (!at(')')) do { args.push(expression()); } while (eat(','));
    need(')'); return args;
  }
  function expression(minimum = 0) {
    let left = prefix();
    while (true) {
      if (at('(')) {
        left = node('call', left.pos, { callee: left, args: argumentsList() }); continue;
      }
      const rank = precedence[peek().text];
      if (rank === undefined || rank < minimum) break;
      const op = take();
      if (op.text === '|>') {
        const name = identifier();
        const callee = node('name', name.pos, { name: name.text });
        const args = at('(') ? argumentsList() : [];
        left = node('call', op.pos, { callee, args: [left, ...args] });
      } else {
        left = node('binary', op.pos, { op: op.text, left, right: expression(rank + 1) });
      }
    }
    return left;
  }
  const definitions = [];
  while (!at('<eof>')) {
    const exported = Boolean(eat('export')); need('fn');
    const name = identifier(); const { names, annotations } = params(true);
    const resultAnnotation = eat(':') ? annotation() : null; need('=');
    const body = expression(); need(';');
    if (definitions.some(d => d.name === name.text)) fail(`Duplicate function '${name.text}'`, name, 'E_NAME');
    definitions.push(node('definition', name.pos, { name: name.text, params: names, annotations, resultAnnotation, body, exported }));
  }
  if (!definitions.length) fail('Program contains no functions', null, 'E_PARSE');
  return { definitions, nodeCount: nodes };
}

const Num = { tag: 'Num' }, Bool = { tag: 'Bool' };
const stream = element => ({ tag: 'Stream', element });
const fn = (args, result) => ({ tag: 'Fn', args, result });
export function prune(t) {
  if (t.tag === 'Var' && t.link) { t.link = prune(t.link); return t.link; }
  return t;
}
const children = t => t.tag === 'Fn' ? [...t.args, t.result] : t.tag === 'Stream' ? [t.element] : [];
function free(t, out = new Set()) {
  t = prune(t);
  if (t.tag === 'Var') out.add(t);
  else for (const x of children(t)) free(x, out);
  return out;
}
export function showType(type) {
  const names = new Map();
  function show(t) {
    t = prune(t);
    if (t.tag === 'Var') {
      if (!names.has(t)) names.set(t, `'${String.fromCharCode(97 + names.size % 26)}${names.size >= 26 ? Math.floor(names.size / 26) : ''}`);
      return names.get(t);
    }
    if (t.tag === 'Stream') return `[${show(t.element)}]`;
    if (t.tag === 'Fn') return `(${t.args.map(show).join(', ')}) -> ${show(t.result)}`;
    return t.tag;
  }
  return show(type);
}

export const builtinNames = ['range', 'map', 'filter', 'zip', 'zip_checked', 'sum', 'count', 'fold', 'sqrt', 'abs', 'min', 'max'];
export function infer(program) {
  let next = 0, constraints = 0;
  const variable = () => ({ tag: 'Var', id: next++ });
  const schemes = new Map(), active = new Set();
  const definitions = new Map(program.definitions.map(d => [d.name, d]));
  const occurs = (v, t) => free(t).has(v);
  function unify(a, b, ast) {
    constraints++;
    a = prune(a); b = prune(b);
    if (a === b) return;
    if (a.tag === 'Var') {
      if (occurs(a, b)) fail('Infinite type: a value would contain its own type', ast, 'E_OCCURS');
      a.link = b; return;
    }
    if (b.tag === 'Var') return unify(b, a, ast);
    if (a.tag !== b.tag || a.tag === 'Fn' && a.args.length !== b.args.length) {
      fail(`Cannot unify ${showType(a)} with ${showType(b)}`, ast, 'E_TYPE');
    }
    const aa = children(a), bb = children(b);
    aa.forEach((t, i) => unify(t, bb[i], ast));
  }
  function generalize(type, env) {
    const vars = free(type);
    for (const s of env.values()) for (const v of free(s.type)) if (!s.vars.has(v)) vars.delete(v);
    return { type, vars };
  }
  function instantiate(s) {
    const substitution = new Map([...s.vars].map(v => [v, variable()]));
    function copy(t) {
      t = prune(t);
      if (t.tag === 'Var') return substitution.get(t) ?? t;
      if (t.tag === 'Stream') return stream(copy(t.element));
      if (t.tag === 'Fn') return fn(t.args.map(copy), copy(t.result));
      return t;
    }
    return copy(s.type);
  }
  const builtin = name => {
    const a = variable(), b = variable(), c = variable();
    switch (name) {
      case 'range': return fn([Num], stream(Num));
      case 'map': return fn([stream(a), fn([a], b)], stream(b));
      case 'filter': return fn([stream(a), fn([a], Bool)], stream(a));
      case 'zip': case 'zip_checked': return fn([stream(a), stream(b), fn([a, b], c)], stream(c));
      case 'sum': return fn([stream(Num)], Num);
      case 'count': return fn([stream(a)], Num);
      case 'fold': return fn([stream(a), b, fn([b, a], b)], b);
      case 'sqrt': case 'abs': return fn([Num], Num);
      case 'min': case 'max': return fn([Num, Num], Num);
      default: return null;
    }
  };
  function definition(name, at) {
    if (schemes.has(name)) return schemes.get(name);
    if (active.has(name)) fail(`Recursion through '${name}' is not supported in the kernel prototype`, at, 'E_RECURSION');
    const d = definitions.get(name);
    if (!d) fail(`Unknown name '${name}'`, at, 'E_NAME');
    active.add(name);
    const env = new Map(), args = d.params.map(() => variable());
    d.params.forEach((p, i) => env.set(p, { type: args[i], vars: new Set() }));
    d.annotations.forEach((annotation, i) => { if (annotation) unify(args[i], annotation, d); });
    const result = expression(d.body, env);
    if (d.resultAnnotation) unify(result, d.resultAnnotation, d);
    const scheme = generalize(fn(args, result), new Map());
    schemes.set(name, scheme); active.delete(name);
    return scheme;
  }
  function expression(ast, env) {
    let type;
    switch (ast.kind) {
      case 'number': type = Num; break;
      case 'boolean': type = Bool; break;
      case 'name': type = env.has(ast.name) ? instantiate(env.get(ast.name)) :
        builtin(ast.name) ?? instantiate(definition(ast.name, ast)); break;
      case 'lambda': {
        const local = new Map(env), args = ast.params.map(() => variable());
        ast.params.forEach((p, i) => local.set(p, { type: args[i], vars: new Set() }));
        type = fn(args, expression(ast.body, local)); break;
      }
      case 'call': {
        const callee = expression(ast.callee, env);
        const args = ast.args.map(x => expression(x, env)); type = variable();
        unify(callee, fn(args, type), ast); break;
      }
      case 'block': {
        const local = new Map(env);
        for (const b of ast.bindings) local.set(b.name, generalize(expression(b.value, local), local));
        type = expression(ast.result, local); break;
      }
      case 'unary':
        type = ast.op === '-' ? Num : Bool;
        unify(expression(ast.value, env), type, ast); break;
      case 'binary': {
        const left = expression(ast.left, env), right = expression(ast.right, env);
        if (['&&', '||'].includes(ast.op)) {
          unify(left, Bool, ast); unify(right, Bool, ast); type = Bool;
        } else if (['==', '!='].includes(ast.op)) {
          unify(left, Num, ast); unify(right, Num, ast); type = Bool;
        } else {
          unify(left, Num, ast); unify(right, Num, ast);
          type = ['<', '<=', '>', '>='].includes(ast.op) ? Bool : Num;
        }
        break;
      }
      case 'if':
        unify(expression(ast.condition, env), Bool, ast);
        type = expression(ast.yes, env); unify(type, expression(ast.no, env), ast); break;
      default: fail(`Unknown syntax ${ast.kind}`, ast);
    }
    return type;
  }
  for (const d of program.definitions) {
    if (builtinNames.includes(d.name) || d.name === 'memory') fail(`Reserved function name '${d.name}'`, d, 'E_NAME');
  }
  for (const d of program.definitions) definition(d.name, d);
  return { schemes, constraints, variables: next, signatures: Object.fromEntries([...schemes].map(([k, s]) => [k, showType(s.type)])) };
}
