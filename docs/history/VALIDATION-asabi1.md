# Validation and measurements — prototype 0.1

Executed on 2026-09-05 in the implementation container. These are observed results,
not a claim about the latest Chrome release or every browser environment.

## Correctness actually run

`npm test`: **96 tests passed, zero failed**. Full TAP output is `tests-node.tap`.
Coverage includes the 250 original seeded differential cases, 200 additional
record/array/nested-traversal cases each run with memoization enabled and disabled
(400 differential executions), and all 24 registered accepted export cases.
The reference evaluator shares the parser but not JTE staging or Wasm emission.
Fixed algorithm answers and independent JS baselines provide additional checks.

The corpus registration test checks every `.ass` file and accepted export. The
single deliberately rejected source must produce `E_DOMAIN`.

New boundary tests cover stable little-endian wire bytes and canonical record
layout; a frozen ASABI-1 binary; Unicode/BOM/NUL and invalid UTF-8; wrong JS values,
sparse arrays/getters; nested records, numeric/Boolean arrays and copied outputs;
output/input alias rejection; buffer exhaustion and recovery; raw span errors;
record-row inference; simultaneous fold state; conditional composite values;
checked indexing; and zero-page pure runtimes.

Host tests reject pure calls/captures of imports, pure calls to effectful exports,
forged or absent capabilities, signature mismatches, exhausted budgets, replayed
sequence tokens in a modified valid Wasm body, revoked grants, same-instance and
cross-instance grant reentry, policy violations, asynchronous handlers, and invalid
host returns. Tests also verify strict effect order, unused performed results,
consumption before exceptions and copied byte arguments.

`npm run test:browser`: **139 checks passed** in **Chromium 144.0.7559.96**, including
100 seeded differential cases, all 24 corpus exports, structured ABI roundtrips,
budget/authorization checks, output exhaustion and recovery. The recorded report
is `browser-tests.json`.

`npm run test:browser:http` was attempted and failed on navigation with
`net::ERR_BLOCKED_BY_ADMINISTRATOR`. Therefore HTTP ES-module loading and the
playground worker-loading/UI path remain **unverified end-to-end** here. The
in-memory browser tests and both benchmark suites passed. No browser policy was
changed. `npm run example:host` also ran successfully (audit of demo value 12.5,
accepted result, remaining grant budget zero).

## Compilation

Current reports are `benchmarks-node.json` and `benchmarks-chrome.json`. Both are
produced from `examples/corpus.mjs`, with 22 accepted source files and all 24 runtime corpus entries. Seventeen
algorithm cases additionally have independent JS performance baselines; host
effects are timed through the broker, not through an unguarded raw import. Compilation includes parsing, inference, staging,
certificate checks, direct binary emission, and Wasm validation. It excludes
engine machine-code generation, file IO, and process startup. Timings use warmed,
calibrated batches, not a single quantized browser timer reading per tiny compile.

Chrome median batch-average compilation:

| Source | Median compile | Wasm bytes | ABI metadata bytes |
| --- | ---: | ---: | ---: |
| energy.ass | 0.325 ms | 901 | 554 |
| algorithms/welford.ass | 0.369 ms | 1,479 | 837 |
| algorithms/normalize.ass | 0.216 ms | 1,064 | 382 |
| algorithms/convolution.ass | 0.428 ms | 1,556 | 481 |

ABI metadata is deliberately counted separately; current total binary sizes are
not directly comparable to v0 binaries that carried no ABI schema. Node's 10 fresh
process checks of Welford, including startup/file reads but no output writes, had
median **39.58 ms** and p95 **41.46 ms**.

## Runtime

Chrome warmed median **microseconds per call**, reported separately by boundary:

| Example | Input size | Raw Wasm kernel | Hand-written JS | Full JS adapter |
| --- | ---: | ---: | ---: | ---: |
| energy | 8,192 | 6.93 | 6.84 | 32.81 |
| welford | 8,192 | 49.22 | 46.09 | 78.12 |
| normalize | 8,192 | 37.89 | 35.16 | 100.00 |
| convolution | 1,024 | 23.83 | 15.62 | 62.50 |
| lower-bound | 8,192 | 0.10 | 0.10 | 27.73 |
| prefixes-quadratic | 256 | 69.53 | 1.34 | 78.12 |
| multi-reduction | 8,192 | 13.67 | 6.84 | 98.44 |

The raw kernel reuses encoded inputs and caller-owned output buffers; it excludes
marshalling, result lifting and scrubbing. The JS adapter includes those costs
and clears its fixed 256 KiB arena each call. JS baselines use warmed indexed loops
and allocate output arrays where appropriate. Thus raw-kernel speedups are not
end-to-end application speedups or equal-allocation comparisons. Timings include
the JS-to-Wasm call overhead. No claim is made about total Chrome RSS, V8 stack
layout, or all JS/engine allocations.

Both compiler and runtime measurements use 30 warmups, batches calibrated toward
at least 5 ms (subject to a cap), and p50/p95 of batch-average times. Those p95s
are **not individual-call tail latencies**. Browser clock granularity, GC and
scheduler noise remain visible. Node metadata records the CPU/platform; Chrome
records its actual user agent. V8 code caches mean the separate instantiation
number is not necessarily a cold machine-code compilation measurement.

## What the measurements reveal

Demand-preserving memoization fixes the shared-reduction pathology. At 2,048
values, Chrome's recorded kernel time is about **3.22 microseconds** with the pass
and **3.50 milliseconds** with it disabled. Both modes pass differential tests;
this compares one repeated-reduction program, not entire languages.

Dense count now observes an extent directly, so binary search no longer scans the
array just to learn its length. In contrast, repeated prefixes still use quadratic
work while their JS baseline uses a linear scan. Multiple reductions still traverse
separately, and convolution retains repeated bounds checks. These disadvantages
are retained in the reports rather than removed from the corpus.

The expansion benchmark records both successful compilations and `E_LIMIT` for
larger staged compositions. There is no incremental compilation cache and no
claimed linear-time type-inference or staging bound.

The first-run / v0 measurements are preserved under `history/`. They should not be
mixed with this version's ABI sizes or broader compiler timings.
