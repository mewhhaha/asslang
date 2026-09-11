// Internal read-only analysis of an authenticated evidence session. Negative
// Boolean nodes stay in this ephemeral workspace, never in the public algebra.
// See docs/EVIDENCE-TRANSPORT.md for the lifting/implication equivalence.
function workspace(source, { maxNodes, maxWork }) {
  const nodes = [null, null], unique = new Map(), applications = new Map(), negatives = new Map();
  const copies = [new Map(), new Map()];
  let work = 0;
  function tick() {
    if (++work > maxWork) throw new RangeError('Evidence transport work limit exceeded');
  }
  function mk(variable, low, high) {
    tick();
    if (low === high) return low;
    const key = `${variable}:${low}:${high}`;
    if (unique.has(key)) return unique.get(key);
    if (nodes.length >= maxNodes) throw new RangeError('Evidence transport workspace node limit exceeded');
    const id = nodes.length;
    nodes.push({ variable, low, high }); unique.set(key, id); return id;
  }
  // Current private variables are even, future private variables are odd. The
  // same order also works for lifting, which only uses the even copy.
  function copy(id, side = 0) {
    tick();
    if (id < 2) return id;
    const memo = copies[side];
    if (memo.has(id)) return memo.get(id);
    const n = source.nodes[id], result = mk(2 * n.variable + side, copy(n.low, side), copy(n.high, side));
    memo.set(id, result); return result;
  }
  function apply(op, a, b) {
    tick();
    if (a > b) [a, b] = [b, a];
    if (a === b) return a;
    if (op === 'and') { if (a === 0) return 0; if (a === 1) return b; }
    else { if (a === 0) return b; if (a === 1) return 1; }
    const key = `${op}:${a}:${b}`;
    if (applications.has(key)) return applications.get(key);
    const an = nodes[a], bn = nodes[b], v = Math.min(an.variable, bn.variable);
    const result = mk(v,
      apply(op, an.variable === v ? an.low : a, bn.variable === v ? bn.low : b),
      apply(op, an.variable === v ? an.high : a, bn.variable === v ? bn.high : b));
    applications.set(key, result); return result;
  }
  function not(id) {
    tick();
    if (id < 2) return 1 - id;
    if (negatives.has(id)) return negatives.get(id);
    const n = nodes[id], result = mk(n.variable, not(n.low), not(n.high));
    negatives.set(id, result); negatives.set(result, id); return result;
  }
  function evaluate(id, facts) {
    while (id > 1) { tick(); const n = nodes[id]; id = facts.has(n.variable) ? n.high : n.low; }
    return id === 1;
  }
  function assignment(id) {
    if (!id) throw new Error('Evidence transport bug: no satisfying assignment');
    const facts = new Set();
    while (id > 1) {
      tick(); const n = nodes[id];
      if (n.low) id = n.low;
      else { facts.add(n.variable); id = n.high; }
    }
    return facts;
  }
  return { nodes, tick, mk, copy, apply, not, evaluate, assignment };
}

export function auditEvidenceTransport(source, bindings, limits) {
  const w = workspace(source, limits), { nodes, tick, mk, copy, apply, not, evaluate } = w;
  const now = bindings.map(b => copy(b.root)), future = bindings.map(b => copy(b.root, 1));
  const lastUse = new Int16Array(source.atoms.length).fill(-1);
  for (let j = 0; j < future.length; j++) {
    const seen = new Set(), stack = [future[j]];
    while (stack.length) {
      tick(); const id = stack.pop();
      if (id < 2 || seen.has(id)) continue;
      seen.add(id); const n = nodes[id]; lastUse[(n.variable - 1) / 2] = j;
      stack.push(n.low, n.high);
    }
  }
  // Ext is s subset u. Irrelevant private variables can keep their current value
  // and need not occur in this relation. Build bottom-up without quadratic apply.
  let extension = 1;
  for (let i = lastUse.length - 1; i >= 0; i--) if (lastUse[i] >= 0)
    extension = mk(2 * i, extension, mk(2 * i + 1, 0, extension));
  const factors = future.map((id, j) => apply('or', not(id), now[j]));
  const products = new Map();
  // Relational product: conjoin, then existentially forget future variables
  // absent from every remaining factor. Current variables are NEVER forgotten.
  function product(a, b, position) {
    tick();
    if (!a || !b) return 0;
    if (a === 1 && b === 1) return 1;
    if (a > b) [a, b] = [b, a];
    const key = `${position}:${a}:${b}`;
    if (products.has(key)) return products.get(key);
    const av = a < 2 ? Infinity : nodes[a].variable, bv = b < 2 ? Infinity : nodes[b].variable;
    const v = Math.min(av, bv);
    const low = product(av === v ? nodes[a].low : a, bv === v ? nodes[b].low : b, position);
    const high = product(av === v ? nodes[a].high : a, bv === v ? nodes[b].high : b, position);
    const forget = v % 2 === 1 && lastUse[(v - 1) / 2] < position;
    const result = forget ? apply('or', low, high) : mk(v, low, high);
    products.set(key, result); return result;
  }
  for (let e = 0; e < bindings.length; e++) {
    let relation = extension;
    for (let j = 0; j < bindings.length; j++)
      relation = product(relation, j === e ? future[j] : factors[j], j + 1);
    if (relation === 1) continue;
    const current = w.assignment(not(relation));
    if ([...current].some(i => i % 2)) throw new Error('Evidence transport bug: unquantified future variable');
    const view = bindings.flatMap((b, j) => evaluate(now[j], current) ? [b.atom] : []);
    if (view.includes(bindings[e].atom)) throw new Error('Evidence transport bug: missing already available extension');
    const requested = bindings.filter(b => view.includes(b.atom) || b.atom === bindings[e].atom).map(b => b.atom);
    // Independently form the exact fiber at this concrete witness. This guards
    // against mistakes in symbolic relational-product/early-elimination code.
    let fiber = 1;
    for (const v of [...current].sort((a, b) => b - a)) fiber = mk(v, 0, fiber);
    for (let j = 0; j < bindings.length; j++)
      fiber = apply('and', fiber, requested.includes(bindings[j].atom) ? now[j] : not(now[j]));
    if (fiber !== 0) throw new Error('Evidence transport bug: reported extension has a lift');
    return { schemaVersion: 1, preservesImplication: false, obstruction: {
      current: source.atoms.filter((_, i) => current.has(2 * i)), view, requested,
    } };
  }
  return { schemaVersion: 1, preservesImplication: true, obstruction: null };
}

export function liftEvidenceTransport(source, bindings, current, requested, prices, limits) {
  const w = workspace(source, limits), { nodes, tick, mk, copy, apply, not, evaluate } = w;
  const roots = bindings.map(b => copy(b.root)), currentVars = new Set([...current].map(i => 2 * i));
  for (let j = 0; j < roots.length; j++)
    if (evaluate(roots[j], currentVars) && !requested.has(j))
      throw new TypeError('Requested view cannot drop a currently true public summary');
  let constraint = 1;
  for (const v of [...currentVars].sort((a, b) => b - a)) constraint = mk(v, 0, constraint);
  for (let j = 0; j < roots.length; j++) constraint = apply('and', constraint, requested.has(j) ? roots[j] : not(roots[j]));
  const memo = new Map([[0, null], [1, { cost: 0, count: 0, facts: [] }]]);
  function best(id) {
    tick();
    if (memo.has(id)) return memo.get(id);
    const n = nodes[id], i = n.variable / 2, low = best(n.low), high = best(n.high);
    const take = high && { cost: high.cost + (current.has(i) ? 0 : prices[i]),
      count: high.count + (current.has(i) ? 0 : 1), facts: [i, ...high.facts] };
    const result = !low ? take : !take ? low :
      low.cost < take.cost || (low.cost === take.cost && low.count <= take.count) ? low : take;
    memo.set(id, result); return result;
  }
  const result = best(constraint);
  if (!result) return null;
  const chosen = new Set(result.facts.map(i => 2 * i));
  if ([...currentVars].some(v => !chosen.has(v)) || roots.some((r, j) => evaluate(r, chosen) !== requested.has(j)))
    throw new Error('Evidence transport bug: invalid minimum lift');
  return { facts: result.facts.map(i => source.atoms[i]),
    added: result.facts.filter(i => !current.has(i)).map(i => source.atoms[i]), cost: result.cost };
}
