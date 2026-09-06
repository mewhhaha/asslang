> Subsequent stopping-kernel and source-composition changes are documented in
> [COMPOSABILITY.md](COMPOSABILITY.md), with [current validation](COMPOSABILITY-VALIDATION.md).

# PR #2 integration: causal streams and reduction cohorts

## Reconciled histories

The integration combines PR #2 head `99ceecca9fe6cca59e846a0a4235e139bdea8cfd`
(tree `7d80a901e49045497c5f85f8ff3e79d42ab435af`) with main
`609ae7b44931efeff3e2ff122df536b19018116e` (merged PR #1).
Both histories are parents of the resolution commit. No force update of main or
replacement of the merged experiment is required.

The saved 0.2 archive was verified against PR #2's Git tree before editing; its
132 baseline tests passed. Reduction fusion was ported into the current emitter,
not applied by choosing one side of the backend conflict. ASABI 1, record state,
causal machines, prepared leases and explicit capability effects are retained.

## Checks run on the combined implementation

- **168 Node tests passed**, zero failures. These retain the 22 PR #1 fusion test
  scenarios (including 500 seeded programs) with structural expectations adjusted
  for dense stateless count's existing O(1) implementation.
- New integration coverage includes 300 generated causal/record programs, each
  checked with all four fusion/memoization combinations (1,200 executions), all
  pure corpus exports across the same option combinations, record/scalar cohorts,
  shared versus distinct recurrence clocks, cached groups, branches, nested
  captures, host quotas/order, prepared leases and real worker-handler dispatch.
- **596 Chromium checks passed** in Chromium 144.0.7559.96, including the complete
  35-export corpus, the original browser fusion checks, 100 causal-fusion cases,
  and the pure corpus with fusion enabled.
- **1,033 default-compilation comparisons** (33 corpus source files plus 1,000
  generated cases) produced identical Wasm bytes and certificates against the
  saved 0.2 compiler. The new option remains disabled by default.
- JavaScript syntax checks, `git diff --check`, `npm run example:host`, and
  `npm run build:example` passed.

These are local results, not a claim that GitHub Actions ran. The Node test log and
browser report were captured during this integration. `integration-validation.json`
records the source-file SHA-256 manifest and check summary.

`npm run test:browser:http` was attempted again and returned
`net::ERR_BLOCKED_BY_ADMINISTRATOR`. HTTP navigation, module loading and the full
playground UI/worker-loading path remain unverified here; browser policies were not
changed. The actual worker handler was tested separately in Node, including option
forwarding and denial of ungranted host effects.

## Paired execution benchmark

Node v22.16.0, V8 12.4, Linux x64, AMD EPYC 9V74. Each case uses 262,144 deterministic
inputs, 30 warmup calls per variant, nine alternating-order rounds and 12 calls per
sample. Results are compared before timing. Timings exclude compilation,
instantiation and marshalling; both variants reuse the same input memory.

| Case | Loops off / on | Median ms off / on |
| --- | ---: | ---: |
| Moments | 2 / 1 | 0.436 / 0.219 |
| Shared-filter moments | 3 / 1 | 3.889 / 1.312 |
| Shared mapped computation | 2 / 1 | 1.284 / 0.664 |
| Independent-filter negative control | 2 / 2 | 2.614 / 2.640 |
| Shared scan history | 3 / 1 | 0.831 / 0.269 |
| Shared selective transducer | 2 / 1 | 2.717 / 1.396 |

Raw samples, source programs and environment are in
`integration-fusion-benchmarks.json`; rerun with `npm run bench:fusion`. These are
single-environment synthetic measurements, not production guarantees. Tests do not
assert wall-clock speed. Current compilation/full-adapter benchmarks remain
available via `npm run bench` and `npm run bench:browser`.

## Scope and safety

Identical event domains alone are not enough: schedules, guards, lexical cursors
and ordered state-machine identities must also match. Independent record/scalar
reductions share traversal but retain distinct snapshots and initial states.
No cohorts are carried into iteration bodies. Host effects and conditional demand
remain separate planning regions. Unrestricted multi-sink fusion and a formal
compiler proof remain outside this integration; the feature stays opt-in.
