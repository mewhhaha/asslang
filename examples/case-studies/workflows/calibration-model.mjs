import { record, finite } from './common.mjs';

/** Internal coordinate preparation; x and initial have already passed host checks. */
export function scaledCoordinates(x, initial) {
  let lo = x[0], hi = x[0];
  for (const value of x) { lo = Math.min(lo, value); hi = Math.max(hi, value); }
  const center = lo < 0 && hi > 0 ? lo/2 + hi/2 : lo + (hi-lo)/2;
  const scale = Math.max(Math.abs(lo-center), Math.abs(hi-center));
  if (!Number.isFinite(center) || !Number.isFinite(scale) || scale <= 0)
    throw new RangeError('Calibration coordinates need a finite positive scale');
  const values = x.map(value => finite((value-center)/scale, 'normalized x'));
  const gain = finite(initial.gain*scale, 'scaled initial gain');
  const bias = finite(initial.bias + initial.gain*center, 'scaled initial bias');
  return { center, scale, values, gain, bias };
}

/** Capture a portable prediction model without freezing or retaining caller data. */
export function calibrationModel(input) {
  record(input, ['schemaVersion', 'center', 'scale', 'gain', 'bias'], 'calibration model');
  if (input.schemaVersion !== 1) throw new TypeError('Unsupported calibration model version');
  const model = Object.fromEntries(['center', 'scale', 'gain', 'bias'].map(key => [key, finite(input[key], `model.${key}`)]));
  if (model.scale <= 0) throw new RangeError('Calibration model scale must be positive');
  return Object.freeze({ schemaVersion: 1, ...model });
}

// Plain source, not an AD extension. Host and guest use the same operation order.
export const calibrationModelSource = `
  fn model_finite = x -> x-x == 0;
  export fn predict_scaled = (xs:[Num]) ->
    (model:{center:Num,scale:Num,gain:Num,bias:Num}) ->
    require (model_finite model.center && model_finite model.scale && model.scale>0
      && model_finite model.gain && model_finite model.bias)
      (map xs (x -> do {
        let u = (x-model.center)/model.scale;
        let predicted = model.gain*u+model.bias;
        require (model_finite x && model_finite u && model_finite predicted) predicted
      }));
`;
