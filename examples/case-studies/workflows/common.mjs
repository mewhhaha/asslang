// Small host boundary for these examples, not a replacement for ASABI validation.
export const MAX_SAMPLES = 4096;
export const MAX_REQUEST_SAMPLES = 16384;
export const RUNTIME_PAGES = 16;
export const DEFAULT_LOOP_BUDGET = 100000;

export function record(value, allowed, label) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`Unknown ${label} field: ${key}`);
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) throw new TypeError(`${label} must contain data, not getters`);
  }
  return value;
}
export function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
  return value;
}
export function integer(value, low, high, label) {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw new RangeError(`${label} must be an integer in [${low}, ${high}]`);
  return value;
}
export function boolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be Boolean`);
  return value;
}
export function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new TypeError(`${label} must be nonempty text of at most 256 characters`);
  return value;
}
export function samples(value, label, limit = MAX_SAMPLES) {
  if (!Array.isArray(value) && !(value instanceof Float64Array)) throw new TypeError(`${label} must be a numeric array`);
  integer(value.length, 0, limit, `${label} length`);
  return Array.from(value, (v, i) => finite(v, `${label}[${i}]`));
}
export function lowering(options = {}) {
  record(options, ['simd', 'reductionFusion', 'memoizeReductions', 'maxLoopIterations'], 'compiler options');
  const { maxLoopIterations = DEFAULT_LOOP_BUDGET, ...rest } = options;
  return { ...rest, maxLoopIterations };
}
export function json(value) {
  return JSON.stringify(value, (_, v) => {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new TypeError('Nonfinite result cannot be represented in JSON');
    return ArrayBuffer.isView(v) ? Array.from(v) : v;
  });
}
