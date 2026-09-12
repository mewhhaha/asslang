import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { supportsSIMD } from '../../../src/compiler.mjs';
import { runMonitor } from './monitor.mjs';
import { fitCalibration } from './calibration.mjs';
import { evaluateRelease } from './release.mjs';
import { json } from './common.mjs';
const fixture = async name => JSON.parse(await readFile(new URL(`./inputs/${name}.json`, import.meta.url), 'utf8'));
for (const simd of supportsSIMD() ? [false, true] : [false]) {
  const monitor = await runMonitor(await fixture('monitor'), { simd });
  assert.deepEqual(monitor.smoothed, [0, 4, 6, 3, 1.5]);
  assert.deepEqual(monitor.alarms, [false, false, true, false, false]);
  const input = await fixture('calibration');
  const huber = await fitCalibration(input, { simd });
  const squared = await fitCalibration({ ...input, loss: 'squared' }, { simd });
  assert(Math.abs(huber.coefficients.gain - 2) < 1e-6 && Math.abs(huber.coefficients.bias - 1.25) < 1e-6);
  assert(Math.abs(squared.coefficients.bias - 5) < 1e-6);
  const scaled = await fitCalibration(await fixture('calibration-offset'), { simd });
  assert.equal(scaled.status, 'converged');
  assert(Math.abs(scaled.model.gain - 4) < 1e-6 && Math.abs(scaled.model.bias - 1.25) < 1e-6);
  const releaseInput = await fixture('release');
  const stale = await evaluateRelease(releaseInput, { simd });
  const approved = await evaluateRelease({ ...releaseInput, approval: { revision: releaseInput.candidate.revision, approved: true } }, { simd });
  assert(!stale.ready && approved.ready);
  console.log(json({ simd, monitor,
    calibration: { huber: huber.coefficients, squared: squared.coefficients, huberStatus: huber.status, scaledModel: scaled.model },
    release: { staleApproval: stale, currentApprovalReady: approved.ready } }));
}
