# Scaled calibration validation

[Design and usage](CALIBRATION-COORDINATES.md) · [Validation index](EVIDENCE.md)

## Source and scope

Based on merged main `22637d753d87dd38f575e80fc435d35204255d25`, tree
`dd43ae7f0d80f95037a61ec08286d5bfd1a31417`, reconstructed from the supplied archive
and checked against the GitHub connection. The unchanged baseline passed all
1,226 Node tests. A design-only commit precedes implementation and tests.

This adds optional scaled fitting and persistent centered-model prediction to
an existing case study. No files under `src/`, original AD kernel, type/ABI rules,
compiler policy, dependencies or workflow permissions change. Raw remains default.
Historical validation reports and the short root README are unchanged.

## Executed local checks

September 12, 2026: Node v22.16.0, Linux x64, Chromium 144.0.7559.96.
Local execution is separate from remote GitHub CI status.

| Check | Result |
| --- | --- |
| Unchanged baseline `npm test` | 1,226 passed; zero failures/skips |
| Final `npm test` | 1,245 passed; zero failures/skips |
| `npm run test:calibration-coordinates` | 19 passed |
| `npm run test:docs` | 26 passed |
| `npm run test:browser` | 1,512 core + 276 experiment checks passed |
| `npm run test:browser:http` | Attempted; policy blocked navigation |
| New coordinate example, workflow runner, existing case studies | Passed |
| Required host/reducer example runners and example build | Passed |
| Actual-baseline comparison | 56 raw results equal; 16 Wasm builds byte-identical |
| Changed/new JS syntax and `git diff --check` | Passed |

The browser suite contains 138 experiment cases. Both browser harnesses register
the new checks. The native HTTP attempt failed with
`net::ERR_BLOCKED_BY_ADMINISTRATOR`; no policy was changed or bypassed.
The 28 new assertions execute the complete fitting host, Wasm AD, model JSON
round trip and prediction in Chromium across four SIMD/fusion configurations.
They also check prediction budgets, post-trap reuse and invalid empty-input models.
This is more than a kernel-only browser fixture, but is not testing browser UI,
worker loading, other engines, throughput or HTTP behavior.

## Reproduced pain point and improvement

For x=[999999998,999999999,1e9,1000000001,1000000002] and
y=[-3,-1,21,3,5], default raw Huber fitting stalls before its first update at
mean loss 6.1. With only `coordinates:'scaled'` changed, it converges in 31
updates at mean loss 3.875, with center 1e9, scale 2, normalized gain
3.9999999824749306 and normalized bias 1.25. The optimizer's gain gradient is
approximately -8.76e-9 and bias gradient is zero. New-point predictions at
[1e9-2,1e9,1e9+3] are approximately [-2.75,1.25,7.25].

This selected response-outlier problem has an independently known minimizing
line, not a reference inferred from the implementation's own output. Positive
unit/origin changes (including a 128-fold scale and a 1/128 scale) give identical
normalized histories and predictions on exactly representable test data. The
original y units, Huber delta, iteration limit and 16-trial line search stay fixed.

The raw unshifted fixture converges in fewer updates than this scaled fixture;
scaling is not universally faster. On the contaminated squared-loss problem,
default tolerance 1e-8 can report `line-search-stalled` near the optimum because
strict loss descent rounds away before the gradient threshold is reached. Tests
retain that honest status. With explicit tolerance 1e-6 the tested squared fits
converge near their independent optimum (normalized gain=4,bias=5). Clean data
converges to its corresponding exact-line model. No tolerance or search bound
was raised silently to manufacture success.

## Mathematical and numerical validation

Across all eight SIMD/fusion/memoization configurations, tests cover the shifted
Huber regression, transformed input units, clean and contaminated optima, gradient
stopping and strict accepted-step descent. A separate seeded family checks 320
AD cases against an analytic clipped-residual/squared derivative. It checks both
coefficient-gradient transport and the directional pairing law; central finite
differences corroborate the directional derivatives. This test does not use the
implementation's transformed gradient as its expected value.

Original-unit nonzero initial coefficients map to matching normalized starts.
Raw gradients and normalized gradients are explicitly distinguished; the returned
status uses only the latter in scaled mode. The derivation in the design document
proves objective equivalence and the gradient law over reals. Rounding, overflow,
underflow and conditioning are explicit limitations, not solved by that proof.

A centered model at origin 1e16 retains a 1.25 prediction at the center, while
converting its coefficients to a large canceling raw intercept yields zero there.
The saved-model predictor retains the centered result after JSON serialization.
Extreme endpoints at +/-Number.MAX_VALUE normalize without squaring or overflowing
the range width. Subnormal distinct inputs use a positive scale without an epsilon
substitute; their primary fit remains usable even when the raw slope projection
is infinite and `coefficients` is null. A separate finite-loss case exercises
an overflowing raw gradient projection returning null. These are explicit
boundary cases, not a general floating-point accuracy guarantee.

## Model, runtime and input boundaries

Model fields and version are validated on the host; guest guards also enforce
finite positive scale and finite parameters on empty predictions. Nonfinite
inputs, normalized values and predictions trap rather than saturate. Finite
inputs with an overflowing extrapolation difference are deliberately rejected.
Tests cover unknown fields/modes, nonfinite model fields, getters, sparse arrays,
invalid initial conversions and existing size/iteration limits. Results do not
freeze caller data or retain mutable model aliases. JSON does not claim arbitrary
signed-zero preservation or model authenticity.

Exact three-sample prediction budgets succeed, while two units cannot process
three samples; smaller subsequent calls recover. Raw Wasm calls use the actual
ABI arena/descriptor machinery. The existing scalar/SIMD metering rules remain
in force. Wrong types, pure host calls and source-local errors keep ordinary
compiler diagnostics. A 4,096-sample scaled fit runs within the fixed arena and
converges on its constructed exact-line data. Zero fitting allowance still traps;
the existing prepared-lease finally/disposal path is unchanged.

The first source-location fixture incorrectly used an unsupported Asslang empty
array literal. The test was corrected to `range 0`; parser rules were not changed.
All focused checks then passed. The published embedding snippet is extracted
from the Markdown and executed directly. CLI subprocesses test the offset-fit
fixture, saved-model prediction fixture, malformed JSON, malformed models and
unsupported fields with no partial JSON output. The ordinary workflow runner
now includes the scaled regression alongside its original examples.

## Compatibility and limitations

An independent checkout of the actual baseline compared seven existing raw-fit
requests across all eight lowering settings: all 56 complete result objects
match. Compiling the unchanged AD kernel across those settings with and without
a loop allowance yields 16 byte-identical binaries. Explicit `'raw'` is separately
compared to omission. These are finite compatibility checks, not all-program
proofs, though no core compiler or original kernel file changes in this PR.

Normalization is a bounded O(n) host pass and additional copied x array; it is not
guest-metered work. Fitting still pins only a bounded dataset, with up to 200
updates and 16 trial steps each. The model predictor compiles on each helper call;
no cross-call cache or prediction service is introduced. A finite raw projection
can still be inaccurate; use the primary model for inference. Nearly singular
samples, poorly scaled responses, extreme extrapolation and floating-point stalls
remain possible. Huber loss does not solve arbitrary leverage outliers.

Coordinate scaling is established numerical analysis, not a new optimizer or
category-theory discovery. No throughput improvement, universal convergence,
proof-assistant verification, independent numerical audit or production calibration
certification is claimed. Remote publication identifiers and CI status are recorded
separately in the PR discussion.
