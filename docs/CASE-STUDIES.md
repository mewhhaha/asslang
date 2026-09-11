# Practical workflows: state, fitting, and evidence

[Documentation](README.md) · [Existing app kernels](../examples/case-studies/README.md)

## Design before implementation

The next step is application code, not another language primitive. Add three
bounded, reusable workflows with caller-supplied JSON, assertion-backed fixtures,
and independently checked results. Hosts handle I/O and orchestration; ordinary
Asslang handles numerical/state work and the generated evidence predicates.
Keep the existing small examples, compiler semantics, and short README intact.

### Resumable sensor monitoring

A scalar-record scan carries `{seen, mean, alarm, raised, cleared}` across chunks.
The first sample seeds the mean; subsequent samples use
`mean + alpha * (sample - mean)` [1]. The alarm turns on at `mean >= high` and
turns off at `mean <= low`, with `low < high`. Count rising and falling edges,
not every sample spent in alarm. Return smoothed values, alarm flags, and the
final state. Check finite inputs/parameters, integral bounded counters and valid
checkpoint invariants even for empty chunks. A failed chunk must not advance the
host's checkpoint. A checkpoint includes a schema version and configuration;
resuming under different parameters must be rejected rather than silently changing
semantics. Checkpoints are explicit data, not authenticated provenance.

The same transition and same initial state imply chunk equivalence by induction
on samples. Chunk boundaries introduce no extra transitions or rounding steps.
This supports a test of exact output/state equality for every split of a sequence,
including empty chunks and JSON checkpoint round trips. The `.ass` kernel is
registered in the existing corpus so the independent interpreter and browser
suite exercise it. This is a fixed-threshold monitor, not a statistical control
chart, medical monitor, or promise of a false-alarm rate.

### Robust line calibration

Fit `y = gain*x + bias` using either squared loss or Huber loss [2]. For residual r,
Huber loss is `r*r/2` when `abs(r) <= delta`, otherwise
`delta*(abs(r)-delta/2)`. A two-field `value_and_grad` computes each sample's loss
and gradient inside an ordinary fold; the code does NOT differentiate a reduction.
The host averages the folded gradients and performs bounded backtracking gradient
descent. A prepared input lease pins x/y once; only gain/bias scalars change.
Dispose in `finally`, then use an ordinary prediction kernel. Report convergence,
iteration limit or line-search stall explicitly; do not claim universal convergence.

Reference checks use the analytic derivative `clip(r,-delta,delta)*(x,1)`, finite
differences away from the Huber join, and a known contaminated-data optimum.
Clean data `x=[-2,-1,0,1,2], y=[-3,-1,1,3,5]` has optimum (2,1).
Replacing the middle y with 21 gives the Huber optimum (2,1.25) at delta=1:
four small residuals equal 0.25 and the central outlier contributes -1 to the
bias derivative. Squared loss instead has optimum (2,5). This is a selected
response-outlier example, not robustness to arbitrary leverage points or a
calibration certification. Huber thresholds require domain-specific scaling.
AD source remains a named JS-held source fragment because the existing corpus
interpreter does not implement differentiation; dedicated analytic and browser
checks must cover it without skipping any existing corpus assertion.

### Release-readiness evidence

Consume candidate, CI, artifact and approval receipts supplied by the caller.
A host compares revision/digest identity; a pure kernel evaluates readiness.
A law-aware presentation exposes two aliases for CI readiness, artifact readiness
and approval. Infer additional requirements relative to CI, but always recheck
the actual CI guarantee when deciding readiness. Reject contradictory submitted
claims using the derived laws, and reject even law-consistent claims when they
differ from current receipt-derived summaries. Missing requirements are a report,
not an exception; malformed or contradictory input is an error.

The decision is exactly: current CI revision, at least one passed test, zero failed
tests, matching artifact revision/digest, and approval for the candidate revision.
A truth-table oracle must compare this direct conjunction with generated predicates.
Receipts are not fetched, signed, or authenticated. This is preflight computation,
not deployment automation, authorization or supply-chain verification. It creates
no host capabilities and performs no external action.

## Representation, API and resource boundaries

Place reusable modules, source fragments, JSON inputs and a CLI under
`examples/case-studies/workflows/`. Export a resumable monitor factory and callable
calibration/release workflows. Keep work and JSON size bounded: at most 4,096
samples per kernel call, 16,384 samples per monitor request, 256 chunks, a fixed
16-page runtime arena, and 100,000 emitted loop iterations per invocation by default.
Allow at most 200 fitting updates with 16 backtracking attempts per update. The
host bound and Wasm loop budget are separate; neither is a wall-clock sandbox.
Strictly validate known request fields, finite numbers, counts and booleans.
The CLI reads at most 1 MiB and rejects nonfinite JSON results, invalid options,
unknown case IDs and path-based source selection. Its fixed case IDs are not an
implicit compiler loader. Show usage, sample output and embedding imports.

Preserve syntax, inference, ASABI, source linking, demand, event provenance,
capability enforcement, defaults and resource policies. No files under `src/`,
dependencies or workflow permissions need changing. Code-generating examples
use existing named-source APIs. Browser tests cover the new pure kernels and
evidence predicates; host JSON/lease/checkpoint behavior has Node subprocess tests.

## Validation plan

Baseline main `bf6edab16e1116a4db5c1697e13d4eb2b6c03c70` has tree
`e703fba198bdaf94c0b3c00c00f6cc4837340b45`. The CI source archive reconstructs that
exact tree. The unchanged baseline passed 1,168 Node tests before these edits.

Compare scalar and SIMD, fusion and memoization combinations. Test empty chunks,
checkpoint round trips, every split, alarm thresholds, invalid state/parameters,
nonfinite samples and recovery after traps. Check calibration analytic gradients,
finite differences, known clean/contaminated optima, loss descent, convergence
status, mismatched/empty/constant-x data, lease snapshots and budget exhaustion.
Exhaust release truth tables and derived-law cases, including stale revisions,
contradictory aliases, law-consistent stale claims and missing guarantees.

Run each documented CLI input through a subprocess; reject unknown/malformed/
oversized requests with no partial JSON output. Add examples to normal discovery,
check docs links, run the full Node suite, host/reducer examples and the available
Chromium harness. Report actual counts in a new report, not in the root README.
No speedup, novel estimator, proof-assistant check or deployed-service claim.

## Algorithm references

[1] NIST/SEMATECH e-Handbook, [EWMA Control Charts](https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc324.htm).
Used for the smoothing recurrence, not its statistical control-limit methodology.

[2] SciPy reference, [Huber loss](https://docs.scipy.org/doc/scipy/reference/generated/scipy.special.huber.html).
Used for the piecewise loss definition; SciPy is not an Asslang dependency.
