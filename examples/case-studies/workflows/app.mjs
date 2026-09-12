// Fixed workflow registry. No paths, expressions or compiler flags from JSON.
import { runMonitor } from './monitor.mjs';
import { fitCalibration, predictCalibration } from './calibration.mjs';
import { evaluateRelease } from './release.mjs';
import { json, record } from './common.mjs';

const predictRequest = async (input, options) => {
  record(input, ['model', 'x'], 'prediction request');
  return { predictions: await predictCalibration(input.model, input.x, options) };
};
const workflows = new Map([['monitor', runMonitor], ['calibration', fitCalibration], ['calibration-predict', predictRequest], ['release', evaluateRelease]]);
const usage = 'Usage: node examples/case-studies/workflows/app.mjs monitor|calibration|calibration-predict|release [--simd] < request.json';
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  const [name, ...flags] = args;
  if (!workflows.has(name) || flags.length > 1 || flags.some(f => f !== '--simd')) throw new TypeError(usage);
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024*1024) throw new RangeError('JSON input exceeds 1 MiB');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const result = await workflows.get(name)(input, { simd: flags.includes('--simd') });
  console.log(json(result)); // A complete report; malformed requests never print partial JSON.
  if (name === 'release' && !result.ready) process.exitCode = 2;
}
try { await main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
