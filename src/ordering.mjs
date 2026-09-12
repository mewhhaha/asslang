// Find invocation-wide materialization sites, including demand behind branches.
// Source staging rejects construction under runtime binders, so these nodes are
// closed over export inputs/effect results, not a previous loop's accumulator.
export function collectOrderings(roots) {
  const seen = new Set(), orders = [];
  function visit(value) {
    if (!value) return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value.kind === 'record') { value.fields.forEach(visit); return; }
    if (value.kind === 'stream') {
      visit([value.extent, value.item, value.mask, ...value.guards]);
      value.machines.forEach(m => visit([...m.initial, ...m.body, ...m.outputs, m.emission, m.gate]));
      return;
    }
    if (value.kind === 'blob') { visit([value.pointer, value.extent]); return; }
    if (value.kind !== 'scalar' || seen.has(value.id)) return;
    seen.add(value.id);
    visit(value.args);
    if (value.op === 'order') {
      orders.push(value); visit([value.stream, value.key]);
    } else if (['reduce', 'reduce_group', 'reduce_until', 'iterate_group'].includes(value.op)) {
      visit([value.stream, value.initial, value.body, value.done, value.limit]);
    }
  }
  visit(roots);
  return orders;
}
