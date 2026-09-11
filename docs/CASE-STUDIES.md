# Practical workflows: state, fitting, and evidence

[Documentation](README.md) · [Existing app kernels](../examples/case-studies/README.md)

## Run the studies

Use Node 22+ in a source checkout. Each CLI request is a JSON **object**, not an
array of raw export arguments. There is no network dependency or setup service.

```sh
npm run example:workflows
node examples/case-studies/workflows/app.mjs monitor < examples/case-studies/workflows/inputs/monitor.json
node examples/case-studies/workflows/app.mjs calibration < examples/case-studies/workflows/inputs/calibration.json
node examples/case-studies/workflows/app.mjs release < examples/case-studies/workflows/inputs/release.json
```

The last fixture intentionally has stale approval. It prints `ready:false` with
`candidate-approval-required` and exits **2**. A ready release exits 0. Malformed
input exits 1 with no JSON result; no command deploys anything. `--simd` after the
case ID enables the compiler option without promising a speedup for these kernels.

| Study | Fixture result | Capabilities demonstrated |
| --- | --- | --- |
| Monitor | Means `[0,4,6,3,1.5]`; one alarm raised and cleared across three chunks. | Causal record state, checkpointing, independently owned array results. |
| Calibration | Huber gain approximately 2, bias approximately 1.25; squared loss bias 5 on the same outlier fixture. | Staged loss-policy dictionary, per-sample product AD, prepared inputs, bounded host optimization. |
| Release | Stale approval blocks readiness; matching approval enables it. Contradictory aliases are rejected. | Law-aware presentations, relative requirements, generated predicates, explicit current-data checks. |

### Embed a monitor and resume it

Save the following JS in the repository root. `process` accepts one finite numeric
array of at most 4,096 samples. Its returned checkpoint can be serialized and used
by another instance. Reuse a live monitor to avoid recompiling each chunk.

<!-- workflow-example: monitor -->
```js
import { createMonitor } from './examples/case-studies/workflows/monitor.mjs';

const config = {alpha: 0.5, low: 3, high: 6};
const first = await createMonitor(config);
const saved = JSON.parse(JSON.stringify(first.process([0, 8]).checkpoint));
const resumed = await createMonitor(config, saved);
const result = resumed.process([8, 0, 0]);
console.log(JSON.stringify({means: Array.from(result.smoothed), state: result.checkpoint.state}));
```

The means are `[6,3,1.5]`; final state has `seen:5`, `raised:1`, `cleared:1` and
`alarm:false`. An empty chunk preserves state. Nonfinite samples are rejected,
not dropped. Configuration is part of the checkpoint; do not reuse state with a
different smoothing factor or threshold pair. Samples represent equally spaced
events; the monitor does not infer timestamps or normalize irregular intervals.

The batch request is `{config, chunks, checkpoint?}`. Output is
`{smoothed, alarms, checkpoint}`; `alarms` marks every sample's alarm state,
while `raised` and `cleared` count transitions. See the [kernel](../examples/case-studies/workflows/monitor.ass)
and [host](../examples/case-studies/workflows/monitor.mjs).

### Fit a robust calibration line

<!-- workflow-example: calibration -->
```js
import { fitCalibration } from './examples/case-studies/workflows/calibration.mjs';

const fit = await fitCalibration({
  x: [-2, -1, 0, 1, 2], y: [-3, -1, 21, 3, 5],
  loss: 'huber', delta: 1, maxIterations: 100,
});
console.log(JSON.stringify({status: fit.status, ...fit.coefficients}));
```

This fixture converges near `{gain:2,bias:1.25}`. Change `loss` to `squared` to
see the response outlier move the fitted bias to 5. A clean middle sample of 1
instead gives gain 2 and bias 1. The host never differentiates the optimizer:
only the scalar sample objective is passed to `value_and_grad` inside a fold.

Required fields are `x` and `y`, matching finite arrays with at least two samples
and at least two distinct x values. Optional fields are `loss` (`huber`/`squared`),
`delta` (default 1), `initial` (`{gain:0,bias:0}`), `maxIterations` (100),
`tolerance` (1e-8, gradient infinity norm), and `step` (1). Positive finite controls
are required; each update tries at most 16 step halvings. Poor scaling or floating-
point stagnation can prevent convergence. Inspect `status`: `converged`,
`iteration-limit`, or `line-search-stalled`. The latter two are valid bounded-fit
reports, not silent successes or malformed-input errors.

Output includes coefficients, initial/final loss, the final gradient, predictions,
iteration/evaluation counts and accepted-step history. Each accepted step strictly
lowers the same objective. Input arrays are pinned in one lease; scalar overrides
do not persist, so each evaluation supplies both coefficients. Lease disposal
happens in `finally` before prediction. See [source](../examples/case-studies/workflows/calibration-kernel.mjs)
and [orchestration](../examples/case-studies/workflows/calibration.mjs).

### Check current release receipts

<!-- workflow-example: release -->
```js
import { createReleaseGate } from './examples/case-studies/workflows/release.mjs';

const gate = await createReleaseGate();
const receipts = {
  candidate: {revision: 'rev-42', digest: 'artifact-42'},
  ci: {revision: 'rev-42', passed: 120, failed: 0},
  artifact: {revision: 'rev-42', digest: 'artifact-42'},
  approval: {revision: 'rev-41', approved: true},
};
const before = gate.evaluate(receipts);
receipts.approval.revision = 'rev-42';
const after = gate.evaluate(receipts);
console.log(JSON.stringify({before: before.ready, reasons: before.reasons, after: after.ready}));
```

Output is `before:false`, reason `candidate-approval-required`, and `after:true`.
These are supplied receipts, not calls to a CI, signing, approval or deployment
service. Revision and digest values are opaque identifiers matched exactly; the
example does not hash artifacts or verify signatures. A real host must authenticate
and obtain those receipts from its trusted systems before using this computation.

The candidate is required; missing/null `ci`, `artifact` or `approval` receipts
produce an ordinary not-ready report. Present receipts need the fields shown above.
`minPassed` defaults to 1. Optional `claims` must contain the four Booleans
`{ciReady,testedBuild,artifactReady,approval}`. Both contradictory aliases and
law-consistent claims that disagree with the current receipts are rejected.
Output includes `ready`, the private Boolean facts, derived public summaries and
machine-readable unmet-requirement codes. This never treats a public flag as
proof or optimistically skips the current CI guarantee after residuation.
See the [presentation builder](../examples/case-studies/workflows/release-kernel.mjs)
and [host](../examples/case-studies/workflows/release.mjs).

All three reusable APIs accept compiler options as their final argument, with a
default 100,000-loop-iteration allowance per kernel call. Their own host/request
limits remain in force. The monitor materializes two traces and a final state;
its current default lowering performs three history traversals, not one shared
loop. The examples make no general throughput, vectorization or zero-memory claim.

## Design and invariants

This change is application code, not another language primitive. It adds three
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
semantics. The monitor canonicalizes zero means and checkpoint counters to +0,
so JSON checkpointing does not lose meaningful signed-zero state. Checkpoints are explicit data, not authenticated provenance.

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
The kernel returns mean loss and gradients; the host performs bounded backtracking
gradient descent. A prepared input lease pins x/y once; only gain/bias scalars change.
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

## Executed implementation

The reusable modules and fixed JSON driver are in
[examples/case-studies/workflows](../examples/case-studies/workflows/README.md).
Run `npm run test:workflows` for the direct oracles and usage tests;
[the validation report](CASE-STUDIES-VALIDATION.md) records what was actually run.
