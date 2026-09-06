// Canonical surface grammar. It lowers to the existing checked core AST.
// See docs/SYNTAX.md before changing parsing or product representation.
export function createUnaryParser({ tokens, cursor, peek, at, take, eat, need, node, fail }) {
  const reserved = new Set(['fn', 'export', 'host', 'let', 'if', 'then', 'else',
    'true', 'false', 'do', 'effect', 'perform']);
  const isName = text => /^[A-Za-z_]\w*$/.test(text) && !reserved.has(text);
  const identifier = () => {
    if (!isName(peek().text)) fail(`Expected an identifier, found '${peek().text}'`, peek(), 'E_PARSE');
    return take();
  };
  const paired = new Map(), stack = [], close = { ')': '(', '}': '{', ']': '[' };
  for (let i = 0; i < tokens.length; i++) {
    const text = tokens[i].text;
    if (['(', '{', '['].includes(text)) {
      if (stack.length >= 256) fail('Delimiter nesting limit exceeded', tokens[i], 'E_LIMIT');
      stack.push(i);
    } else if (Object.hasOwn(close, text)) {
      const open = stack.pop();
      if (open !== undefined && tokens[open].text === close[text]) paired.set(open, i);
    }
  }
  let fresh = 0, depth = 0;
  function bounded(run) {
    if (++depth > 256) fail('Syntax nesting limit exceeded', peek(), 'E_LIMIT');
    try { return run(); } finally { depth--; }
  }
  const hole = () => ({ tag: 'Hole' });
  const product = (fields, tail = null) => ({ tag: 'Record', fields: new Map(fields), tail });
  const tuple = values => product(values.map((value, i) => [`_${i}`, value]));
  const rank = { '|>': 1, '||': 2, '&&': 3, '==': 4, '!=': 4,
    '<': 5, '<=': 5, '>': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7 };
  const nameNode = token => node('name', token.pos, { name: token.text });
  const call = (callee, arg, pos = callee.pos) => node('call', pos, { callee, args: [arg] });
  const separated = () => cursor() > 0 &&
    tokens[cursor() - 1].pos + tokens[cursor() - 1].text.length < peek().pos;
  const startsAtom = () => ['(', '{', 'true', 'false'].includes(peek().text) ||
    isName(peek().text) || /^(?:\d|\.\d)/.test(peek().text);
  const arrowAhead = () => isName(peek().text) ? tokens[cursor() + 1]?.text === '->' :
    ['(', '{'].includes(peek().text) && tokens[paired.get(cursor()) + 1]?.text === '->';

  function annotation() {
    return bounded(() => {
      const left = annotationAtom();
      return eat('->') ? { tag: 'Fn', args: [left], result: annotation() } : left;
    });
  }
  function annotationAtom() {
    if (eat('[')) { const element = annotation(); need(']'); return { tag: 'Stream', element }; }
    if (eat('(')) {
      if (eat(')')) return tuple([]);
      const first = annotation();
      if (!eat(',')) { need(')'); return first; }
      const elements = [first];
      while (!at(')')) { elements.push(annotation()); if (!eat(',')) break; }
      need(')'); return tuple(elements);
    }
    if (eat('{')) {
      const fields = new Map();
      if (!at('}')) do {
        const name = identifier(); need(':');
        if (fields.has(name.text)) fail('Duplicate record field', name, 'E_NAME');
        fields.set(name.text, annotation());
      } while (eat(',') && !at('}'));
      need('}'); return product(fields);
    }
    const token = take();
    if (!['Num', 'Bool', 'Text', 'Bytes'].includes(token.text))
      fail('Unknown ABI annotation', token, 'E_ANNOTATION');
    return { tag: token.text };
  }

  // A pattern supplies a shape constraint and projections from one bound value.
  function pattern(names = new Set(), path = []) {
    return bounded(() => {
      const pos = peek().pos;
      if (isName(peek().text)) {
        const name = identifier();
        if (names.has(name.text)) fail('Duplicate pattern binding', name, 'E_NAME');
        names.add(name.text);
        return { type: hole(), leaves: [{ name: name.text, path, pos }], simple: name.text };
      }
      if (eat('(')) {
        if (eat(')')) return { type: tuple([]), leaves: [] };
        // Parse at the same path first: only a comma makes this a tuple.
        const first = pattern(names, path);
        if (eat(':')) first.annotation = annotation();
        if (!eat(',')) { need(')'); return first; }
        const elements = [first];
        while (!at(')')) {
          const value = pattern(names, path);
          if (eat(':')) value.annotation = annotation();
          elements.push(value); if (!eat(',')) break;
        }
        need(')');
        return { type: tuple(elements.map(p => p.annotation ?? p.type)),
          leaves: elements.flatMap((p, i) => p.leaves.map(leaf => ({ ...leaf,
            path: [...path, `_${i}`, ...leaf.path.slice(path.length)] }))) };
      }
      if (eat('{')) {
        const fields = new Map(), leaves = [];
        if (!at('}')) do {
          const field = identifier();
          if (fields.has(field.text)) fail('Duplicate record field', field, 'E_NAME');
          let value;
          if (eat(':')) value = pattern(names, [...path, field.text]);
          else {
            if (names.has(field.text)) fail('Duplicate pattern binding', field, 'E_NAME');
            names.add(field.text);
            value = { type: hole(), leaves: [{ name: field.text, path: [...path, field.text], pos: field.pos }] };
          }
          fields.set(field.text, value.annotation ?? value.type); leaves.push(...value.leaves);
        } while (eat(',') && !at('}'));
        need('}'); return { type: product(fields, hole()), leaves };
      }
      fail('Expected a value, tuple, or record pattern before ->', peek(), 'E_PARSE');
    });
  }
  function lambda() {
    const token = peek(), p = pattern(); need('->');
    const name = p.simple ?? `$arg${fresh++}`;
    const unpack = p.simple ? [] : p.leaves.map(leaf => {
      let value = node('name', leaf.pos, { name });
      for (const field of leaf.path) value = node('field', leaf.pos, { value, name: field });
      return { name: leaf.name, value };
    });
    return node('lambda', token.pos, { params: [name], annotations: [p.annotation ?? p.type],
      unpack, boundNames: p.leaves.map(leaf => leaf.name), body: expression() });
  }
  function block(token, effect = false) {
    need('{'); const bindings = [], names = new Set();
    while (at('let') || effect && at('perform')) {
      let name = null;
      if (eat('let')) { name = identifier().text; need('='); }
      const performed = effect && Boolean(eat('perform'));
      let value = expression(); need(';');
      if (name && names.has(name)) fail('Duplicate local binding', token, 'E_NAME');
      if (name) names.add(name);
      if (performed) {
        // Host authority requires a direct saturated call, never a closure.
        const args = []; let callee = value;
        while (callee.kind === 'call') { args.unshift(...callee.args); callee = callee.callee; }
        if (args.length) value = node('call', value.pos, { callee, args });
      }
      bindings.push({ name, value, ...(effect ? { performed } : {}) });
    }
    const result = expression(); eat(';'); need('}');
    return node(effect ? 'effect' : 'block', token.pos, { bindings, result });
  }
  function prefix(minimum) {
    const token = peek();
    if (arrowAhead()) {
      if (minimum > 0) fail('Group a function argument in parentheses', token, 'E_PARSE');
      return lambda();
    }
    if (eat('-') || eat('!')) return node('unary', token.pos, { op: token.text, value: expression(8) });
    if (eat('if')) {
      const condition = expression(); need('then'); const yes = expression(); need('else');
      return node('if', token.pos, { condition, yes, no: expression() });
    }
    if (eat('do')) return block(token);
    if (eat('effect')) return block(token, true);
    if (eat('{')) {
      const fields = [], names = new Set();
      if (!at('}')) do {
        const name = identifier();
        if (names.has(name.text)) fail('Duplicate record field', name, 'E_NAME');
        names.add(name.text);
        fields.push({ name: name.text, value: eat(':') ? expression() : nameNode(name) });
      } while (eat(',') && !at('}'));
      need('}'); return node('record', token.pos, { fields });
    }
    if (eat('(')) {
      if (eat(')')) return node('record', token.pos, { fields: [] });
      const first = expression();
      if (!eat(',')) { need(')'); return first; }
      const values = [first];
      while (!at(')')) { values.push(expression()); if (!eat(',')) break; }
      need(')'); return node('record', token.pos, { fields: values.map((value, i) => ({ name: `_${i}`, value })) });
    }
    if (/^(?:\d|\.\d)/.test(token.text)) {
      take(); const value = Number(token.text);
      if (!Number.isFinite(value)) fail('Numeric literal is not finite', token, 'E_NUMBER');
      return node('number', token.pos, { value });
    }
    if (eat('true') || eat('false')) return node('boolean', token.pos, { value: token.text === 'true' });
    return nameNode(identifier());
  }
  function expression(minimum = 0) {
    return bounded(() => {
      let left = prefix(minimum);
      while (true) {
        if (eat('.')) { const field = identifier(); left = node('field', field.pos, { value: left, name: field.text }); continue; }
        if (minimum <= 9 && startsAtom() && separated()) {
          left = call(left, expression(10)); continue;
        }
        if (at('(') && !separated()) fail('Calls require whitespace: write f (value), not f(value)', peek(), 'E_PARSE');
        const precedence = rank[peek().text];
        if (precedence === undefined || precedence < minimum) break;
        const op = take();
        if (op.text === '|>') {
          let callee = expression(10);
          left = call(callee, left, op.pos);
          while (startsAtom() && separated()) left = call(left, expression(10), op.pos);
        } else left = node('binary', op.pos, { op: op.text, left, right: expression(precedence + 1) });
      }
      return left;
    });
  }
  function withBindings(bindings, body) {
    return bindings.length ? node('block', body.pos, { bindings, result: body }) : body;
  }
  function finish(ast) {
    return bounded(() => {
      switch (ast.kind) {
        case 'lambda': {
          const { unpack, boundNames, ...rest } = ast;
          return { ...rest, body: withBindings(unpack ?? [], finish(ast.body)) };
        }
        case 'block': case 'effect': return { ...ast,
          bindings: ast.bindings.map(b => ({ ...b, value: finish(b.value) })), result: finish(ast.result) };
        case 'record': return { ...ast, fields: ast.fields.map(f => ({ ...f, value: finish(f.value) })) };
        case 'field': case 'unary': return { ...ast, value: finish(ast.value) };
        case 'call': return { ...ast, callee: finish(ast.callee), args: ast.args.map(finish) };
        case 'binary': return { ...ast, left: finish(ast.left), right: finish(ast.right) };
        case 'if': return { ...ast, condition: finish(ast.condition), yes: finish(ast.yes), no: finish(ast.no) };
        default: return ast;
      }
    });
  }
  function definition(name, exported) {
    if (!isName(name.text)) fail('Reserved canonical function name', name, 'E_NAME');
    let body = expression(); need(';');
    if (body.kind !== 'lambda') fail('A canonical function must start with a pattern -> body; use () -> for constants', name, 'E_PARSE');
    const params = [], annotations = [], bindings = [], names = new Set();
    while (body.kind === 'lambda') {
      for (const bound of body.boundNames) {
        if (names.has(bound)) fail('Duplicate parameter', name, 'E_NAME');
        names.add(bound);
      }
      params.push(...body.params); annotations.push(...body.annotations); bindings.push(...body.unpack);
      body = body.body;
    }
    // Keep the effect at the top level so it cannot be mistaken for a pure block.
    if (body.kind === 'effect') body = { ...body, bindings: [...bindings.map(b => ({ ...b, performed: false })), ...body.bindings] };
    else body = withBindings(bindings, body);
    return node('definition', name.pos, { name: name.text, params, annotations,
      resultAnnotation: null, body: finish(body), exported, syntax: 'unary' });
  }
  function host(name) {
    if (!isName(name.text)) fail('Reserved canonical host name', name, 'E_NAME');
    let type = annotation(); need(';'); const annotations = [];
    while (type.tag === 'Fn') { annotations.push(...type.args); type = type.result; }
    if (!annotations.length) fail('Host signature requires input -> result', name, 'E_ANNOTATION');
    if (!['Num', 'Bool'].includes(type.tag)) fail('Host results currently must be Num or Bool', name, 'E_ABI');
    return { name: name.text, params: annotations.map((_, i) => `_arg${i}`), annotations,
      resultAnnotation: type, pos: name.pos };
  }
  return { definition, host };
}
