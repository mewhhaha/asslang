// Symbolic regular block families. This is compiler data, never guest [[a]]
// storage. See docs/CHUNK-COMPOSITION.md for cover and reset obligations.
export function createChunkViews(api) {
  const { scalar, num, int, boolean, substitute, record, steps, fail,
    scopedPlan, iteration, invoke, leaves, guardValue, machineId } = api;
  const stats = { chunks: 0, maps: 0, summaries: 0, flattens: 0, resetMachines: 0, checkpoints: 0 };
  const index = () => scalar('index', 'I32', [], null, true);
  const op = (name, a, b) => scalar(name, name === 'index_lt' || name === 'index_eq' ? 'Bool' : 'I32', [a,b]);
  const union = (a,b) => [...new Set([...a,...b])];
  function depth(n, at) {
    if (n > 64) fail('Chunk/array view nesting exceeds 64', at, 'E_LIMIT');
    return n;
  }
  function chunks(source, size, at) {
    const fact = steps[source.proof];
    if (!fact.dense || source.mask) fail('chunks requires dense indexed input', at, 'E_CHUNK_DENSE');
    if (!fact.seekable || source.machines.length)
      fail('Chunk the indexed source before scanning; chunks cannot seek evolving state', at, 'E_CHUNK_ACCESS');
    const viewDepth = depth((source.viewDepth ?? 0)+1, at);
    const width = scalar('extent', 'I32', [scalar('guard', 'Num', [scalar('>', 'Bool', [size,num(0)]),size])]);
    const valid = scalar('index_valid', 'Bool', [width]);
    const b = index(), j = index();
    const remainder = op('index_rem',source.extent,width);
    const extra = scalar('if','I32',[op('index_eq',remainder,int(0)),int(0),int(1)]);
    const extent = op('index_add',op('index_div',source.extent,width),extra);
    const outer = {kind:'stream',proof:record('chunks',[source],{obligation:'positive-integer-width'}),
      extent,indices:[b],item:scalar('to_num','Num',[b]),mask:null,machines:[],
      guards:union(source.guards,[valid]),viewDepth};
    const offset = op('index_mul',b,width), remaining = op('index_sub',source.extent,offset);
    const length = scalar('if','I32',[op('index_lt',width,remaining),width,remaining]);
    const local = {kind:'stream',proof:record('chunk_items',[source,outer]),extent:length,indices:[j],
      item:substitute(source.item,new Map(source.indices.map(i=>[i.id,op('index_add',offset,j)]))),
      mask:null,machines:[],guards:[],viewDepth};
    stats.chunks++;
    return {kind:'chunks',source,outer,local,inner:local,width,offset,viewDepth};
  }
  function scoped(family) {
    const outer = scopedPlan(family.outer);
    if (outer === family.outer) return family;
    const replacements = new Map(family.outer.indices.map((n,i)=>[n.id,outer.indices[i]]));
    return {...family,outer,local:substitute(family.local,replacements),
      inner:substitute(family.inner,replacements),offset:substitute(family.offset,replacements)};
  }
  function map(family, callback, at) {
    family = scoped(family);
    const value = iteration([family.outer],()=>invoke(callback,[family.inner],at));
    const outer = {...family.outer,proof:record('map',[family.outer])};
    stats.maps++;
    if (value.kind === 'stream') {
      const fact = steps[value.proof];
      if (!fact.dense || value.mask || fact.domain !== steps[family.local.proof].domain || value.extent !== family.local.extent)
        fail('An array-valued chunk map must preserve its block event domain and exact extent; use scalar summaries or an aligned map/scan',at,'E_CHUNK_SHAPE');
      leaves(value.item,at);
      return {...family,outer,inner:value,viewDepth:depth(Math.max(family.viewDepth,value.viewDepth??0),at)};
    }
    if (value.kind === 'chunks') fail('Flatten inner chunk families before returning a block',at,'E_CHUNK_SHAPE');
    leaves(value,at);
    stats.summaries++;
    return {...outer,item:value};
  }
  function count(family, at) {
    record('reduce',[family.outer]);
    let value = scalar('to_num','Num',[family.outer.extent]);
    for (const guard of family.outer.guards) value = guardValue(guard,value,at);
    return value;
  }
  function flatten(family, at) {
    const source = scopedPlan(family.source), i = source.indices[0];
    const localIndex = op('index_rem',i,family.width), b = op('index_div',i,family.width);
    const boundary = op('index_eq',localIndex,int(0));
    const replacements = new Map([
      ...family.outer.indices.map(n=>[n.id,b]),
      ...family.local.indices.map(n=>[n.id,localIndex]),
      ...family.inner.indices.map(n=>[n.id,localIndex]),
      [family.offset.id,op('index_sub',i,localIndex)],
    ]);
    // Each flatten owns a distinct schedule. Only reuse of the resulting stream
    // shares it; two flatten invocations cannot alias accumulator/cell bindings.
    for (const m of family.inner.machines) for (const n of [...m.acc,...m.cells])
      replacements.set(n.id,scalar(n.op,n.type,[],null,true));
    const inner = substitute(family.inner,replacements);
    const machines = inner.machines.map(m=>({...m,id:machineId(),
      acc:m.acc.map(n=>replacements.get(n.id)??n),cells:m.cells.map(n=>replacements.get(n.id)??n),
      reset:m.reset ? scalar('||','Bool',[boundary,m.reset]) : boundary}));
    let proofInner = family.inner;
    if (inner.guards.length) {
      // An empty-state checkpoint makes guards part of sequential demand,
      // including count and ignoring folds. No block/boundary vector is stored.
      machines.unshift({id:machineId(),initial:[],acc:[],body:[],outputs:[],
        emission:boolean(true),cells:[scalar('cell','Bool',[],null,true)],gate:null,
        reset:boundary,checks:inner.guards});
      proofInner = {...family.inner,proof:record('scan',[family.inner])};
      stats.checkpoints++;
    }
    stats.flattens++; stats.resetMachines += machines.length;
    const proof = record('flatten_chunks',[family.outer,family.local,proofInner],{
      obligation:'same-local-event-cover',domain:steps[source.proof].domain,dense:true,
      seekable:steps[proofInner.proof].seekable,
    });
    return {kind:'stream',proof,extent:source.extent,indices:source.indices,item:inner.item,
      mask:null,machines,guards:union(source.guards,family.outer.guards),
      viewDepth:depth(family.viewDepth,at),
      ...(source.viewCover ? {viewCover:source.viewCover} : {})};
  }
  return {chunks,map,count,flatten,stats};
}
