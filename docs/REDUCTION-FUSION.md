# Demand-scoped reduction cohorts, integrated with JTE 1 causal

This reconciles PR #1 with ASABI 1, record folds, causal stream machines and
prepared input leases from PR #2. The experiment remains **off by default**.
Enable `compile(source, {experimentalReductionFusion: true})`, the CLI flag
`--experimental-reduction-fusion`, or the playground checkbox.

## What may share a traversal

Co-demanded scalar reductions and record-valued folds can share a loop when they
have the same checked event domain AND identical extent, mask, lexical cursor
identities, guard sequence, and ordered causal-machine identities. Each reduction
retains its own initial value, accumulator and left-to-right numeric order.
Next-state components are snapshotted before any accumulator update.

```text
export fn summarize(xs: [Num]) = {
  let history = scan(xs, 0, (total, x) => total + x);
  {
    total: sum(history),
    count: count(history),
    last: fold(history, 0, (previous, current) => current)
  }
};
```

Default: three traversals with independent replay frames. Opt-in: one traversal,
one shared scan frame, three independent sinks. The observation certificate and
ASABI layouts do not change. No history array, allocator or runtime helper is added.

Two independently constructed scans may share a domain but have different state
frames: those are not combined. Shared filtering/transduction keeps its original
upstream clock. Domain equality never substitutes for physical scheduling checks.

Dense stateless `count` is already O(1) in 0.2 and has no loop to eliminate. Thus
`examples/rms.ass` now has one loop even with fusion off. The old RMS two-loop
comparison and PR #1 measurements describe the earlier compiler, not this baseline.

## Demand, effects and cache boundaries

Conditional expressions, short-circuit operators, runtime guards, host calls and
bounded iterations form planning boundaries. Branches are planned independently;
undemanded map values are not inspected merely to discover a cohort. Complete
causal transitions ARE inspected because consumed transitions are strict.

Candidates containing nested reductions, bounded iterations or host calls are
conservatively excluded. Cohorts do not enter per-iteration contexts. Completed
scalar/group results and lazily memoized results cannot be pulled into a second
cohort. Scalar record result fields may form one demand region; materialized array
outputs are not fused with independent sinks.

All explicit host effects execute through the existing broker, in source order,
before result materialization. Fusion neither activates capabilities nor moves work
across host-call boundaries. Prepared calls remain pure-only and return owned JS
copies. Normal ABI bounds and overlap checks remain in place.

Floating-point recurrences are not reassociated. Exact work completed before a trap
is not preserved, just as in the original experimental pass. There is no general
profitability/register-pressure model or end-to-end correctness proof. This is not
unrestricted multi-sink fusion, and it does not silently improve quadratic source.

## Validation and reproduction

See [INTEGRATION.md](INTEGRATION.md) for combined validation, source digest and the
paired benchmark. PR #1's 22 test scenarios and 500 generated cases are retained;
loop-count assertions account for the independent dense-count optimization.
New tests cover causal clocks, record snapshots, nested captures, memoization,
branch-local caches, capabilities, leases and every pure corpus export.

```sh
npm test
npm run test:fusion
npm run test:browser
npm run bench:fusion
node src/cli.mjs examples/pathological/scan_replay.ass --experimental-reduction-fusion --check --explain
```

The original design and measurements are preserved in
`history/REDUCTION-FUSION-v0.md` and `fusion-measurements.json`. Current paired
execution measurements are in `integration-fusion-benchmarks.json`.
