// Literal finite-array semantic models, deliberately allocation-heavy.
// These are JavaScript models, not Haskell/GHC performance measurements.
export function referenceOrder(keys, { threeWay = true, pivot = 'median3' } = {}) {
  if (keys.length > 2048) throw new RangeError('Reference is bounded to 2048 keys');
  if (Array.from(keys).some(x => typeof x !== 'number' || !Number.isFinite(x))) throw new TypeError('Finite keys required');
  const stats = { comparisons: 0, arrayElementWrites: keys.length, partitions: 0 };
  function cmp(a, b) { stats.comparisons++; return a < b ? -1 : a > b ? 1 : 0; }
  function choose(xs) {
    const a=keys[xs[0]], b=keys[xs[Math.floor(xs.length/2)]], c=keys[xs.at(-1)];
    if (pivot==='first') return a;
    if (pivot==='middle') return b;
    return cmp(a,b)<0 ? (cmp(b,c)<0 ? b : cmp(a,c)<0 ? c:a)
      : (cmp(a,c)<0 ? a : cmp(b,c)<0 ? c:b);
  }
  function run(xs) {
    if (xs.length < 2) return xs;
    stats.partitions++;
    if (threeWay) {
      const p=choose(xs);
      const less=xs.filter(i=>cmp(keys[i],p)<0);
      const equal=xs.filter(i=>cmp(keys[i],p)===0);
      const greater=xs.filter(i=>cmp(keys[i],p)>0);
      stats.arrayElementWrites += xs.length;
      const result=run(less).concat(equal,run(greater));
      stats.arrayElementWrites += result.length;
      return result;
    }
    const [head, ...tail]=xs;
    const less=tail.filter(i=>cmp(keys[i],keys[head])<0);
    const greater=tail.filter(i=>cmp(keys[i],keys[head])>=0);
    // Count explicit tail copy, filter outputs and concatenated results.
    stats.arrayElementWrites += 2*tail.length;
    const result=run(less).concat([head],run(greater));
    stats.arrayElementWrites += 1+result.length;
    return result;
  }
  return { indices: run(Array.from(keys,(_,i)=>i)), stats };
}
