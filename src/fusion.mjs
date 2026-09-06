// Opt-in, demand-scoped reduction cohorts. Checked JTE domain equality is
// necessary but not sufficient: physical schedules and state frames must agree.
// The emitter calls this only outside iteration bodies and across no effect or
// conditional boundary. cached includes scalar, record-group and lazy results.
export function planReductionFusion(root, steps, cached) {
  const candidates = [], visited = new Set();
  const reductions = new Set(['reduce', 'reduce_group']);
  function visit(node) {
    if (!node || cached.has(node.id) || visited.has(node.id)) return;
    visited.add(node.id);
    if (reductions.has(node.op)) { candidates.push(node); return; }
    if (['if', '&&', '||', 'guard', 'host_call', 'iterate_group', 'reduce_until'].includes(node.op)) return;
    for (const arg of node.args) visit(arg);
  }
  for (const node of Array.isArray(root) ? root : [root]) visit(node);

  const inspected = new Map();
  function blocked(node) {
    if (!node) return false;
    if (inspected.has(node.id)) return inspected.get(node.id);
    const result = reductions.has(node.op) || node.op === 'iterate_group' || node.op === 'reduce_until' ||
      node.op === 'host_call' || node.args.some(blocked);
    inspected.set(node.id, result);
    return result;
  }
  const cohorts = new Map();
  for (const node of candidates) {
    const s = node.stream;
    // Do not inspect s.item: count/ignoring folds need not demand map values.
    // Transitions ARE strict: inspect their complete schedule, even for count.
    const machines = s.machines ?? [];
    const roots = [node.initial, node.body, s.extent, s.mask, ...s.guards,
      ...machines.flatMap(m => [m.initial, m.body, m.outputs, m.emission, m.gate])].flat();
    if (roots.some(blocked)) continue;
    const domain = steps[s.proof]?.domain;
    if (!Number.isInteger(domain)) throw new Error('Fusion needs a checked stream domain');
    const key = JSON.stringify([domain, s.extent.id, s.mask?.id ?? null,
      s.indices.map(n => n.id), s.guards.map(n => n.id), machines.map(m => m.id)]);
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(node);
  }
  const groups = new Map();
  for (const cohort of cohorts.values()) {
    if (cohort.length > 1) for (const node of cohort) groups.set(node.id, cohort);
  }
  return groups;
}
