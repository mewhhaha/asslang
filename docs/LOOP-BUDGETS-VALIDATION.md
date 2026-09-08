# Per-invocation loop budgets: executed validation

## Scope and provenance

Executed on 2026-09-09 Europe/Vienna (2026-09-08 UTC logs), with Node v22.16.0,
Linux x86-64, and Chromium 144.0.7559.96. The baseline is merged main commit
`46296dd10de6fb80c79844dec02fc2a6298c0e88`, after PR #13, with tree
`f1c17e791122b12817f06ed49309713234e6d03e`.

The baseline source came from the retained validation artifact of GitHub Actions
run 34287656213. Its complete local Git tree matched upstream before editing.
[LOOP-BUDGETS.md](LOOP-BUDGETS.md) and its index entry were committed before any
implementation or test changes. Historical reports and the independent source
reference evaluator are unchanged.

## Implemented policy

`maxLoopIterations` is an optional compiler ceiling from 0 through 2,147,483,647,
shared by all generated loops within an exported invocation. Every emitted loop
header uses a single helper: it tests normal termination first, then reserves
one scalar iteration or two SIMD lanes before entering the body. The counter is
one private i32 local, reinitialized per call. It introduces no import, global,
linear-memory counter, allocation mechanism, or wire argument.

The compiler, named-source/check/session APIs, and CLI carry the policy. An
optional `asslang.limits` custom section and `compiled.executionLimits` describe
it; instrumented per-function statistics count its static sites. ASABI schemas,
JTE certificates, floating-point schedules, and optimization defaults are
unchanged. Omitting the option emits no instrumentation or limits section.

## Executed checks

| Command/check | Actual result |
| --- | --- |
| Unchanged baseline `npm test` | 783 passed, zero failures or skips |
| Existing tests after implementation, before new cases | 783 passed |
| Final `npm test` | 845 passed, zero failures or skips |
| `npm run test:loop-budgets` | 180 passed, zero failures or skips |
| `npm run example:host` | Passed; explicit allowance exhausted as expected |
| `npm run example:reducers` | Passed |
| `npm run example:case-studies` | All 12 scalar/SIMD executions passed |
| `npm run build:example` | Passed |
| Chromium engine suite | PASS: 1,096 core plus 276 experimental checks |
| Baseline compatibility comparison | 184 identical binaries; 52 matching diagnostic cases |
| Previous shared cases with a 100,000-unit policy | 236 checks passed |
| `git diff --check` | Passed |

This adds 62 Node tests: 37 runtime/compiler tests, five CLI tests, and 20 shared
engine cases. The shared cases run with all three lowering switches off and all
three on, adding 40 Chromium checks. Dedicated boundary tests cover all eight
SIMD/reduction-fusion/reduction-memoization combinations. The retained reports
are [loop-budgets-browser-tests.json](loop-budgets-browser-tests.json) and
[loop-budgets-compatibility.json](loop-budgets-compatibility.json).

## Exact-boundary and integration evidence

Tests supply the analytically required allowance, then one unit less. They cover
scalar and record reductions, reduction cohorts, materialized numeric/Boolean
streams, causal state, rejected filters, non-emitting transducers, `fold_until`,
`iterate`, nested traversals, nested iteration/reductions, eager initial-value
loops, and multiple result streams. A 3-by-4 nested traversal needs 15 units:
three outer and twelve inner iterations. Entering an inner loop never resets the
counter. A filtered early-exit case spends three units for two accepted events.

SIMD map and sum tests exercise lengths 0 through 7, assert actual vectorization,
and check pair-plus-remainder costs without disabling the optimization. Raw
output buffers filled with sentinels remain untouched when a scalar step or a
SIMD pair cannot reserve its full cost. Fusion and memoization have explicit
cost tests: a shared four-element causal reduction pair needs four units with
fusion and eight without; a three-element map with an invariant sum needs six
units with reduction memoization and twelve without.

Zero-budget cases cover scalar work, dense extent-only counts, empty streams,
inactive branches, unused bindings/fields, and zero-step iteration. Independent
primal guards and raw entry-span checks still trap. A huge runtime extent
(2,147,483,647) traps under a three-unit budget in an isolated child process; the
process timeout protects the test from missing instrumentation, not a claim about
execution speed or a wall-clock policy. The maximum legal ceiling is compiled
and exercised on small inputs, not exhaustively consumed.

Raw Wasm instantiation enforces the budget with no extra imports or parameters.
Normal and prepared calls reset it after successes and failures. Prepared-call
tests retain the original input snapshot despite JS mutations, protect prior
results across traps, preserve output independence, and reject expired/busy
leases. The actual JavaScript documentation example is executed, including its
trap handling and subsequent successful call.

Host-effect tests cover exhaustion before a host argument finishes (no allowance
consumed), exhaustion after an issued effect (no refund/replay), and loops on
both sides of a host call (no reset at the import). Missing grants and prepared
calls on effectful exports remain rejected. A zero-budget scalar-only effect
still executes when granted: loop quotas are not an effects-disabled mode.

Compiler tests check strict option validation, canonical zero metadata, limits
sections, statistics, unchanged ABI metadata, cache-key separation and snapshot
isolation, linked sources, and source-local check/compile errors. CLI subprocesses
exercise build/run/check, sidecar/explain metadata, missing/duplicate/invalid
flags, source linking, and unmetered output. Existing compiler and host memory
limits remain separate from the new traversal policy.

## Compatibility and limitations

Against an untouched baseline extraction, all 118 previous shared cases in two
lowering modes yielded 184 byte-identical unmetered binaries with equal ABI,
certificates, signatures, observations, and export descriptions; 52 failures
retained their codes and offsets. Those cases also pass with a generous compiled
budget. This is corpus evidence, not a universal compiler equivalence proof.
Successful instrumented/uninstrumented numeric maps additionally preserve
`Object.is` results for signed zeros, infinities, and NaNs across all eight modes.

An initial test-normalization helper treated Boolean result arrays as records;
the helper was corrected and the complete final suites rerun. No change to the
runtime's Boolean representation or the independent evaluator was required.

These are local results, not a statement that this PR's remote CI passed. Remote
GitHub Actions must be checked separately. HTTP module loading, playground worker
loading, other browser engines, and throughput benchmarks were not exercised.
The playground UI/worker request protocol does not expose this option in this PR.

This policy is fixed at compilation and resets per exported invocation; it is
not a runtime-adjustable allowance or an application-wide quota. It counts
emitted loop work, not instructions, bytes, or elapsed time. Compilation,
instantiation, host callbacks, JS copying, and straight-line work are not charged.
Optimizer settings can change required allowance. Exhaustion is an ordinary
Wasm trap, not a distinct structured budget-error code, and previous host effects
or raw output writes are not rolled back. No performance or sandbox-audit claim
is made.
