# Calibration in scaled coordinates

[Practical workflows](CASE-STUDIES.md) · [Documentation](README.md)

## Pain point and compatibility

The existing bounded fitter can stall solely because a predictor has a large
origin. On merged main `22637d753d87dd38f575e80fc435d35204255d25`, fitting
x = [999998,999999,1000000,1000001,1000002] and y = [-3,-1,21,3,5]
with the default Huber settings stops before its first update, at mean loss 6.1.
The same observations with one million subtracted from x converge. Raising the
iteration limit cannot help a line search which accepts no first step.

Add an explicit `coordinates: 'scaled'` option to the example's `fitCalibration`
request. Omission and `'raw'` preserve its previous code path, results, gradient
meaning and stopping criterion. Do not silently change tolerance units or optimizer
behavior for existing callers. This is numerical preconditioning of an existing
example, not a new estimator, compiler intrinsic or universal convergence claim.
The original calibration kernel, loss policy and AD implementation remain intact.

## Exact-real change of coordinates and gradient transport

Given finite nonconstant x, choose center c at the midrange and positive scale s
as the maximum distance of an endpoint from c. Define u = (x-c)/s. Over real
numbers, |u| <= 1. Fit the affine model m*u + q rather than g*x + b, with

    m = s*g, q = b+c*g;       g = m/s, b = q-c*m/s.

This is an invertible affine reparameterization when s>0. Substitution establishes
`m*((x-c)/s)+q = g*x+b` for each datum. Therefore every residual, Huber/squared
loss, and real-valued minimizing line is unchanged. Response y and Huber delta
stay in their original units: there is no loss rescaling or outlier relabeling.
The chain rule gives

    dL/dg = s*dL/dm + c*dL/dq;    dL/db = dL/dq.

For an arbitrary coefficient direction (dg,db), its transformed direction is
(s*dg, db+c*dg). Pairing either gradient with its corresponding direction gives
the same directional derivative. This provides an independently testable
transport law, separate from matching a few fitted coefficients.

Positive affine changes of input units x' = a*x+k transform c'=a*c+k and s'=a*s,
so u'=u in real arithmetic. With corresponding initial predictions, both scaled
fits have the same optimization problem. Float rounding can break exact identities;
tests use exactly representable offsets/scales where appropriate and tolerances
otherwise. The implementation does not reassociate guest arithmetic or claim that
raw and anchored predictions are bit-identical.

For squared loss, the scaled parameter Hessian is the mean of (u,1)(u,1)^T,
whose spectral norm is at most 2. Huber loss has a one-Lipschitz residual derivative
and yields the same gradient-Lipschitz upper bound for real u in [-1,1]. This
explains why the new coordinates remove large-origin curvature from the optimizer;
it does not establish convergence within a fixed iteration budget, well-conditioned
arbitrary data, statistical identifiability of a Huber optimum, or correctness
under floating-point overflow. The bounded line search/status contract remains.

## Floating-point representation and persistence

Use a same-sign midpoint `lo+(hi-lo)/2`, or `lo/2+hi/2` across zero to avoid
endpoint overflow. Measure radius from the endpoints without squaring distances.
Reject nonfinite/nonpositive scale or nonfinite normalized coordinates. Distinct
subnormal inputs need not be rejected merely because their half-width underflows;
the maximum endpoint distance stays positive. No clamping or epsilon scale is
silently substituted. Finite x can still overflow during extreme extrapolation;
that is an explicit error, not a saturating predictor.

Persist the primary fitted model as
`{schemaVersion:1, center, scale, gain, bias}`. Here gain=m and bias=q; evaluation
is always `gain*((x-center)/scale)+bias`. Retaining the center avoids needlessly
converting a well-scaled model into two large canceling raw coefficients.
All fields are finite; scale is strictly positive. The model is immutable on
return, JSON-serializable, ordinary data, and not a proof or authority token.

Scaled results retain `coefficients` in original x units when both projections
are finite, otherwise null. The old-unit `gradient` follows the transport formula
when finite, otherwise null. These are convenience projections; prediction and
convergence must not depend on their representability. An additional
`optimizerGradient` reports dL/d(m,q), and `coordinateSystem:'scaled'` declares
that the unchanged tolerance tests this gradient's infinity norm. A small scaled
gradient need not imply a small raw gradient. Loss/history describe the scaled
model; cancellation in a projected raw intercept may worsen its predictions.

`initial` remains an original-unit `{gain,bias}`. Convert it before acquiring a
lease and reject nonfinite conversions. This PR does not add model-based restart,
automatic raw/scaled selection, centering of y, or new stopping criteria.

## Implementation boundary

Normalize a validated copy of x once on the host and pin it in the existing
prepared input lease. Reuse the unchanged per-sample AD/fold and bounded update
loop. Dispose the lease in `finally`, including on traps. Build a separate named
Asslang source fragment for anchored prediction and call it after fitting. Its
expression matches host normalization, checks finite inputs/intermediates/results,
and validates the model even for empty predictions. It adds no core API or ABI
kind. Export a host `predictCalibration(model, x, options)` and a fixed CLI case
`calibration-predict` accepting `{model,x}`. Do not add a dynamic path loader.

Existing host limits remain: 4,096 samples, 200 updates, 16 trial rates per update,
1 MiB CLI input, 16 memory pages, and default 100,000 loop units per invocation.
Normalization takes one bounded host pass and one additional x snapshot; it is
not charged as guest loop work. Model prediction uses the ordinary Wasm budget.
No increased search budgets, dependencies, workflow permissions, compiler options,
source-language semantics or historical validation reports are required.

## Validation plan and references

The unchanged reconstructed baseline matches tree
`dd43ae7f0d80f95037a61ec08286d5bfd1a31417` and passed 1,226 Node tests.
Before publishing, test raw compatibility against that actual baseline, not just
another mode of the new code. Reproduce the stalled large-origin problem and
compare scaled fits with independently known clean/contaminated optima. Check
positive unit changes, transformed initial values, gradient chain/pairing laws,
analytic gradients and finite differences in all eight lowering configurations.
Test model JSON round trips, new points, invalid models, extreme endpoints,
subnormals, raw-projection overflow, empty input, exact loop allowances, source-local
errors, effects, typed fields, lease cleanup, bounded failure statuses and CLI
subprocesses. Execute published examples; register real-browser kernel tests.
Run full Node, host/reducer examples, and available browser suites. Record actual
results in a new report; do not describe proposed checks as passed.

Coordinate scaling and domain-aware polynomial representations are established
numerical techniques. References checked September 12, 2026:

- SciPy, least_squares, `x_scale` explains optimization in scaled variables:
  https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.least_squares.html
- NumPy, Polynomial.fit, explains fitting in a chosen domain and conditioning:
  https://numpy.org/doc/2.0/reference/generated/numpy.polynomial.polynomial.Polynomial.fit.html

These sources motivate the approach, not the correctness of this code. NumPy and
SciPy are not dependencies. The algebraic argument and finite validation do not
constitute proof-assistant verification or an independent numerical audit.
