import { fail, prune } from './frontend.mjs';

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
        arity(0); fact = { domain: step.id, dense: true }; break;
      case 'map':
        arity(1); fact = { ...parents[0] }; break;
      case 'filter':
        arity(1); fact = { domain: step.id, dense: false }; break;
      case 'zip':
        arity(2);
        if (parents[0].domain !== parents[1].domain) throw new Error('JTE: unmatched iteration domains');
        fact = { ...parents[0] }; break;
      case 'zip_checked':
        arity(2);
        if (!parents.every(p => p.dense)) throw new Error('JTE: checked zip needs dense streams');
        if (step.obligation !== 'equal-extent-before-iteration') throw new Error('JTE: missing dynamic obligation');
        fact = { domain: step.id, dense: true }; break;
      case 'reduce':
        arity(1); fact = { domain: null, dense: false }; break;
      default: throw new Error(`JTE: unknown rule ${step.rule}`);
    }
    if (step.domain !== fact.domain || step.dense !== fact.dense) throw new Error('JTE: forged observation');
    facts.push(fact);
  }
  return true;
}

export function stage(program, inferred, { maxExpansion = 100_000 } = {}) {
  const definitions = new Map(program.definitions.map(d => [d.name, d]));
  const steps = [], kernels = [], nodes = [], intern = new Map();
  let work = 0, staticZips = 0, checkedZips = 0;
  function scalar(op, type, args = [], data = undefined, unique = false) {
    const key = `${op}:${type}:${args.map(n => n.id).join(',')}:${
      Object.is(data, -0) ? '-0' : JSON.stringify(data)}`;
    if (!unique && intern.has(key)) return intern.get(key);
    const value = { kind: 'scalar', id: nodes.length, op, type, args, data };
    nodes.push(value);
    if (!unique) intern.set(key, value);
    return value;
  }
  const num = value => scalar('const', 'Num', [], value);
  const boolean = value => scalar('const', 'Bool', [], value ? 1 : 0);
  function record(rule, parents = [], extra = {}) {
    const id = steps.length, pp = parents.map(p => steps[p.proof]);
    const domain = rule === 'reduce' ? null : ['map', 'zip'].includes(rule) ? pp[0].domain : id;
    const dense = ['source', 'zip_checked'].includes(rule) || ['map', 'zip'].includes(rule) && pp[0].dense;
    const step = { id, rule, parents: parents.map(p => p.proof), domain, dense: Boolean(dense), ...extra };
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
  function source(extent, item, index, name) {
    const proof = record('source', [], { name });
    return { kind: 'stream', proof, extent, item, indices: [index], mask: null, guards: [] };
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
    if (['sqrt', 'abs', 'min', 'max'].includes(name)) {
      return scalar(name, 'Num', args.map(v => requireScalar(v, at)));
    }
    const input = requireStream(args[0], at);
    if (name === 'map') {
      const item = requireScalar(invoke(args[1], [input.item], at), at);
      return { ...input, item, proof: record('map', [input]) };
    }
    if (name === 'filter') {
      const condition = requireScalar(invoke(args[1], [input.item], at), at);
      const mask = input.mask ? scalar('&&', 'Bool', [input.mask, condition]) : condition;
      return { ...input, mask, proof: record('filter', [input]) };
    }
    if (name === 'zip' || name === 'zip_checked') {
      const other = requireStream(args[1], at);
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
      const item = requireScalar(invoke(args[2], [input.item, other.item], at), at);
      const proof = record(name, [input, other], name === 'zip_checked' ? { obligation: 'equal-extent-before-iteration' } : {});
      return { ...input, item, proof, guards, indices: union(input.indices, other.indices) };
    }
    if (['sum', 'count', 'fold'].includes(name)) {
      const initial = name === 'fold' ? requireScalar(args[1], at) : num(0);
      const acc = scalar('acc', initial.type, [], null, true);
      const body = name === 'fold' ? requireScalar(invoke(args[2], [acc, input.item], at), at) :
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
        const yes = requireScalar(expression(ast.yes, env), ast), no = requireScalar(expression(ast.no, env), ast);
        return scalar('if', yes.type, [condition, yes, no]);
      }
      default: fail(`Unsupported syntax ${ast.kind}`, ast, 'E_LOWER');
    }
  }
  for (const d of program.definitions.filter(d => d.exported)) {
    const type = prune(inferred.schemes.get(d.name).type), env = new Map();
    const parameters = [], abi = [];
    for (let i = 0; i < d.params.length; i++) {
      const t = prune(type.args[i]), name = d.params[i];
      if (t.tag === 'Num' || t.tag === 'Bool') {
        env.set(name, scalar('wire', t.tag, [], { kernel: d.name, index: abi.length }));
        parameters.push({ name, type: t.tag, slots: [abi.length] }); abi.push(t.tag);
      } else if (t.tag === 'Stream' && prune(t.element).tag === 'Num') {
        const pointer = scalar('wire', 'I32', [], { kernel: d.name, index: abi.length });
        const extent = scalar('wire', 'I32', [], { kernel: d.name, index: abi.length + 1 });
        const index = scalar('index', 'I32', [], null, true);
        const input = source(extent, scalar('load', 'Num', [pointer, index]), index, name);
        parameters.push({ name, type: '[Num]', slots: [abi.length, abi.length + 1] });
        abi.push('I32', 'I32'); env.set(name, input);
      } else {
        fail(`Export '${d.name}' needs concrete Num, Bool, or [Num] parameters; '${name}' has no supported concrete ABI. Annotate unresolved parameters with Num, Bool, or [Num]`, d, 'E_ABI');
      }
    }
    const resultType = prune(type.result).tag;
    if (!['Num', 'Bool'].includes(resultType)) fail('Exports must return Num or Bool; escaping streams/closures are not implemented', d, 'E_ABI');
    const result = requireScalar(expression(d.body, env), d);
    kernels.push({ name: d.name, parameters, abi, resultType, result });
  }
  if (!kernels.length) fail('At least one export fn is required', null, 'E_ABI');
  verifyCertificate(steps);
  return { kernels, certificate: { version: 'jte-0', steps }, nodes: nodes.length, work, staticZips, checkedZips };
}
