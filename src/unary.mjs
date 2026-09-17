import { isCustomInfix, isNativeInfixFunction, createInfixScope, extendInfixScope, infixBindsInside } from './infix.mjs';
// Canonical surface grammar. It lowers to the existing checked core AST.
// See docs/SYNTAX.md before changing parsing or product representation.
export function createUnaryParser({ tokens, cursor, peek, at, take, eat, need, node, fail, readSymbolKey, sourceOperators }) {
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
  let fresh = 0, depth = 0, operatorDeclarations = 0, operatorFresh = 0, prefixBindings = 0;
  let operators = createInfixScope();
  let prefixes = new Map([['-', null], ['!', null]]);
  function bounded(run) {
    if (++depth > 256) fail('Syntax nesting limit exceeded', peek(), 'E_LIMIT');
    try { return run(); } finally { depth--; }
  }
  const hole = () => ({ tag: 'Hole' });
  const product = (fields, tail = null) => ({ tag: 'Record', fields: new Map(fields), tail });
  const tuple = values => product(values.map((value, i) => [`_${i}`, value]));

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
        const name = at('[') ? readSymbolKey() : identifier(); need(':');
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
  function pattern(names = new Set(), path = [], terminator = '->') {
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
        const first = pattern(names, path, terminator);
        if (eat(':')) {
          (first.constraints ??= []).push({ path, type: first.annotation ?? first.type, pos });
          first.annotation = annotation();
        }
        if (!eat(',')) { need(')'); return first; }
        const elements = [first];
        while (!at(')')) {
          const value = pattern(names, path, terminator);
          if (eat(':')) {
            (value.constraints ??= []).push({ path, type: value.annotation ?? value.type, pos });
            value.annotation = annotation();
          }
          elements.push(value); if (!eat(',')) break;
        }
        need(')');
        return { type: tuple(elements.map(p => p.annotation ?? p.type)),
          constraints: elements.flatMap((p, i) => (p.constraints ?? []).map(c => ({ ...c,
            path: [...path, `_${i}`, ...c.path.slice(path.length)] }))),
          leaves: elements.flatMap((p, i) => p.leaves.map(leaf => ({ ...leaf,
            path: [...path, `_${i}`, ...leaf.path.slice(path.length)] }))) };
      }
      if (eat('{')) {
        const fields = new Map(), leaves = [], constraints = [];
        if (!at('}')) do {
          const field = at('[') ? readSymbolKey() : identifier();
          if (fields.has(field.text)) fail('Duplicate record field', field, 'E_NAME');
          let value;
          if (field.symbol) { need(':'); value = pattern(names, [...path, field.text], terminator); }
          else if (eat(':')) value = pattern(names, [...path, field.text], terminator);
          else {
            if (names.has(field.text)) fail('Duplicate pattern binding', field, 'E_NAME');
            names.add(field.text);
            value = { type: hole(), leaves: [{ name: field.text, path: [...path, field.text], pos: field.pos }] };
          }
          fields.set(field.text, value.annotation ?? value.type); leaves.push(...value.leaves);
          constraints.push(...(value.constraints ?? []));
        } while (eat(',') && !at('}'));
        need('}'); return { type: product(fields, hole()), leaves, constraints };
      }
      fail(`Expected a value, tuple, or record pattern before ${terminator}`, peek(), 'E_PARSE');
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
  // A pattern is checked in an ordinary lambda, then generalized by the outer
  // let. Never put the continuation inside that lambda: it would monomorphize
  // destructured functions. Hidden names cannot be spelled by source identifiers.
  function localPattern(p, value, pos) {
    const arg = `$local${fresh++}`;
    const project = (path, at) => {
      let result = node('name', at, { name: arg });
      for (const name of path) result = node('field', at, { value: result, name });
      return result;
    };
    const checks = (p.constraints ?? []).map(c => {
      const name = `$shape${fresh++}`;
      const identity = node('lambda', c.pos, { params: [name], annotations: [c.type],
        body: node('name', c.pos, { name }) });
      return { name, value: call(identity, project(c.path, c.pos), c.pos) };
    });
    const fields = p.leaves.map(leaf => ({ name: leaf.name, value: project(leaf.path, leaf.pos) }));
    const checked = node('lambda', pos, { params: [arg], annotations: [p.annotation ?? p.type],
      body: withBindings(checks, node('record', pos, { fields })) });
    const name = `$pattern${fresh++}`;
    return [{ name, value: call(checked, value, pos) }, ...p.leaves.map(leaf => ({ name: leaf.name,
      value: node('field', leaf.pos, { value: node('name', leaf.pos, { name }), name: leaf.name }) }))];
  }
  function block(token, effect = false) {
    const outerOperators = operators, outerPrefixes = prefixes, outerPrefixBindings = prefixBindings, operatorNames = new Set(), prefixNames = new Set();
    try {
      need('{'); const bindings = [], names = new Set();
      const bind = (binding, performed = false) => bindings.push({ ...binding, ...(effect ? { performed } : {}) });
      while (at('let') || effect && at('perform') || infixDeclarationAhead() || prefixDeclarationAhead()) {
        if (prefixDeclarationAhead()) { bind(prefixDeclaration(prefixNames)); continue; }
        if (infixDeclarationAhead()) {
          const binding = infixDeclaration(operatorNames); bind(binding); continue;
        }
        let p = null, pos = peek().pos;
        if (eat('let')) { pos = peek().pos; p = pattern(new Set(), [], '='); need('='); }
        const performed = effect && Boolean(eat('perform'));
        let value = expression(); need(';');
        for (const leaf of p?.leaves ?? []) {
          if (names.has(leaf.name)) fail('Duplicate local binding', leaf, 'E_NAME');
          names.add(leaf.name);
        }
        if (performed) {
          // Keep a direct saturated host call separate from any pure unpacking.
          const args = []; let callee = value;
          while (callee.kind === 'call') { args.unshift(...callee.args); callee = callee.callee; }
          if (args.length) value = node('call', value.pos, { callee, args });
        }
        if (!p || p.simple && !p.annotation && !(p.constraints?.length)) {
          bind({ name: p?.simple ?? null, value }, performed);
        } else {
          if (performed) {
            const name = `$performed${fresh++}`;
            bind({ name, value }, true); value = node('name', pos, { name });
          }
          for (const binding of localPattern(p, value, pos)) bind(binding);
        }
      }
      const result = expression(); eat(';'); need('}');
      return node(effect ? 'effect' : 'block', token.pos, { bindings, result });
    } finally { operators = outerOperators; prefixes = outerPrefixes; prefixBindings = outerPrefixBindings; }
  }
  const infixKinds = {infixl: 'left', infixr: 'right', infix: 'none'};
  function infixDeclarationAhead() {
    const i = cursor();
    return Object.hasOwn(infixKinds, peek().text) && tokens[i+1]?.text === '('
      && tokens[i+3]?.text === ')' && ['=', 'like', 'above', 'below'].includes(tokens[i+4]?.text);
  }
  function infixDeclaration(names) {
    const kind = take(); need('('); const symbol = take(); need(')');
    if (names.has(symbol.text)) fail('Duplicate local operator binding', symbol, 'E_NAME');
    if (operators.bindings+prefixBindings>=64) fail('At most 64 active operator bindings',symbol,'E_LIMIT');
    if (++operatorDeclarations > 256) fail('At most 256 operator declarations per compilation', symbol, 'E_LIMIT');
    const relations = [];
    while (['like', 'above', 'below'].includes(peek().text)) {
      const relation = take(); need('('); const token = take(); need(')');
      const anchor = operators.symbols.get(token.text);
      if (!anchor) fail(`Unknown precedence anchor '${token.text}'`, token, 'E_OPERATOR');
      relations.push({kind: relation.text, anchor});
      if (relations.length > 64) fail('At most 64 precedence relations per declaration', relation, 'E_LIMIT');
    }
    const name = `$operator${operatorFresh++}`;
    const next = extendInfixScope(operators, symbol.text, infixKinds[kind.text], relations, name, symbol, fail);
    need('='); const value = expression(); need(';');
    // Check two curried arguments, even for unused aliases. The initializer is
    // outside its own operator scope; ordinary let-generalization stays intact.
    const checkedName = `$operatorType${operatorFresh++}`;
    const identity = node('lambda', symbol.pos, {params:[checkedName],
      annotations:[{tag:'Fn',args:[hole(),hole()],result:hole()}],
      body:node('name',symbol.pos,{name:checkedName})});
    operators = next; names.add(symbol.text);
    return {name,value:call(identity,value,symbol.pos)};
  }
  function prefixDeclarationAhead() {
    const i=cursor();
    return at('prefix') && tokens[i+1]?.text==='(' && tokens[i+3]?.text===')' && tokens[i+4]?.text==='=';
  }
  function prefixDeclaration(names) {
    take(); need('('); const symbol=take(); need(')');
    if (!['-','!'].includes(symbol.text) && !isCustomInfix(symbol.text))
      fail('Invalid or reserved prefix operator',symbol,'E_OPERATOR');
    if (names.has(symbol.text)) fail('Duplicate local prefix binding',symbol,'E_NAME');
    if (++operatorDeclarations>256 || operators.bindings+prefixBindings>=64)
      fail('Operator declaration limit exceeded',symbol,'E_LIMIT');
    need('='); const value=expression(); need(';');
    const name=`$prefixOperator${operatorFresh++}`, check=`$prefixType${operatorFresh++}`;
    const identity=node('lambda',symbol.pos,{params:[check],annotations:[{tag:'Fn',args:[hole()],result:hole()}],
      body:node('name',symbol.pos,{name:check})});
    prefixBindings++; prefixes=new Map(prefixes); prefixes.set(symbol.text,name); names.add(symbol.text);
    return {name,value:call(identity,value,symbol.pos)};
  }
  function prefixValue(token) {
    if (!prefixes.has(token.text)) fail('Unknown prefix operator',token,'E_OPERATOR');
    const binding=prefixes.get(token.text);
    return binding ? node('name',token.pos,{name:binding}) : sourceOperators.value(token.text,token.pos,true);
  }
  function infixValue(token) {
    const descriptor = operators.symbols.get(token.text);
    if (!descriptor) {
      if (prefixes.has(token.text)) return prefixValue(token);
      fail(`Unknown operator '${token.text}' in this scope`, token, 'E_OPERATOR');
    }
    return descriptor.binding ? node('name',token.pos,{name:descriptor.binding})
      : sourceOperators.value(token.text,token.pos);
  }
  function prefix(minimum) {
    const token = peek();
    if (arrowAhead()) {
      if (minimum > 0) fail('Group a function argument in parentheses', token, 'E_PARSE');
      return lambda();
    }
    if (prefixes.has(token.text)) { take(); return call(prefixValue(token),expression(8),token.pos); }
    if (eat('if')) {
      const condition = expression(); need('then'); const yes = expression(); need('else');
      return node('if', token.pos, { condition, yes, no: expression() });
    }
    if (eat('do')) return block(token);
    if (eat('effect')) return block(token, true);
    if (eat('{')) {
      // Contextual `with` cannot reinterpret a valid record constructor. A base
      // is one name or a grouped expression; use the existing delimiter index.
      let base = null;
      if (isName(peek().text) && tokens[cursor()+1]?.text === 'with') {
        base = nameNode(take()); take();
      } else if (at('(') && tokens[paired.get(cursor())+1]?.text === 'with') {
        base = prefix(10); need('with');
      }
      if (base && at('}')) fail('A record update needs at least one field', peek(), 'E_PARSE');
      const fields = [], names = new Set();
      if (!at('}')) do {
        const name = at('[') ? readSymbolKey() : identifier();
        if (names.has(name.text)) fail('Duplicate record field', name, 'E_NAME');
        names.add(name.text);
        fields.push({ name: name.text, ...(base ? {pos: name.pos} : {}),
          value: name.symbol ? (need(':'), expression()) : eat(':') ? expression() : nameNode(name) });
      } while (eat(',') && !at('}'));
      need('}'); return base ? node('record_update', token.pos, {base, fields}) : node('record', token.pos, { fields });
    }
    if (eat('(')) {
      if (at('prefix') && tokens[cursor()+1]?.text==='(') {
        take(); need('('); const token=take(); need(')'); need(')'); return prefixValue(token);
      }
      if ((operators.symbols.has(peek().text) || prefixes.has(peek().text) || isCustomInfix(peek().text)) && tokens[cursor()+1]?.text === ')') {
        const operator = take(); need(')'); return infixValue(operator);
      }
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
    if (isCustomInfix(token.text)) fail(`Unknown prefix operator '${token.text}'`,token,'E_OPERATOR');
    return nameNode(identifier());
  }
  function expression(minimum = 0, parent = null) {
    return bounded(() => {
      let left = prefix(parent ? 1 : minimum);
      while (true) {
        if (eat('.')) { const field = identifier(); left = node('field', field.pos, { value: left, name: field.text }); continue; }
        if (at('[')) { const field = readSymbolKey(); left = node('field', field.pos, { value: left, name: field.text }); continue; }
        if (minimum <= 9 && startsAtom() && separated()) {
          left = call(left, expression(10)); continue;
        }
        if (at('(') && !separated()) fail('Calls require whitespace: write f (value), not f(value)', peek(), 'E_PARSE');
        const descriptor = operators.symbols.get(peek().text);
        if (!descriptor) {
          if (isCustomInfix(peek().text)) fail(`Unknown operator '${peek().text}' in this scope`, peek(), 'E_OPERATOR');
          break;
        }
        // Unary and application are fixed stronger boundaries. Relational
        // precedence is used only for ordinary binary operands below them.
        if (minimum >= 8) break;
        if (parent && !infixBindsInside(operators, descriptor, parent, peek(), fail)) break;
        const op = take();
        if (op.text === '|>') {
          let callee = expression(10);
          left = call(call(infixValue(op),left,op.pos),callee,op.pos);
          while (startsAtom() && separated()) left = call(left, expression(10), op.pos);
        } else {
          const right = expression(0, descriptor);
          left = node('call',op.pos,{callee:infixValue(op),args:[left,right]});
        }
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
        case 'record_update': return { ...ast, base: finish(ast.base), fields: ast.fields.map(f => ({ ...f, value: finish(f.value) })) };
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
