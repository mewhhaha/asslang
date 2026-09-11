# Practical workflow validation

[Guide and invariants](CASE-STUDIES.md) · [Validation index](EVIDENCE.md)

## Source and scope

Based on merged main `bf6edab16e1116a4db5c1697e13d4eb2b6c03c70`, tree
`e703fba198bdaf94c0b3c00c00f6cc4837340b45`. The source tar from PR #25's successful
CI artifact reconstructs that exact tree. The unchanged local baseline passed
1,168 Node tests. The workflow contracts and validation design were committed
before new implementation, examples or tests.

The change adds three reusable hosts, one corpus-registered Asslang kernel, two
JS-held kernel/contract source modules, a bounded JSON CLI, three input fixtures,
an assertion-backed runner, tests and task-oriented documentation. It changes no
files under `src/`, dependencies, ABI, language semantics, resource policy or
workflow permissions. Existing small case studies and their argument-array CLI
remain available. The root README only gains a guide link and remains 83 lines.

## Executed checks

Environment: Node v22.16.0, Linux x64, Chromium 144.0.7559.96.
Validation date: September 11, 2026. These are local results, separate from CI.

| Command | Result |
| --- | --- |
| Unchanged baseline `npm test` | 1,168 passed, no failures/skips |
| Final `npm test` | 1,194 passed, no failures/skips |
| `npm run test:workflows` | 24 passed |
| `npm run test:docs` | 26 passed |
| `npm run example:workflows` | All three fixtures passed with scalar and SIMD compilation |
| `npm run example:case-studies` | Existing examples and registered monitor passed |
| `npm run example:host`, `npm run example:reducers` | Passed |
| `npm run build:example` | Passed |
| `npm run test:browser` | 1,425 core + 276 experiment checks passed (138 experiment cases) |
| `npm run test:browser:http` | Attempted; blocked by `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| Syntax checks of added/changed modules and `git diff --check` | Passed |

Both browser harnesses register the new checks; only the engine bundle completed
in this environment. No browser policy was modified or bypassed. The dedicated
28 browser assertions exercise per-sample AD, the analytic Huber optimum,
prepared overrides/disposal, prediction and release-claim rejection in four
SIMD/fusion configurations. The monitor additionally runs through ordinary corpus
and SIMD-corpus coverage. Host checkpointing, optimization orchestration and stdin
are Node tests, not claims about executing the Node host inside a browser.

## Monitoring evidence

Across all eight SIMD/fusion/memoization combinations, the real monitor kernel
matches an explicit JS recurrence and the existing reference interpreter. Every
split of a ten-sample stream yields exactly the same concatenated traces and final
state as a whole call. A further 100 seeded sequences match the recurrence.
Threshold boundary tests distinguish raising at high, clearing at low, and holding
state inside the band; repeated in-band samples do not increment edge counters.

Host tests serialize checkpoints, resume into another instance, retain old result
storage, preserve state across invalid samples and loop exhaustion, and recover on
a later valid chunk. A finite extreme sample whose update would overflow is
rejected without committing its state. Negative zero is canonicalized in monitor
state so JSON round trips preserve the application-defined state. Invalid versions,
configuration changes and inconsistent counters/threshold state are rejected even
with empty chunks. The maximum 4,096-sample chunk executes in the fixed arena.

The default kernel uses three history traversals for its two traces and final
state. There is no claim that multiple materialized traces share one machine.
An explicit three-unit test permits a one-sample call but rejects two samples;
the host checkpoint remains unchanged after the trap.

## Calibration evidence

The per-sample two-parameter gradient is checked against independently written
analytic Huber/squared derivatives in all eight lowering combinations. Central
finite differences away from Huber's join corroborate both parameter directions.
An additional 100 seeded datasets, coefficients and thresholds match the analytic
formula. No derivative of the reduction is claimed: scalar AD is inside the fold.
The existing corpus interpreter is unchanged; it does not implement AD, so this
source fragment has dedicated tests rather than skipped corpus assertions.

Clean and contaminated datasets have independent known optima. With x values
[-2,-1,0,1,2] and y values [-3,-1,21,3,5], delta-one Huber fitting converges near
(gain=2,bias=1.25); squared fitting converges to (2,5). Replacing the middle y with
1 recovers (2,1). These are selected synthetic examples, not an empirical claim
about all datasets. Accepted steps strictly decrease the chosen objective.

Tests distinguish gradient convergence, iteration-limit termination and a stalled
line search. They bound evaluations by one initial call plus at most 16 per
update. Empty/mismatched arrays, constant-x data, nonfinite samples, invalid controls
and loop exhaustion fail explicitly. Prepared leases retain the original sample
snapshot after host-array mutation; scalar overrides do not persist. Disposal
unlocks ordinary prediction and expired leases cannot run. Returned predictions
agree with the fitted affine expression.

## Release evidence and authority boundary

All 16 private Boolean assignments are evaluated through generated decision code
in all eight lowering combinations and compared with the direct conjunction of
current build, passing tests, matching artifact and current approval. All 16 public
flag combinations are checked: contradictory CI aliases trap, while legal views
satisfy the derived schema. Law-consistent claims are still rejected by the host
when they disagree with actual receipt-derived summaries.

Tests cover stale CI/approval/artifact revisions, a mismatched digest, zero passed
or nonzero failed tests, configured minimum passed tests, missing receipts, bad
counts, wrong Boolean types and unsupported fields. The fixture's stale approval
produces a useful not-ready report rather than an exception. Changing only that
approval's revision to the candidate revision enables readiness.

This is not receipt authentication, artifact hashing, authorization or deployment.
The sample identifiers are explicitly synthetic opaque strings. The host does not
fetch GitHub, validate cryptographic signatures, execute a release, or infer trust
from a generated predicate. Source-local errors, missing fields and pure-host-call
rejection retain the compiler's ordinary diagnostics.

## Reproducible usage and limits

The three published embedding snippets are extracted from the guide and executed
as fresh Node programs. The fixture runner is also executed from the test suite.
Each CLI request runs in a subprocess with actual JSON stdin. Release readiness
has distinct statuses: ready exits 0, not ready prints a complete report and exits
2, malformed requests exit 1 with stderr and no partial JSON. Unknown IDs, path
selection attempts, duplicate/unknown flags, malformed JSON and requests larger
than 1 MiB are rejected. CLI tests include the documented `--simd` option.

Hosts accept at most 4,096 samples per numerical call, 256 monitor chunks and
16,384 total monitor-request samples, 200 fitting updates and 16 trial rates per
update. Runtimes use 16 fixed pages with default 100,000 emitted loop iterations
per invocation. Embedders can explicitly select compiler options; host input
limits remain independent. These are bounded examples, not audited sandboxes or
wall-clock budgets. Input records reject unknown enumerable string fields and
getters, but arbitrary hostile JavaScript proxies are not sandboxed.

No throughput benchmark, production deployment, novel estimator, proof-assistant
verification, independent peer review or general all-program optimization result
was performed or claimed. Primary algorithm references are in the guide; the
work here demonstrates existing language capabilities with useful application
contracts and independently checked examples.
