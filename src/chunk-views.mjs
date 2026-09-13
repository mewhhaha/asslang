// Arithmetic chunk families are compiler plans, never arrays of descriptors.
// Flattening consumes an ordered cover witness, not a guessed equal length.
export function createChunkViews({ scalar, int, boolean, substitute, record, steps, leaves, fail }) {
  const stats = { chunks: 0, flattens: 0, structuralPasses: 0 };
  const union = (a, b) => [...new Set([...a, ...b])];
  function indexed(input, at) {
    if (!steps[input.proof].dense || input.mask)
      fail('Chunk views require dense input; materialize filtered input explicitly', at, 'E_CHUNK_DENSE');
    if (!steps[input.proof].seekable || input.machines.length)
      fail('Chunk views cannot seek evolving state; chunk before scanning, or reduce each block', at, 'E_CHUNK_ACCESS');
  }
  function chunks(input, size, at) {
    indexed(input, at); leaves(input.item, at);
    const viewDepth = (input.viewDepth ?? 0) + 1;
    if (viewDepth > 64) fail('Array view nesting exceeds 64', at, 'E_LIMIT');
    const width = scalar('chunk_width', 'I32', [size]);
    const extent = scalar('chunk_count', 'I32', [input.extent, width]);
    const outerIndex = scalar('index', 'I32', [], null, true);
    const innerIndex = scalar('index', 'I32', [], null, true);
    const start = scalar('index_mul', 'I32', [outerIndex, width]);
    const length = scalar('index_min', 'I32', [width, scalar('index_sub', 'I32', [input.extent, start])]);
    const position = scalar('index_add', 'I32', [start, innerIndex]);
    const outer = { kind: 'stream', proof: record('chunks', [input], {
      obligation: 'positive-width-ordered-cover',
    }), extent, indices: [outerIndex], guards: union(input.guards, [scalar('index_valid', 'Bool', [width])]),
      machines: [], mask: null, viewDepth };
    const inner = { kind: 'stream', proof: record('chunk', [outer]), extent: length,
      indices: [innerIndex], guards: [], machines: [], mask: null, viewDepth,
      item: substitute(input.item, new Map(input.indices.map(i => [i.id, position]))) };
    outer.item = inner;
    outer.chunkLayout = { outerDomain: outer.proof, innerDomain: inner.proof,
      sourceExtent: input.extent, innerExtent: length, count: extent, width,
      sourceDomain: steps[input.proof].domain, sourceCover: input.viewCover };
    stats.chunks++;
    return outer;
  }
  function noRepeatedWork(value, at, seen = new Set()) {
    if (value.kind === 'record') { value.fields.forEach(v => noRepeatedWork(v, at, seen)); return; }
    if (seen.has(value.id)) return;
    seen.add(value.id);
    if (['reduce', 'reduce_group', 'reduce_until', 'iterate_group'].includes(value.op))
      fail('Flattening cannot repeat a reduction per element; reduce blocks with map, or scan after flatten', at, 'E_CHUNK_WORK');
    // Orders are already invocation-closed, strictly materialized and cached.
    if (!['order', 'host_call'].includes(value.op)) value.args.forEach(v => noRepeatedWork(v, at, seen));
  }
  function flatten(input, at) {
    indexed(input, at);
    const layout = input.chunkLayout, inner = input.item;
    if (!layout || inner.kind !== 'stream' || steps[input.proof].domain !== layout.outerDomain || input.extent !== layout.count)
      fail('flatten requires the complete ordered family produced by chunks', at, 'E_CHUNK_COVER');
    indexed(inner, at);
    if (steps[inner.proof].domain !== layout.innerDomain || inner.extent !== layout.innerExtent)
      fail('flatten requires each whole block in its original order; preserve its cover with map or rejoin', at, 'E_CHUNK_COVER');
    leaves(inner.item, at);
    const viewDepth = Math.max(input.viewDepth ?? 0, inner.viewDepth ?? 0) + 1;
    if (viewDepth > 64) fail('Array view nesting exceeds 64', at, 'E_LIMIT');
    const seen = new Set();
    [inner.item, ...inner.guards].forEach(v => noRepeatedWork(v, at, seen));
    const index = scalar('index', 'I32', [], null, true);
    const quotient = scalar('index_div', 'I32', [index, layout.width]);
    const remainder = scalar('index_rem', 'I32', [index, layout.width]);
    const replacements = new Map([
      ...input.indices.map(i => [i.id, quotient]), ...inner.indices.map(i => [i.id, remainder]),
    ]);
    const guards = [...input.guards];
    if (inner.guards.length) {
      // Preflight structural obligations once per nonempty block, with the
      // existing metered reduction. No payload or descriptor array is built.
      let body = boolean(true);
      for (const condition of inner.guards) body = scalar('guard', 'Bool', [condition, body]);
      const validation = scalar('reduce', 'Bool', [], null, true);
      Object.assign(validation, { stream: input, initial: boolean(true),
        acc: scalar('acc', 'Bool', [], null, true), body });
      guards.push(validation); stats.structuralPasses++;
    }
    stats.flattens++;
    return { kind: 'stream', proof: record('flatten_chunks', [input, inner], {
      obligation: 'ordered-chunk-cover', domain: layout.sourceDomain,
    }), extent: layout.sourceExtent, item: substitute(inner.item, replacements),
      indices: [index], guards, machines: [], mask: null, viewDepth,
      ...(layout.sourceCover ? { viewCover: layout.sourceCover } : {}) };
  }
  return { chunks, flatten, stats };
}
