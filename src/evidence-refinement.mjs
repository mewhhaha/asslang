import { planReconstruction } from './reconstruction.mjs';

// Internal orchestration. Factory injection avoids an algebra/module import cycle.
// No input-session mutation: all search and trial interfaces use temporary sessions.
const MAX_TARGETS = 8, MAX_CANDIDATES = 64, MAX_ROUNDS = 1024;
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function list(value, limit, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length > limit) throw new RangeError(`${label} limit is ${limit}`);
  return value;
}
function integer(value, low, high, label) {
  if (!Number.isSafeInteger(value) || value < low || value > high)
    throw new RangeError(`${label} must be an integer between ${low} and ${high}`);
  return value;
}
function freeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    for (const child of Object.values(x)) freeze(child);
    Object.freeze(x);
  }
  return x;
}
function normalize(algebra, targets, options) {
  if (!record(options)) throw new TypeError('Refinement options must be an object');
  const { retained: r = [], candidates: c, maxRounds = 128, maxVerificationWork = 200000 } = options;
  integer(maxRounds, 1, MAX_ROUNDS, 'Refinement round limit');
  integer(maxVerificationWork, 1, 2000000, 'Refinement verification work limit');
  const goals = [], retained = [], candidates = [];
  for (const entry of list(targets, MAX_TARGETS, 'Refinement targets')) {
    if (!record(entry)) throw new TypeError('Refinement targets must be objects');
    const { name, value } = entry;
    algebra.equivalent(value, value); // Authenticate and enforce the private namespace.
    goals.push({ name, value });
  }
  for (const [input, output, weighted, limit] of [[r, retained, false, 128], [c, candidates, true, MAX_CANDIDATES]]) {
    for (const entry of list(input, limit, 'Refinement summaries')) {
      if (!record(entry)) throw new TypeError('Refinement summaries must be objects');
      const { atom, value } = entry;
      algebra.equivalent(value, value);
      if (weighted) {
        const supplied = entry.cost, cost = supplied === undefined ? 1 : supplied;
        integer(cost, 0, 1000000000, 'Summary cost');
        output.push({ atom, value, cost });
      } else output.push({ atom, value });
    }
  }
  if (retained.length + candidates.length > 128) throw new RangeError('Refinement limit is 128 total summary names');
  planReconstruction({ nodes: goals.map(g => g.name), edges: [] });
  planReconstruction({ nodes: [...retained, ...candidates].map(s => s.atom), edges: [] });
  const { maxNodes, maxWork } = algebra.stats;
  return { goals, retained, candidates, maxRounds, maxVerificationWork, limits: { maxNodes, maxWork } };
}
function analyze(factory, input, selected, onCall = () => {}) {
  const meanings = [...input.retained, ...selected.map(i => input.candidates[i])]
    .map(({ atom, value }) => ({ atom, value }));
  // Keep prior trial interfaces unreachable when a round finishes.
  const view = factory(meanings.map(s => s.atom), input.limits);
  for (const goal of input.goals) {
    onCall();
    const result = view.abstract(goal.value, meanings);
    if (!result.exact) return { target: goal.name, ...result.obstruction };
  }
  return null;
}
function separation(algebra, input, failure) {
  const { target, satisfying, failing } = failure;
  const separates = [];
  for (let i = 0; i < input.candidates.length; i++) {
    const f = input.candidates[i].value;
    if (algebra.evaluate(f, satisfying) && !algebra.evaluate(f, failing)) separates.push(i);
  }
  return { target, satisfying, failing, separates };
}
const bit = i => 1n << BigInt(i);
function indices(input, size) {
  if (!Array.isArray(input) || input.length > size) return null;
  let previous = -1;
  const copy = [];
  for (const i of input) {
    if (!Number.isSafeInteger(i) || i < 0 || i >= size || i <= previous) return null;
    previous = i; copy.push(i);
  }
  return copy;
}
function facts(input, names) {
  if (!Array.isArray(input) || input.length > names.length) return null;
  const seen = new Set(), copy = [];
  for (const name of input) {
    if (!names.includes(name) || seen.has(name)) return null;
    seen.add(name); copy.push(name);
  }
  return copy;
}

// A different optimizer for verification: branch on a remaining unhit clause.
// Disjoint clauses provide additive lower bounds. No BDD minimum call is used.
function betterCover(clauses, candidates, price, count, tick) {
  const prepared = clauses.map(ids => ({ ids,
    mask: ids.reduce((m, i) => m | bit(i), 0n),
    cheapest: Math.min(...ids.map(i => candidates[i].cost)),
  })).sort((a, b) => a.ids.length - b.ids.length || b.cheapest - a.cheapest);
  const visited = new Set();
  function visit(selected, spent, used) {
    tick();
    if (spent > price || (spent === price && used >= count) || visited.has(selected)) return false;
    visited.add(selected);
    const unhit = [];
    for (const clause of prepared) { tick(); if (!(clause.mask & selected)) unhit.push(clause); }
    if (!unhit.length) return true; // This support is strictly better than the claimed one.
    let packed = 0n, boundCost = spent, boundCount = used;
    for (const clause of unhit) {
      tick();
      if (!(packed & clause.mask)) { packed |= clause.mask; boundCost += clause.cheapest; boundCount++; }
    }
    if (boundCost > price || (boundCost === price && boundCount >= count)) return false;
    const choices = [...unhit[0].ids].sort((a, b) => candidates[a].cost - candidates[b].cost || a - b);
    for (const i of choices) if (visit(selected | bit(i), spent + candidates[i].cost, used + 1)) return true;
    return false;
  }
  return visit(0n, 0, 0);
}
function verify(algebra, factory, input, certificate) {
  if (!record(certificate)) return false;
  const { schemaVersion, complete, selected: supplied, minimumCost, additionalCount, separations } = certificate;
  if (schemaVersion !== 1 || typeof complete !== 'boolean' || !Array.isArray(separations) || separations.length > MAX_ROUNDS) return false;
  const selected = indices(supplied, input.candidates.length);
  if (!selected) return false;
  let work = 0;
  const tick = () => {
    if (++work > input.maxVerificationWork) throw new RangeError('Refinement verification work limit exceeded');
  };
  const evaluate = (f, s) => { tick(); return algebra.evaluate(f, s); };
  const clauses = [];
  for (const entry of separations) {
    tick();
    if (!record(entry)) return false;
    const { target, satisfying: p, failing: n, separates: declared } = entry;
    const goal = input.goals.find(g => g.name === target);
    const satisfying = facts(p, algebra.atoms), failing = facts(n, algebra.atoms);
    const actual = indices(declared, input.candidates.length);
    if (!goal || !satisfying || !failing || !actual) return false;
    if (!evaluate(goal.value, satisfying) || evaluate(goal.value, failing)) return false;
    for (const s of input.retained) if (evaluate(s.value, satisfying) && !evaluate(s.value, failing)) return false;
    let position = 0;
    for (let i = 0; i < input.candidates.length; i++) {
      const s = input.candidates[i];
      if (evaluate(s.value, satisfying) && !evaluate(s.value, failing)) {
        if (actual[position++] !== i) return false;
      }
    }
    if (position !== actual.length) return false;
    clauses.push(actual);
  }
  if (!complete) return selected.length === 0 && minimumCost === null && additionalCount === null && clauses.some(c => !c.length);
  const price = selected.reduce((sum, i) => sum + input.candidates[i].cost, 0);
  if (minimumCost !== price || additionalCount !== selected.length || !clauses.every(c => c.some(i => selected.includes(i)))) return false;
  if (betterCover(clauses, input.candidates, price, selected.length, tick)) return false;
  // Same semantic oracle as the planner, but a fresh interface; metadata is ignored.
  return analyze(factory, input, selected, tick) === null;
}

export function verifyEvidenceRefinement(algebra, factory, targets, options, certificate) {
  return verify(algebra, factory, normalize(algebra, targets, options), certificate);
}

export function planEvidenceRefinement(algebra, factory, targets, options) {
  const input = normalize(algebra, targets, options);
  const chooser = factory(input.candidates.map(c => c.atom), input.limits);
  const atoms = input.candidates.map(c => chooser.atom(c.atom));
  const prices = input.candidates.map(({ atom, cost }) => ({ atom, cost }));
  let requirement = chooser.always, oracleCalls = 0;
  const separations = [];
  function publish(complete, selected, minimumCost, additionalCount) {
    const result = { schemaVersion: 1, complete, selected, minimumCost, additionalCount, separations, oracleCalls };
    if (!verify(algebra, factory, input, result)) throw new Error('Evidence refinement bug: failed certificate verification');
    return freeze(result);
  }
  for (let round = 0; round < input.maxRounds; round++) {
    const minimum = chooser.minimum(requirement, prices);
    if (!minimum) throw new Error('Evidence refinement bug: nonempty separator clauses cannot be inconsistent');
    const yes = new Set(minimum.facts);
    const selected = input.candidates.flatMap((c, i) => yes.has(c.atom) ? [i] : []);
    const failure = analyze(factory, input, selected, () => { oracleCalls++; });
    if (!failure) return publish(true, selected, minimum.cost, selected.length);
    const clause = separation(algebra, input, failure);
    if (clause.separates.some(i => selected.includes(i))) throw new Error('Evidence refinement bug: oracle returned a separated ambiguity');
    separations.push(clause);
    if (!clause.separates.length) return publish(false, [], null, null);
    requirement = chooser.all([requirement, chooser.any(clause.separates.map(i => atoms[i]))]);
  }
  throw new RangeError('Evidence refinement round limit exceeded; no optimum certified');
}
