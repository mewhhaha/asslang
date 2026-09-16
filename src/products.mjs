import { isSymbolKey } from './record-keys.mjs';

// Shape metadata exists only in the compiler. Values remain ordinary scalar DAGs.
export const PRODUCT_LIMITS = Object.freeze({ leaves: 128, depth: 16, nodes: 4096 });
export const productArities = Object.freeze({ product_map: 2, product_zip: 3, product_fold: 3 });

// Source tuples are structural records. Only a complete positional record gets
// numeric ordering; named/mixed records have a stable field-name order.
export function productFields(fields) {
  const n = fields.size;
  if (n && Array.from({ length: n }, (_, i) => fields.has(`_${i}`)).every(Boolean))
    return Array.from({ length: n }, (_, i) => [`_${i}`, fields.get(`_${i}`)]);
  return [...fields].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

export function inferProduct(name, { a, b, Num, fn, constrainProduct }, at) {
  if (!Object.hasOwn(productArities, name)) return null;
  constrainProduct(a, at);
  if (name === 'product_map') return fn([a, fn([Num], Num)], a);
  if (name === 'product_zip') return fn([a, a, fn([Num, Num], Num)], a);
  return fn([a, b, fn([b, Num], b)], b);
}

// A representation predicate, independent of the HM function skeleton. Propagate
// it into fields and open tails so it survives helpers that return only scalars.
export function createProductConstraints({ prune, fail, row }) {
  const constraints = new Map();
  function track(type, at, seen = new Set()) {
    type = prune(type);
    if (seen.has(type)) return;
    seen.add(type);
    if (!constraints.has(type)) constraints.set(type, at);
    if (type.tag === 'Record') {
      for (const value of type.fields.values()) track(value, at, seen);
      if (type.tail) track(type.tail, at, seen);
    }
  }
  function inherit(from, to, at) {
    from = prune(from);
    if (constraints.has(from)) track(to, at ?? constraints.get(from));
  }
  function validateAll() {
    for (const [type, at] of constraints) {
      const budget = { leaves: 0, nodes: 0 };
      function visit(type, depth) {
        type = prune(type);
        if (++budget.nodes > PRODUCT_LIMITS.nodes)
          fail('Numeric product exceeds 4096 shape nodes', at, 'E_LIMIT');
        if (type.tag === 'Var') return; // Generic, not a guessed scalar shape.
        if (type.tag === 'Num') {
          if (++budget.leaves > PRODUCT_LIMITS.leaves)
            fail('Numeric product exceeds 128 numeric leaves', at, 'E_LIMIT');
          return;
        }
        if (type.tag !== 'Record')
          fail(`Product operations require Num leaves, not ${type.tag}`, at, 'E_TYPE');
        if (depth >= PRODUCT_LIMITS.depth)
          fail('Numeric product exceeds 16 record levels', at, 'E_LIMIT');
        const { fields } = row(type);
        for (const [key, value] of fields) {
          if (isSymbolKey(key)) fail('Product operations do not traverse symbol fields', at, 'E_TYPE');
          visit(value, depth + 1);
        }
      }
      visit(type, 0);
    }
  }
  return { track, inherit, validateAll };
}

export function stageProduct(name, args, api, at) {
  const { fail, invoke } = api;
  function inspect(value) {
    const budget = { leaves: 0, nodes: 0 };
    function visit(value, depth) {
      if (++budget.nodes > PRODUCT_LIMITS.nodes)
        fail('Numeric product exceeds 4096 shape nodes', at, 'E_LIMIT');
      if (value.kind === 'scalar' && value.type === 'Num') {
        if (++budget.leaves > PRODUCT_LIMITS.leaves)
          fail('Numeric product exceeds 128 numeric leaves', at, 'E_LIMIT');
        return { value };
      }
      if (value.kind !== 'record')
        fail('Product operations require scalar Num or numeric records', at, 'E_TYPE');
      if (depth >= PRODUCT_LIMITS.depth)
        fail('Numeric product exceeds 16 record levels', at, 'E_LIMIT');
      const fields = productFields(value.fields).map(([key, value]) => {
        if (isSymbolKey(key)) fail('Product operations do not traverse symbol fields', at, 'E_TYPE');
        return [key, visit(value, depth + 1)];
      });
      return { fields };
    }
    return visit(value, 0);
  }
  const left = inspect(args[0]);
  const right = name === 'product_zip' ? inspect(args[1]) : null;
  function checkPair(a, b) {
    if (Boolean(a.fields) !== Boolean(b.fields) || a.fields &&
        (a.fields.length !== b.fields.length || a.fields.some(([key], i) => key !== b.fields[i][0])))
      fail('product_zip requires exactly matching product shapes', at, 'E_TYPE');
    if (a.fields) a.fields.forEach(([, value], i) => checkPair(value, b.fields[i][1]));
  }
  if (right) checkPair(left, right); // Validate the entire pair before callbacks.
  function numeric(value) {
    if (value.kind !== 'scalar' || value.type !== 'Num')
      fail('Product map/zip callbacks must return Num', at, 'E_TYPE');
    return value;
  }
  function map(a, b) {
    if (a.fields) return { kind: 'record', fields: new Map(a.fields.map(([key, value], i) =>
      [key, map(value, b?.fields[i][1])])) };
    return numeric(invoke(args[name === 'product_map' ? 1 : 2], b ? [a.value, b.value] : [a.value], at));
  }
  if (name !== 'product_fold') return map(left, right);
  let result = args[1];
  function fold(tree) {
    if (tree.fields) tree.fields.forEach(([, value]) => fold(value));
    else result = invoke(args[2], [result, tree.value], at);
  }
  fold(left);
  return result;
}
