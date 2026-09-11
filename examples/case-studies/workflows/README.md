# Practical workflows

Three reusable application hosts around ordinary Asslang/Wasm kernels. No new
language feature, dependency, network service or deployment action is required.
Run from the repository root with Node 22+.

```sh
npm run example:workflows
npm run test:workflows
node examples/case-studies/workflows/app.mjs monitor < examples/case-studies/workflows/inputs/monitor.json
node examples/case-studies/workflows/app.mjs calibration < examples/case-studies/workflows/inputs/calibration.json
node examples/case-studies/workflows/app.mjs release < examples/case-studies/workflows/inputs/release.json
```

Add `--simd` after a case ID to enable that compilation option. The release fixture
intentionally has stale approval: it prints a complete `ready:false` report and
**exits 2**. Change `approval.revision` to the candidate revision to get readiness.
Malformed requests exit 1 with a message on stderr and no JSON result. Successful
computation exits 0. Calibration has its own explicit convergence status; a
returned bounded-fit result is not necessarily a converged fit.

| Workflow | Useful behavior | Source and reusable API |
| --- | --- | --- |
| Monitor | Resume smoothing/hysteresis across JSON checkpoints without losing alarm edges; failed chunks leave state unchanged. | [Kernel](monitor.ass), [host](monitor.mjs): `createMonitor`, `runMonitor`. |
| Calibration | Fit gain/bias with Huber or squared loss; per-sample AD, pinned input lease, bounded backtracking, prediction. | [Kernel source](calibration-kernel.mjs), [host](calibration.mjs): `fitCalibration`. |
| Release | Derive readiness from current revision-tagged receipts; reject contradictory or stale summary claims. | [Contract builder](release-kernel.mjs), [host](release.mjs): `createReleaseGate`, `evaluateRelease`. |

[The guide](../../../docs/CASE-STUDIES.md) explains request/response fields,
embedding examples, mathematical invariants, reference expectations and limits.
[Executed checks](../../../docs/CASE-STUDIES-VALIDATION.md) distinguish results
from performance or production-readiness claims.

The hosts bound inputs and use fixed-capacity arenas plus per-call iteration
budgets. This is not an audited sandbox. Sensor thresholds are application choices;
Huber fitting does not fix arbitrary leverage outliers; release receipts are
caller data, not verified signatures. Receipt IDs/digests are opaque strings:
matching them is not hashing an artifact or authenticating an approval.
