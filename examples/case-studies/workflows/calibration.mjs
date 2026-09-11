import { compileSources } from '../../../src/compiler.mjs';
import { createRuntime } from '../../../src/abi.mjs';
import { calibrationSource } from './calibration-kernel.mjs';
import { record, finite, integer, samples, lowering, RUNTIME_PAGES } from './common.mjs';

/** Bounded backtracking fit. Host controls iterations; Wasm computes per-sample AD.
 * Status is explicit: gradient tolerance, iteration limit, or stalled search.
 * Loss descent is checked, not universal convergence or statistical validity.
 */
export async function fitCalibration(input, options = {}) {
  record(input, ['x', 'y', 'loss', 'delta', 'initial', 'maxIterations', 'tolerance', 'step'], 'calibration request');
  const x = samples(input.x, 'x'), y = samples(input.y, 'y');
  if (x.length < 2 || x.length !== y.length) throw new RangeError('Calibration requires equally sized x/y arrays with at least two samples');
  if (x.every(v => v === x[0])) throw new RangeError('Calibration needs at least two distinct x values');
  const loss = input.loss ?? 'huber';
  if (loss !== 'huber' && loss !== 'squared') throw new TypeError('loss must be huber or squared');
  const delta = finite(input.delta ?? 1, 'delta');
  const step = finite(input.step ?? 1, 'step');
  const tolerance = finite(input.tolerance ?? 1e-8, 'tolerance');
  const maxIterations = integer(input.maxIterations ?? 100, 0, 200, 'maxIterations');
  if (!(delta > 0 && step > 0 && tolerance > 0)) throw new RangeError('delta, step and tolerance must be positive');
  const initial = input.initial ?? { gain: 0, bias: 0 };
  record(initial, ['gain', 'bias'], 'initial coefficients');
  let gain = finite(initial.gain, 'initial.gain'), bias = finite(initial.bias, 'initial.bias');
  const compiled = compileSources([{ name: 'calibration.kernel.ass', source: calibrationSource }], lowering(options));
  const runtime = await createRuntime(compiled, { pages: RUNTIME_PAGES });
  const lease = runtime.prepare('loss_gradient', [x, y, gain, bias, delta, loss === 'huber']);
  let value, initialLoss, status = 'iteration-limit', iterations = 0, evaluations = 0;
  const history = [];
  const evaluate = (gain, bias) => { evaluations++; return lease.run({ gain, bias }); };
  try {
    value = evaluate(gain, bias); initialLoss = value.loss;
    history.push({ iteration: 0, loss: value.loss, rate: 0 });
    while (true) {
      const gradient = value.gradient;
      if (Math.max(Math.abs(gradient.gain), Math.abs(gradient.bias)) <= tolerance) { status = 'converged'; break; }
      if (iterations >= maxIterations) break;
      const normSquared = finite(gradient.gain*gradient.gain + gradient.bias*gradient.bias, 'gradient norm');
      let rate = step, accepted = false;
      for (let attempt = 0; attempt < 16; attempt++, rate /= 2) {
        const nextGain = gain - rate*gradient.gain, nextBias = bias - rate*gradient.bias;
        if (!Number.isFinite(nextGain) || !Number.isFinite(nextBias)) continue;
        const next = evaluate(nextGain, nextBias);
        if (next.loss < value.loss && next.loss <= value.loss - 1e-4*rate*normSquared) {
          gain = nextGain; bias = nextBias; value = next; accepted = true; break;
        }
      }
      if (!accepted) { status = 'line-search-stalled'; break; }
      iterations++;
      history.push({ iteration: iterations, loss: value.loss, rate });
    }
  } finally { lease.dispose(); }
  return { lossFunction: loss, coefficients: { gain, bias }, initialLoss, loss: value.loss,
    gradient: value.gradient, status, iterations, evaluations, history,
    predictions: runtime.call('predict', [x, gain, bias]) };
}
