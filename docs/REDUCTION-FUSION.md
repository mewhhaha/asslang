# Experiment: demand-scoped reduction cohorts

## Hypothesis and scope

JTE's event-domain identity can be used for more than static zip alignment: it can
also delimit safe loop sharing between independent observers of a stream. A sum,
a count and a mapped sum need separate accumulators, not necessarily separate
traversals. The experiment combines that identity with scalar demand boundaries
and exact stream-plan checks rather than guessing from equal lengths or matching
predicate text.

This is a new experiment for this compiler, not a claim to have invented loop
fusion, multiple accumulators, common-subexpression elimination or demand
analysis. See the project's existing [related work](RELATED-WORK.md). The current
checker is not a formal end-to-end proof that the Wasm implements the source.

## Use

```js
const c = compile(source, { experimentalReductionFusion: true });
console.log(c.stats.functions[0].reductionFusion);
// { enabled: true, groups: [{ domain, reductions, streams }], eliminatedLoops }
```

```sh
node src/cli.mjs examples/rms.ass --experimental-reduction-fusion --check --explain
npm test
npm run test:browser
npm run bench:fusion
# Smaller benchmark input:
FUSION_BENCH_N=4096 node scripts/bench-fusion.mjs
```

The option must be Boolean. It is false by default. Source syntax, inferred types,
export ABI, JTE certificate format and memory imports are unchanged. RMS on an
empty span remains NaN; this optimization does not add an empty-input policy.

`groups` records emitted groups, not merely proposed opportunities. `reductions`
contains scalar DAG IDs; `streams` contains JTE stream-step IDs; `domain` is their
shared event-domain ID. `eliminatedLoops` sums group sizes minus one. These are
compile-time structural observations, not timings or a runtime iteration count.
The sidecar is an audit aid, not an independently verifiable proof binding the
emitted binary to a fusion schedule.

## Eligibility and lowering

`src/fusion.mjs` collects uncached reductions from a strict scalar demand region.
It visits each DAG node once in that scan and deduplicates repeated uses of the
same reduction. It does not descend into reductions or `if`, `&&`, or `||` nodes.
The emitter separately plans conditions and selected branch bodies, using the
existing branch-local caches. A branch-only reduction never becomes unconditional
merely because another reduction uses the same stream.

A candidate is excluded if its initial value, body, extent, mask or guards contain
another reduction. This is deliberately conservative, including both arms of
scalar branches. Crucially, the check does **not** walk the stream's item unless
the reduction body actually refers to it. Thus this remains legal and nontrapping:

```text
export fn main(n) = {
  let xs = range(n);
  let bad = map(xs, x => sum(range(-1)));
  count(bad) + fold(bad, 0, (a,x) => a+1) + sum(xs)
};
```

Eligible candidates must have the same domain from the ledger already checked by
`stage()`, AND identical IR IDs for the extent, mask, ordered index identities and
ordered guard set. Domain equality alone is not treated as a sufficient schedule
proof. Independent equal-length sources, independent ranges and independent
filters never get equated. A shared checked-zip domain can qualify, but its dynamic
extent obligations remain mandatory before iteration.

The emitter uses the same reduction-lowering helper for a singleton or a cohort.
A cohort gets one index and one loop, with a separate local accumulator for every
reduction. It checks the common guards once, evaluates the common mask once per
input event and shares only demanded scalar computations within that event.
Each accumulator keeps its original initial value and left-to-right recurrence.
There is no sum combination, tree reduction, vectorization or f64 reassociation.
Completed results enter the enclosing cache only after the loop. Outer cohorts
are explicitly removed from per-iteration contexts; nested reductions retain the
baseline path.

## Conservative boundaries and remaining risks

Nested/dependent reductions, branch-only observations and nonidentical schedules
are fallback cases, not compile errors. Two-pass statistics that depend on a
previous reduction are not accelerated by this pass. It does not introduce tuples,
materialized outputs, effects, shared memory or a new runtime. Boolean folds keep
their existing short-circuit behavior; lazy Boolean operators are not made eager
to create fusion opportunities.

The correctness target is the same returned scalar (with NaNs compared by NaN
classification, not payload bits) or a trap for the pure language. Interleaving
independent observers can change work performed before a trap; exact trap timing
is not a preserved observable. This design needs reconsideration before effects,
mutable inputs or concurrent memory are introduced.

There is no profitability model or register-pressure budget yet. Large cohorts
could increase live state or hurt performance on another engine or workload.
Default-off status is intentional. Eligibility scans are memoized within a region,
not a claim of whole-compiler linear complexity. No formal soundness theorem or
broad cross-engine performance result is claimed.

## Validation performed

Base: `278903be98ab3bf50088fa79c374705e6c7ab3c7`. Retrieved compiler, reference,
existing Node tests, examples, CLI and browser harness files were checked against
GitHub's blob hashes before modification.

- `npm test`: **56 tests passed**, including the existing 250 seeded differential
  cases and 500 new programs compared with both unfused Wasm and the independent
  allocation-heavy reference interpreter. Coverage includes empty inputs, shared
  filters, ignored trapping maps, nonassociative folds, NaNs, infinities, subnormal
  values, signed zero, checked-zip obligations, invalid extents, span bounds, lazy
  branches, cache isolation, nested captures, schedule mismatch and the CLI flag.
- `npm run test:browser`: **312 checks passed** in Chromium 144.0.7559.96, including
  100 existing and 100 additional fusion differential cases. The fixed test bundler
  was updated to include the planner; no bundler dependency was added.
- A local compatibility comparison against the hash-verified pre-change compiler
  checked **1,000 generated programs**: default-option Wasm bytes and JTE
  certificates were unchanged. This comparison used the retrieved baseline copy;
  the PR's persistent suite also checks explicit-off/default equivalence.
- `npm run test:browser:http` was attempted and failed at navigation with
  `net::ERR_BLOCKED_BY_ADMINISTRATOR`. HTTP module and playground-worker loading
  therefore remain unvalidated here. No browser policies were changed.

These are local execution results, not GitHub CI results.

## Paired execution measurements

Raw sources, samples and environment are in [fusion-measurements.json](fusion-measurements.json).
The dependency-free benchmark uses 262,144 deterministic input elements, 30 warmup
calls per variant, nine paired rounds and 12 calls per sample, alternating which
variant runs first. Compilation, instantiation and input construction are outside
the timed interval. Both variants' results are checked before measurement.

Measured on Node v22.16.0 / V8 12.4.254.21-node.26, Linux x64, Intel Xeon Platinum
8573C. These are synthetic microbenchmarks on one shared execution environment,
not guarantees or browser timing measurements.

| Workload | Loops off / on | Wasm bytes off / on | Median ms off / on | Ratio off / on |
| --- | ---: | ---: | ---: | ---: |
| Three moments | 3 / 1 | 331 / 260 | 0.587 / 0.227 | 2.58x |
| Shared-filter moments | 3 / 1 | 388 / 274 | 5.836 / 2.088 | 2.80x |
| Shared square-root map | 2 / 1 | 334 / 255 | 1.450 / 0.878 | 1.65x |
| Independent filters (negative control) | 2 / 2 | 294 / 294 | 3.762 / 3.748 | 1.00x |

The control intentionally has equivalent-looking filters with distinct JTE
domains. It remains byte-identical rather than relaxing the language's provenance
rule to obtain a speedup. Timing noise remains visible in the retained samples;
there are no flaky wall-clock assertions in the test suite.
