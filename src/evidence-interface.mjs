// Internal, ephemeral Boolean workspace for monotone interface adjoints.
// Caller validates authentic handles and owns transaction/limits. No globals or
// source-session mutation; only public output nodes use the caller's interner.
export function inferEvidenceInterface(source, root, meanings, target) {
  const { tick, mk: publicNode, maxNodes } = target;
  const nodes = [null, null], unique = new Map(), copied = new Map();
  const applications = new Map(), negatives = new Map();
  function mk(variable, low, high) {
    tick();
    if (low === high) return low;
    const key = `${variable}:${low}:${high}`;
    if (unique.has(key)) return unique.get(key);
    if (nodes.length >= maxNodes) throw new RangeError('Evidence interface workspace node limit exceeded');
    const id = nodes.length; nodes.push({ variable, low, high }); unique.set(key, id); return id;
  }
  function copy(id) {
    tick();
    if (id < 2) return id;
    if (copied.has(id)) return copied.get(id);
    const n = source.nodes[id], result = mk(n.variable, copy(n.low), copy(n.high));
    copied.set(id, result); return result;
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
  const f = copy(root), summary = meanings.map(copy);
  const lastUse = new Int16Array(source.atoms.length).fill(-1);
  for (let i = 0; i < summary.length; i++) {
    const seen = new Set(), stack = [summary[i]];
    while (stack.length) {
      tick();
      const id = stack.pop();
      if (id < 2 || seen.has(id)) continue;
      seen.add(id); const n = nodes[id]; lastUse[n.variable] = i;
      stack.push(n.low, n.high);
    }
  }
  const quantifications = new Map();
  function forgetBefore(id, position) {
    tick();
    if (id < 2) return id;
    const key = `${position}:${id}`;
    if (quantifications.has(key)) return quantifications.get(key);
    const n = nodes[id], low = forgetBefore(n.low, position), high = forgetBefore(n.high, position);
    const result = lastUse[n.variable] < position ? apply('or', low, high) : mk(n.variable, low, high);
    quantifications.set(key, result); return result;
  }
  function project(initial, necessary) {
    const memo = new Map();
    function visit(position, condition) {
      tick();
      condition = forgetBefore(condition, position);
      if (condition === 0) return necessary ? 0 : 1;
      if (position === summary.length) return necessary ? 1 : 0;
      const key = `${position}:${condition}`;
      if (memo.has(key)) return memo.get(key);
      const constrained = apply('and', condition, necessary ? not(summary[position]) : summary[position]);
      const low = visit(position + 1, necessary ? constrained : condition);
      const high = visit(position + 1, necessary ? condition : constrained);
      const result = publicNode(position, low, high);
      memo.set(key, result); return result;
    }
    return visit(0, initial);
  }
  const necessary = project(f, true), sufficient = project(not(f), false);
  const concretized = new Map();
  function concretize(id) {
    tick();
    if (id < 2) return id;
    if (concretized.has(id)) return concretized.get(id);
    const n = target.nodes[id];
    // Public results are monotone, hence low implies high; rebuild in private order.
    const result = apply('or', concretize(n.low), apply('and', summary[n.variable], concretize(n.high)));
    concretized.set(id, result); return result;
  }
  const upper = concretize(necessary), lower = concretize(sufficient);
  if (apply('and', lower, not(f)) !== 0 || apply('and', f, not(upper)) !== 0 ||
      (upper === f) !== (lower === f)) throw new Error('Evidence interface bug: adjoint bounds disagree');
  const exact = upper === f;
  function assignment(id) {
    if (id === 0) throw new Error('Evidence interface bug: missing separating assignment');
    const facts = new Set();
    while (id > 1) {
      tick(); const n = nodes[id];
      if (n.low !== 0) id = n.low;
      else { facts.add(n.variable); id = n.high; }
    }
    return facts;
  }
  function evaluate(id, facts) {
    while (id > 1) { tick(); const n = nodes[id]; id = facts.has(n.variable) ? n.high : n.low; }
    return id === 1;
  }
  let obstruction = null;
  if (!exact) {
    const failing = assignment(apply('and', upper, not(f)));
    const failingView = summary.map(id => evaluate(id, failing));
    let witness = f;
    for (let i = 0; i < summary.length; i++) if (!failingView[i]) witness = apply('and', witness, not(summary[i]));
    const satisfying = assignment(witness), satisfyingView = summary.map(id => evaluate(id, satisfying));
    if (!evaluate(f, satisfying) || evaluate(f, failing) || satisfyingView.some((v, i) => v && !failingView[i]))
      throw new Error('Evidence interface bug: invalid separating pair');
    obstruction = {
      satisfying: source.atoms.filter((_, i) => satisfying.has(i)),
      failing: source.atoms.filter((_, i) => failing.has(i)),
      satisfyingView: target.atoms.filter((_, i) => satisfyingView[i]),
      failingView: target.atoms.filter((_, i) => failingView[i]),
    };
  }
  return { necessary, sufficient, exact, obstruction };
}
