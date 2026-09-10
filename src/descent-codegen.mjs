// Internal emitter for validated, complete descent plans. Not a public compiler API.
function conjunction(expressions, start = 0, end = expressions.length) {
  if (start === end) return 'true';
  if (end - start === 1) return expressions[start];
  const mid = start + Math.floor((end - start) / 2);
  return `(${conjunction(expressions, start, mid)} && ${conjunction(expressions, mid, end)})`;
}

export function emitDescentSource(name, plan, additional) {
  const nodeIndex = new Map(plan.nodes.map((node, v) => [node, v]));
  const patchIndex = new Map(plan.patches.map((patch, i) => [patch.name, i]));
  const value = (patch, node) => `v${patchIndex.get(patch)}_${nodeIndex.get(node)}`;
  const bindings = [];
  for (const [i, patch] of plan.patches.entries()) {
    bindings.push(`    let p${i} = pieces.${patch.name};`);
    for (const node of patch.nodes) bindings.push(`    let ${value(patch.name, node)} = p${i}.${node};`);
  }
  const eq = node => `eq${nodeIndex.get(node)}`;
  const eqBindings = nodes => plan.nodes.filter(node => nodes.has(node)).map(node => `    let ${eq(node)} = same.${node};`);
  const agreement = plan.comparisons.map(({ node, left, right }) => `(${eq(node)} ${value(left, node)} ${value(right, node)})`);
  const usedMaps = [...new Set(plan.edges.map(edge => edge.map))];
  const mapIndex = new Map(usedMaps.map((map, i) => [map, i]));
  const local = [];
  for (const patch of plan.patches) {
    const included = new Set(patch.nodes);
    for (const { from, to, map } of plan.edges) if (included.has(from))
      local.push(`(${eq(to)} (m${mapIndex.get(map)} ${value(patch.name, from)}) ${value(patch.name, to)})`);
  }
  const extra = additional === undefined ? [] : [
    '  let checkAdditional = same -> pieces -> do {', ...bindings,
    ...eqBindings(new Set(additional.map(test => test.node))),
    `    ((result:Bool) -> result) (${conjunction(additional.map(({ node, left, right }) =>
      `(${eq(node)} ${value(left, node)} ${value(right, node)})`))})`, '  };',
  ];
  const source = [
    '// Generated descent protocol. agree assumes coherence; join checks equations.',
    '// All compressed checks require lawful, map-compatible equality.',
    ...(additional === undefined ? [] : ['// checkAdditional assumes local coherence AND all retained facts about CURRENT pieces.']),
    `fn ${name} = maps -> do {`,
    '  let agree = same -> pieces -> do {', ...bindings,
    ...eqBindings(new Set(plan.comparisons.map(test => test.node))),
    `    ((result:Bool) -> result) (${conjunction(agreement)})`, '  };',
    '  let check = same -> pieces -> do {', ...bindings,
    ...usedMaps.map((map, i) => `    let m${i} = maps.${map};`),
    ...eqBindings(new Set(plan.edges.map(edge => edge.to))),
    `    ${conjunction(local)} && (agree same pieces)`, '  };',
    '  let glue = pieces -> do {', ...bindings,
    `    {${plan.owners.map(({ node, patch }) => `${node}: ${value(patch, node)}`).join(', ')}}`, '  };',
    ...extra,
    `  {${additional === undefined ? '' : 'checkAdditional, '}agree, check, glue, join:same -> pieces -> require (check same pieces) (glue pieces)}`,
    '};', '',
  ].join('\n');
  return source;
}
