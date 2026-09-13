// Compile-time indexed views, not a guest rope or borrowed result handle.
// The event-domain ledger independently checks complementary cut witnesses.
export function createArrayViews({ scalar, int, substitute, record, steps, fail }) {
  const stats = { splits: 0, concats: 0, restoredDomains: 0, maxJoinSegments: 0 };
  const union = (a, b) => [...new Set([...a, ...b])];
  function depth(inputs, at) {
    const result = 1 + Math.max(...inputs.map(s => s.viewDepth ?? 0));
    if (result > 64) fail('Array view nesting exceeds 64', at, 'E_LIMIT');
    return result;
  }
  function indexed(input, at) {
    const fact = steps[input.proof];
    if (!fact.dense || input.mask)
      fail('Array views require dense inputs; a filtered stream needs explicit materialization', at, 'E_VIEW_DENSE');
    if (!fact.seekable || input.machines.length)
      fail('Split or concatenate the indexed source before scan/transduce; array views cannot seek evolving state', at, 'E_VIEW_ACCESS');
  }
  const rebase = (stream, index) => substitute(stream.item,
    new Map(stream.indices.map(i => [i.id, index])));
  function splitAt(input, position, at) {
    indexed(input, at);
    const viewDepth = depth([input], at);
    const cut = scalar('split_point', 'I32', [position, input.extent]);
    const guard = scalar('index_valid', 'Bool', [cut]);
    const guards = union(input.guards, [guard]);
    const leftIndex = scalar('index', 'I32', [], null, true);
    const left = { kind: 'stream', proof: record('split_left', [input], {
      obligation: 'integer-cut-within-extent',
    }), extent: cut, indices: [leftIndex], item: rebase(input, leftIndex),
      mask: null, machines: [], guards, viewDepth };
    const rightIndex = scalar('index', 'I32', [], null, true);
    const right = { kind: 'stream', proof: record('split_right', [input, left]),
      extent: scalar('index_sub', 'I32', [input.extent, cut]), indices: [rightIndex],
      item: rebase(input, scalar('index_add', 'I32', [rightIndex, cut])),
      mask: null, machines: [], guards, viewDepth };
    left.viewCover = { cut: left.proof, side: 'left', source: input, domain: left.proof };
    right.viewCover = { cut: left.proof, side: 'right', source: input, domain: right.proof };
    stats.splits++;
    return { kind: 'record', fields: new Map([['left', left], ['right', right]]) };
  }
  function cover(input) {
    // A checked positional zip or other new domain must not inherit a cover
    // merely because its staging implementation spread an earlier plan.
    const c = input.viewCover;
    return c && c.domain === steps[input.proof].domain ? c : null;
  }
  function pieces(input) {
    const saved = input.viewPieces;
    // Maps, cursor substitution and other changes invalidate old item graphs.
    return saved && saved.item === input.item && saved.extent === input.extent
      ? saved.parts : [input];
  }
  function select(condition, yes, no) {
    if (yes === no) return yes;
    if (yes.kind === 'record') return { kind: 'record', fields: new Map(
      [...yes.fields].map(([key, value]) => [key, select(condition, value, no.fields.get(key))])) };
    return scalar('if', yes.type, [condition, yes, no]);
  }
  function concat(left, right, at) {
    indexed(left, at); indexed(right, at);
    const viewDepth = depth([left, right], at);
    const parts = [...pieces(left), ...pieces(right)];
    if (parts.length > 64) fail('A virtual concatenation supports at most 64 direct segments', at, 'E_LIMIT');
    const a = cover(left), b = cover(right);
    const parent = a && b && a.cut === b.cut && a.side === 'left' && b.side === 'right'
      && a.source === b.source ? a.source : null;
    const extent = parent ? parent.extent : scalar('concat_extent', 'I32', [left.extent, right.extent]);
    // A complete cover is the parent's coordinate system, not merely a
    // same-length stream. Reusing it also exposes shared original loads.
    const indices = parent ? parent.indices : [scalar('index', 'I32', [], null, true)];
    const index = indices[0], starts = [int(0)];
    for (let i = 0; i < parts.length-1; i++)
      starts.push(scalar('index_add', 'I32', [starts[i], parts[i].extent]));
    function dispatch(lo, hi) {
      if (hi-lo === 1) return rebase(parts[lo], scalar('index_sub', 'I32', [index, starts[lo]]));
      const middle = Math.floor((lo+hi)/2);
      return select(scalar('index_lt', 'Bool', [index, starts[middle]]),
        dispatch(lo, middle), dispatch(middle, hi));
    }
    const item = dispatch(0, parts.length);
    // Hoist prefix arithmetic into the stream's structural demand. Consumers
    // copy this scalar cache into their loops, so balanced dispatch does not
    // accidentally recompute a linear prefix sum for every output element.
    const guards = union(union(left.guards, right.guards), [
      scalar('index_valid', 'Bool', [extent]),
      scalar('index_valid', 'Bool', [starts.at(-1)]),
    ]);
    const result = { kind: 'stream', proof: record(parent ? 'rejoin' : 'concat', [left, right],
      parent ? { domain: steps[parent.proof].domain } : {}), extent, item, indices,
      mask: null, machines: [], guards, viewDepth };
    // Reassembling a nested cut restores the enclosing half as well.
    if (parent && cover(parent)) result.viewCover = cover(parent);
    result.viewPieces = { item, extent, parts };
    stats.concats++; stats.restoredDomains += Boolean(parent);
    stats.maxJoinSegments = Math.max(stats.maxJoinSegments, parts.length);
    return result;
  }
  return { splitAt, concat, stats };
}
