import { layout } from './abi-schema.mjs';

// A whole-result, co-demanded cohort, not unrestricted horizontal fusion.
// Keep sparse/conditional/stateless paths in the original writer. In particular,
// equal lengths do not establish equal JTE domains or shared causal state.
export function planOutputFusion(value, schema, steps, completed) {
  if (schema.kind !== 'Record') return null;
  const arrays = [], reductions = new Map(), sinks = [];
  function collect(value, schema, offset) {
    if (schema.kind === 'Record')
      return layout(schema).fields.every(f => collect(value.fields.get(f.name), f.schema, offset + f.offset));
    if (schema.kind === 'Stream') {
      if (!['Num', 'Bool'].includes(schema.element.kind)) return false;
      const entry = { stream: value, stride: schema.element.kind === 'Num' ? 8 : 4, offset };
      arrays.push(entry); sinks.push({ stream: value, guards: value.guards, roots: [value.item] });
      return true;
    }
    if (!['Num', 'Bool'].includes(schema.kind)) return false;
    const guards = [];
    while (value.op === 'guard') { guards.push(value.args[0]); value = value.args[1]; }
    const node = value.op === 'reduce_field' ? value.args[0] : value;
    if (!['reduce', 'reduce_group'].includes(node.op) || completed.has(node.id)) return false;
    reductions.set(node.id, node);
    sinks.push({ stream: node.stream, guards: [...guards, ...node.stream.guards],
      roots: [node.initial, node.body].flat() });
    return true;
  }
  if (!collect(value, schema, 0) || !arrays.length || arrays.length + reductions.size < 2) return null;
  const stream = arrays[0].stream, guards = sinks[0].guards;
  const equal = (a, b) => a.length === b.length && a.every((n, i) => n.id === b[i].id);
  const fact = steps[stream.proof];
  if (!fact || !Number.isInteger(fact.domain) || !fact.dense || stream.mask || !stream.machines.length) return null;
  if (sinks.some(s => {
    const t = s.stream, f = steps[t.proof];
    return !f || !f.dense || f.domain !== fact.domain || t.mask || t.extent !== stream.extent ||
      !equal(t.indices, stream.indices) || t.machines.length !== stream.machines.length ||
      t.machines.some((m, i) => m !== stream.machines[i]) || !equal(s.guards, guards);
  })) return null;

  const blocked = new Set(['reduce', 'reduce_group', 'reduce_until', 'iterate_group', 'host_call']);
  const seen = new Set();
  function safe(node) {
    if (!node || seen.has(node.id)) return true;
    if (blocked.has(node.op)) return false;
    seen.add(node.id);
    return node.args.every(safe);
  }
  // Transitions are strict; ignoring folds do not force their unused stream.item.
  const roots = [stream.extent, ...guards, ...sinks.flatMap(s => s.roots),
    ...stream.machines.flatMap(m => [...m.initial, ...m.body, ...m.outputs, m.emission, m.gate])];
  if (!roots.every(safe)) return null;
  return { stream, guards, arrays, reductions: [...reductions.values()], domain: fact.domain };
}
