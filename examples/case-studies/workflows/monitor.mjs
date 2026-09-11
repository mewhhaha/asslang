import { readFile } from 'node:fs/promises';
import { compileSources } from '../../../src/compiler.mjs';
import { createRuntime } from '../../../src/abi.mjs';
import { record, finite, integer, boolean, samples, lowering, RUNTIME_PAGES, MAX_REQUEST_SAMPLES } from './common.mjs';

export const initialMonitorState = Object.freeze({ seen: 0, mean: 0, alarm: false, raised: 0, cleared: 0 });
const configKeys = ['alpha', 'low', 'high'];
function configuration(input) {
  record(input, configKeys, 'monitor config');
  const config = Object.fromEntries(configKeys.map(k => [k, finite(input[k], k)]));
  if (!(config.alpha > 0 && config.alpha <= 1 && config.low < config.high)) throw new RangeError('Monitor needs 0 < alpha <= 1 and low < high');
  return Object.freeze(config);
}
function state(input) {
  record(input, ['seen', 'mean', 'alarm', 'raised', 'cleared'], 'monitor state');
  return { seen: 0 + integer(input.seen, 0, 1e9, 'seen'), mean: input.mean === 0 ? 0 : finite(input.mean, 'mean'),
    alarm: boolean(input.alarm, 'alarm'), raised: 0 + integer(input.raised, 0, 1e9, 'raised'), cleared: 0 + integer(input.cleared, 0, 1e9, 'cleared') };
}

/** Reusable in one host; checkpoints can be serialized and restored in a new one.
 * A process failure leaves the last successful checkpoint unchanged.
 */
export async function createMonitor(config, checkpoint = null, options = {}) {
  config = configuration(config);
  let current = { ...initialMonitorState };
  if (checkpoint !== null) {
    record(checkpoint, ['schemaVersion', 'config', 'state'], 'checkpoint');
    if (checkpoint.schemaVersion !== 1) throw new TypeError('Unsupported monitor checkpoint version');
    const saved = configuration(checkpoint.config);
    if (configKeys.some(k => saved[k] !== config[k])) throw new TypeError('Checkpoint configuration differs from this monitor');
    current = state(checkpoint.state);
  }
  const source = await readFile(new URL('./monitor.ass', import.meta.url), 'utf8');
  const compiled = compileSources([{ name: 'monitor.ass', source }], lowering(options));
  const runtime = await createRuntime(compiled, { pages: RUNTIME_PAGES });
  // Validate algebraic counter invariants even when no samples are processed.
  runtime.call('monitor_chunk', [[], current, config]);
  const snapshot = () => Object.freeze({ schemaVersion: 1, config, state: Object.freeze({ ...current }) });
  return Object.freeze({
    checkpoint: snapshot,
    process(input) {
      const result = runtime.call('monitor_chunk', [samples(input, 'samples'), current, config]);
      current = result.state; // Commit only after the whole kernel succeeds.
      return { smoothed: result.smoothed, alarms: result.alarms, checkpoint: snapshot() };
    },
  });
}

export async function runMonitor(input, options = {}) {
  record(input, ['config', 'chunks', 'checkpoint'], 'monitor request');
  if (!Array.isArray(input.chunks)) throw new TypeError('chunks must be an array');
  integer(input.chunks.length, 0, 256, 'chunk count');
  const chunks = input.chunks.map((v, i) => samples(v, `chunks[${i}]`));
  integer(chunks.reduce((n, chunk) => n + chunk.length, 0), 0, MAX_REQUEST_SAMPLES, 'total samples');
  const monitor = await createMonitor(input.config, input.checkpoint ?? null, options);
  const smoothed = [], alarms = [];
  for (const chunk of chunks) {
    const result = monitor.process(chunk);
    smoothed.push(...result.smoothed); alarms.push(...result.alarms);
  }
  return { smoothed, alarms, checkpoint: monitor.checkpoint() };
}
