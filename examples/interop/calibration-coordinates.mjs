import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fitCalibration, predictCalibration } from '../case-studies/workflows/calibration.mjs';
import { json } from '../case-studies/workflows/common.mjs';

const input = JSON.parse(await readFile(new URL('../case-studies/workflows/inputs/calibration-offset.json', import.meta.url), 'utf8'));
const raw = await fitCalibration({ ...input, coordinates: 'raw' });
const scaled = await fitCalibration(input);
const saved = JSON.parse(JSON.stringify(scaled.model));
const predictions = await predictCalibration(saved, [1e9-2, 1e9, 1e9+3]);
assert.equal(raw.status, 'line-search-stalled');
assert.equal(raw.iterations, 0);
assert.equal(scaled.status, 'converged');
assert(Math.abs(saved.gain-4) < 1e-6 && Math.abs(saved.bias-1.25) < 1e-6);
assert.deepEqual(predictions, await predictCalibration(scaled.model, [1e9-2, 1e9, 1e9+3]));
console.log(json({
  raw: { status: raw.status, iterations: raw.iterations, loss: raw.loss },
  scaled: { status: scaled.status, iterations: scaled.iterations, loss: scaled.loss,
    model: saved, optimizerGradient: scaled.optimizerGradient },
  newPointPredictions: predictions,
  note: 'Same response units and Huber delta; convergence is checked in scaled coefficient coordinates. No timing claim.',
}));
