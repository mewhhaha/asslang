// Experimental reduction cohorts. The JTE ledger is checked by stage() before
// lowering; equal domains are necessary, but not sufficient, for sharing a loop.
// This planner also requires identical schedules and independent scalar DAGs.
export function planReductionFusion(root, steps, cache) {
  const candidates = [], visited = new Set();
  function visit(node) {
    if (cache.has(node.id) || visited.has(node.id)) return;
    visited.add(node.id);
    if (node.op === 'reduce') { candidates.push(node); return; }
    // A condition and each selected branch are planned separately by the emitter.
    // In particular, neither arm is made eager just because its stream matches.
    if (['if', '&&', '||'].includes(node.op)) return;
    for (const arg of node.args) visit(arg);
  }
  visit(root);

  const dependencies = new Map();
  function containsReduction(node) {
    if (!node) return false;
    if (dependencies.has(node.id)) return dependencies.get(node.id);
    const result = node.op === 'reduce' || node.args.some(containsReduction);
    dependencies.set(node.id, result);
    return result;
  }
  const cohorts = new Map();
  for (const node of candidates) {
    const s = node.stream;
    // Deliberately do NOT inspect s.item: count and ignoring folds do not demand
    // it. Conversely, inspect both arms of scalar branches conservatively.
    if ([node.initial, node.body, s.extent, s.mask, ...s.guards].some(containsReduction)) continue;
    const domain = steps[s.proof]?.domain;
    if (!Number.isInteger(domain)) throw new Error('Fusion needs a checked stream domain');
    const key = JSON.stringify([domain, s.extent.id, s.mask?.id ?? null,
      s.indices.map(n => n.id), s.guards.map(n => n.id)]);
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(node);
  }
  const groups = new Map();
  for (const cohort of cohorts.values()) {
    if (cohort.length > 1) for (const node of cohort) groups.set(node.id, cohort);
  }
  return groups;
}
