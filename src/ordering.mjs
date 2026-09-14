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
      value.machines.forEach(m => visit([...m.initial, ...m.body, ...m.outputs, m.emission, m.gate, m.reset]));
      return;
    }
    if (value.kind === 'blob') { visit([value.pointer, value.extent]); return; }
    if (value.kind !== 'scalar' || seen.has(value.id)) return;
    seen.add(value.id);
    visit(value.args);
    if (value.op === 'order') {
      orders.push(value); visit([value.stream, value.keys ?? value.key]);
    } else if (['reduce', 'reduce_group', 'reduce_until', 'iterate_group'].includes(value.op)) {
      visit([value.stream, value.initial, value.body, value.done, value.limit]);
    }
  }
  visit(roots);
  return orders;
}

// Tuple positions, not ABI/alphabetical field order, determine key priority.
// Recheck the staged representation independently of deferred type constraints.
export function orderingKeyLeaves(value, at, fail) {
  const result = [];
  function visit(value, depth) {
    if (value.kind === 'scalar' && value.type === 'Num') {
      result.push(value);
      if (result.length > 16) fail('sort_by accepts at most 16 numeric key leaves', at, 'E_LIMIT');
      return;
    }
    if (value.kind !== 'record') fail('sort_by keys must be Num or nonempty positional tuples of Num', at, 'E_TYPE');
    if (depth >= 16) fail('sort_by key nesting exceeds 16', at, 'E_LIMIT');
    const n = value.fields.size;
    if (!n || [...Array(n).keys()].some(i => !value.fields.has(`_${i}`)))
      fail('sort_by key priorities use nonempty positional tuples', at, 'E_TYPE');
    for (let i = 0; i < n; i++) visit(value.fields.get(`_${i}`), depth+1);
  }
  visit(value, 0);
  return result;
}
