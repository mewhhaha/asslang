// Executable lowering-target experiment, NOT an Asslang compiler intrinsic.
// See docs/PARTITION-RECURSION.md: stable order is the semantic contract, and
// disjoint ranges replace recursive child arrays. No caller buffer is mutated.
const MAX_ITEMS = 1_048_576;
const MAX_WORK = 1_000_000_000;
const inputArray = x => Array.isArray(x) || x instanceof Float64Array;
function integer(x, lo, hi, label) {
  if (!Number.isSafeInteger(x) || x < lo || x > hi)
    throw new RangeError(`${label} must be an integer in [${lo}, ${hi}]`);
  return x;
}

/** Stable ascending ordering as original indices; finite numeric keys only.
 * Keys are copied and validated once. A key computation belongs to the caller.
 * @param {number[]|Float64Array} input
 * @param {{pivot?:'first'|'middle'|'median3',maxWork?:number}} options
 * @returns {{indices:Uint32Array,stats:Readonly<object>}}
 */
export function partitionOrder(input, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('Partition options must be an object');
  for (const key of Object.keys(options)) if (!['pivot', 'maxWork'].includes(key))
    throw new TypeError(`Unknown partition option: ${key}`);
  const { pivot = 'median3', maxWork = 50_000_000 } = options;
  if (!['first', 'middle', 'median3'].includes(pivot)) throw new TypeError('Unknown pivot policy');
  integer(maxWork, 0, MAX_WORK, 'maxWork');
  if (!inputArray(input)) throw new TypeError('Expected an array or Float64Array of finite keys');
  const n = integer(input.length, 0, MAX_ITEMS, 'Key count');
  const capacity = Math.ceil(Math.log2(Math.max(1, n))) + 2;
  const depthLimit = n > 1 ? 2 * Math.floor(Math.log2(n)) : 0;
  const keys = new Float64Array(n), order = new Uint32Array(n);
  const scratch = new Uint32Array(n), tags = new Uint8Array(n);
  const pending = new Uint32Array(3 * capacity);
  const stats = { items: n, pivot, depthLimit, work: 0, comparisons: 0,
    partitions: 0, classified: 0, scatterWrites: 0, copyWrites: 0,
    mergeWrites: 0, fallbacks: 0, pendingPeak: 0,
    typedArrayBytes: keys.byteLength + order.byteLength + scratch.byteLength + tags.byteLength + pending.byteLength };
  function tick() {
    if (stats.work >= maxWork) {
      const error = new RangeError('Partition work limit exceeded; no result published');
      error.code = 'E_PARTITION_WORK';
      throw error;
    }
    stats.work++;
  }
  for (let i = 0; i < n; i++) {
    tick();
    const value = input[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Key ${i} must be finite`);
    keys[i] = value; order[i] = i;
  }
  function compare(a, b) {
    stats.comparisons++;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function pivotKey(lo, hi) {
    const a = keys[order[lo]], b = keys[order[lo + Math.floor((hi-lo)/2)]];
    if (pivot === 'first') return a;
    if (pivot === 'middle') return b;
    const c = keys[order[hi-1]];
    return compare(a, b) < 0
      ? (compare(b, c) < 0 ? b : compare(a, c) < 0 ? c : a)
      : (compare(a, c) < 0 ? a : compare(b, c) < 0 ? c : b);
  }
  function mergeSort(lo, hi) {
    stats.fallbacks++;
    for (let width = 1; width < hi-lo; width *= 2) {
      for (let start = lo; start < hi; start += 2*width) {
        tick();
        const middle = Math.min(start+width, hi), end = Math.min(start+2*width, hi);
        let left = start, right = middle;
        for (let out = start; out < end; out++) {
          tick();
          // Left bias preserves order on equivalent keys, including -0 and +0.
          scratch[out] = right === end || (left < middle && compare(keys[order[left]], keys[order[right]]) <= 0)
            ? order[left++] : order[right++];
          stats.mergeWrites++;
        }
      }
      for (let i = lo; i < hi; i++) { tick(); order[i] = scratch[i]; stats.copyWrites++; }
    }
  }
  let size = 0;
  function push(lo, hi, depth) {
    if (hi-lo < 2) return;
    if (size === capacity) throw new Error('Partition stack invariant failed');
    pending[3*size] = lo; pending[3*size+1] = hi; pending[3*size+2] = depth;
    size++; stats.pendingPeak = Math.max(stats.pendingPeak, size);
  }
  push(0, n, 0);
  while (size) {
    size--;
    let lo = pending[3*size], hi = pending[3*size+1], depth = pending[3*size+2];
    while (hi-lo > 1) {
      tick();
      if (depth >= depthLimit) { mergeSort(lo, hi); break; }
      const value = pivotKey(lo, hi);
      let less = 0, equal = 0;
      stats.partitions++;
      for (let i = lo; i < hi; i++) {
        tick(); stats.classified++;
        const tag = compare(keys[order[i]], value) + 1;
        tags[i] = tag;
        if (tag === 0) less++; else if (tag === 1) equal++;
      }
      if (!equal) throw new Error('Pivot/progress invariant failed');
      if (equal === hi-lo) break;
      const leftEnd = lo+less, rightStart = leftEnd+equal;
      let l = lo, e = leftEnd, g = rightStart;
      for (let i = lo; i < hi; i++) {
        tick();
        const out = tags[i] === 0 ? l++ : tags[i] === 1 ? e++ : g++;
        scratch[out] = order[i]; stats.scatterWrites++;
      }
      for (let i = lo; i < hi; i++) { tick(); order[i] = scratch[i]; stats.copyWrites++; }
      depth++;
      // Recurse immediately into the smaller strict child; the other is a frame,
      // not another allocated sequence. A sole child is processed by the loop.
      if (less < 2) { lo = rightStart; continue; }
      if (hi-rightStart < 2) { hi = leftEnd; continue; }
      if (less < hi-rightStart) { push(rightStart, hi, depth); hi = leftEnd; }
      else { push(lo, leftEnd, depth); lo = rightStart; }
    }
  }
  return { indices: order, stats: Object.freeze(stats) };
}

/** Independent O(n) result check: permutation, order and stability, not cost. */
export function verifyOrder(keys, indices) {
  if (!inputArray(keys) || keys.length > MAX_ITEMS ||
      !(indices instanceof Uint32Array || Array.isArray(indices)) || indices.length !== keys.length) return false;
  const seen = new Uint8Array(keys.length);
  let previousIndex = -1, previousKey;
  for (let position = 0; position < indices.length; position++) {
    const index = indices[position];
    if (!Number.isSafeInteger(index) || index < 0 || index >= keys.length || seen[index]) return false;
    const key = keys[index];
    if (typeof key !== 'number' || !Number.isFinite(key)) return false;
    if (position && (key < previousKey || (key === previousKey && index <= previousIndex))) return false;
    seen[index] = 1; previousIndex = index; previousKey = key;
  }
  return true;
}
