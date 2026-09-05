# Validation: Asslang 0.2 / JTE 1 causal

Executed September 5, 2026. This report supersedes the ASABI 0.1 validation,
preserved as `history/VALIDATION-asabi1.md`. Unprefixed benchmark reports and
`tests-node.tap` are historical evidence, not current 0.2 results.

## Tests actually run

`npm test`: **132 passed, 0 failed**. This includes 250 original seeded scalar/
pipeline cases; 200 record/array/nested-traversal cases each checked with memoization
on and off (400 executions); and 300 causal programs each checked on and off (600
executions). The independent reference evaluator shares parsing, not staging or
Wasm emission. These differential checks do not constitute a correctness proof.

The tests cover ASABI 1 frozen binaries, structured results and bounds, host
capability order/replay/budgets/revocation, observation rejection, state snapshots,
shared/independent/nested recurrence frames, upstream/downstream clocks, demand,
bounded iteration, and prepared-lease snapshots, expiry, traps and reentrancy.

`npm run test:browser`: **255 checks passed** in **Chromium 144.0.7559.96**. This
includes all **34 corpus exports**, 100 original seeded browser cases, and 100
causal cases. The corpus registers 32 accepted source files and 3 deliberately
rejected files; every `.ass` file and accepted export must be registered.

The engine suite uses an in-memory bundle and DevTools' anonymous pipe. The HTTP
test was also attempted and failed with `net::ERR_BLOCKED_BY_ADMINISTRATOR`.
HTTP module loading and the playground's HTTP/worker/UI path therefore remain
unverified end-to-end. No administrator policy was changed. The default playground
source was separately compiled and executed successfully through the Node adapter.

## Method and environment

Node v22.16.0, Linux x64, Intel Xeon Platinum 8370C CPU @ 2.80GHz, in a container.
The browser runs on the same host. Earlier messages and historical reports used
different runs/hosts; their numbers are not before/after comparisons for this run.

Each suite checks 32 unique compilation inputs and all 34 accepted runtime cases.
Both use 30 warmups and batches calibrated toward at least 5 ms, subject to a batch
cap. Node uses 21 compilation and 15 runtime batches; Chrome uses 15 and 11.
Scaling variants use 7 batches. p50/p95 are over batch averages, NOT individual
call tail latencies. Scheduling/GC noise and substantial p95 outliers are visible.

Compiler timing includes parsing, inference, staging/certificate checking, binary
emission and Wasm validation; it excludes V8 machine-code generation, execution,
file I/O and process startup. It does not measure large-program scaling or an
incremental cache. Instantiation can benefit from engine caches.

Runtime compares raw guest execution with reused encoded inputs/output buffers,
independent warmed JS algorithms, the copying adapter, and prepared calls. The
copying adapter copies inputs/results and clears a fixed 256 KiB arena each call.
Prepared input setup is measured separately; results are still copied and their
output region cleared. JS baselines allocate result arrays where applicable, unlike
the raw reused-buffer kernel. The columns are not equivalent allocation contracts.

## Selected Chromium medians

Microseconds per call. Parser size is numeric token count, and Newton size is its
iteration budget. Slower examples and expensive boundaries are retained.

| Case | Size | Raw Wasm | JS baseline | Copying adapter | Prepared adapter |
| --- | ---: | ---: | ---: | ---: | ---: |
| prefix-scan | 8,192 | 13.867 | 428.125 | 531.250 | 443.750 |
| ewma | 8,192 | 40.625 | 462.500 | 375.000 | 318.750 |
| running-zscore | 8,192 | 95.312 | 487.500 | 625.000 | 368.750 |
| parse-uints | 2,048 | 71.094 | 350.000 | 206.250 | 146.875 |
| machine-composition | 8,192 | 33.984 | 618.750 | 450.000 | 309.375 |
| machine-product | 8,192 | 15.820 | 125.000 | 168.750 | 30.078 |
| newton | 32 | 0.165 | 0.092 | 11.133 | 9.375 |
| energy | 8,192 | 13.867 | 14.648 | 153.125 | 13.867 |
| lower-bound | 8,192 | 0.290 | 0.223 | 137.500 | 6.836 |

Prepared calls help especially when a large retained input produces a scalar or
small record. Output-heavy calls still allocate and can remain expensive. These
microbenchmarks are not a production guarantee or evidence of general superiority
over JavaScript; the Newton and binary-search JS baselines are faster here.

## Algorithmic improvement: explicit prefix scan

Both implementations produce the same prefixes on the same backend. The old
source recomputes prefixes; the new source uses a one-pass recurrence. This is a
change in the expressible algorithm, NOT automatic rewriting of quadratic source.

| Source | Elements | Raw Wasm median, us | Generated loops |
| --- | ---: | ---: | ---: |
| prefixes-quadratic | 128 | 39.453 | 2 |
| prefixes-quadratic | 512 | 512.500 | 2 |
| prefixes-quadratic | 2,048 | 8300.000 | 2 |
| prefix-scan | 128 | 0.269 | 1 |
| prefix-scan | 512 | 0.903 | 1 |
| prefix-scan | 2,048 | 3.418 | 1 |

## Compiler measurements

Milliseconds. Wasm byte counts include embedded ASABI metadata.

| Program | Wasm bytes | Compile p50 | Compile p95 |
| --- | ---: | ---: | ---: |
| algorithms/prefix_scan.ass | 981 | 0.519 | 7.525 |
| algorithms/parse_uints.ass | 1,496 | 1.200 | 4.738 |
| algorithms/newton.ass | 1,379 | 0.625 | 4.200 |
| concepts/machine_composition.ass | 1,199 | 3.400 | 19.600 |
| concepts/machine_product.ass | 1,419 | 1.600 | 5.175 |

The machine-composition example has one loop and five recurrence scalars. Its
other locals include cursors, output descriptors and scratch values. Logical Wasm
local bytes are not measured V8 stack/register allocation or resident memory.
The input and materialized output buffers are additional storage.

## Reproduce and inspect

```sh
npm test
npm run test:browser
npm run bench -- --output /tmp/asslang-node.json
npm run bench:browser -- --output /tmp/asslang-chrome.json
```

`causal-benchmarks-node.json` and `causal-benchmarks-chrome.json` retain rounded
summaries for every case, scaling variants and expansion failures. Full-precision
reports are generated by the commands above and supplied with this delivery as
separate downloadable files. `causal-validation.json`, `causal-browser-tests.json`
and `causal-source-manifest.json` record checks and source hashes. The matching
full Node test log is also provided separately. Benchmark scripts are identical
to those used to produce the reports; no timing-based acceptance rule was added.
