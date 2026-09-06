# Validation: composable stopping kernels

Executed September 6, 2026. Baseline: unchanged upstream main
`6c8776f5ca7c614f8222e773d645d80a793d2d96` (the merged 0.2 implementation).
The local baseline was obtained from a source archive of that code plus an added
CI-only workflow; no compiler, runtime or example sources in the baseline were changed.

## Correctness actually executed

**215 Node tests passed, zero failures. 639 Chromium engine checks passed.**
Node v22.16.0; Chromium 144.0.7559.96 on Linux x64. The browser result is retained
in `composability-browser-tests.json`. CI now repeats Node tests, both interop
examples, and Chrome engine validation and retains a source/test artifact.

Coverage includes the frozen ASABI 1 binary, memory/argument validation, capability
order/budgets/revocation/reentrancy, input leases and scrubbing, JTE domains and
causal access rejection, all original seeded differentials, and the expanded corpus.
All 48 accepted exports across 45 sources are registered, alongside 3 rejected files.
Every pure corpus entry is tested with all four memoization/fusion combinations.

New focused tests cover accepted-event counting, empty/Boolean/record state, strict
simultaneous transitions, first/last/absent matches, suffix traps, filtered/causal
gates, nested rebinding and captured stopping conditions, lazy invariant memoization,
frozen product lanes, source-local diagnostics, cache ownership/LRU/options/limits,
native-module isolation, Float64 special values/subviews/overlap, local-declaration
runs over 127 locals, and CLI library execution/overwrite protection. An additional
**800 seeded early-exit executions** compare against independently written JS loops.

The reference interpreter shares parsing and eagerly materializes some upstream
stream plans. It checks values for the nontrapping corpus, **not** early-exit demand.
Direct Wasm suffix-trap tests establish that regression contract instead. Neither
the interpreter nor these finite tests constitute a proof of compiler correctness.

`npm run test:browser:http` was attempted again and failed with
`net::ERR_BLOCKED_BY_ADMINISTRATOR`. No policy was bypassed. HTTP module loading,
playground worker loading and UI interaction therefore remain unvalidated end-to-end.
The successful browser suite uses the existing in-memory test bundle over DevTools.
Big-endian fallback paths were not executed on this little-endian host.

## Reproduce

```sh
npm test
npm run test:composability
npm run test:browser -- --output /tmp/asslang-browser.json
npm run example:host
npm run example:reducers
git worktree add --detach /tmp/asslang-baseline 6c8776f5ca7c614f8222e773d645d80a793d2d96
npm run bench:improvements -- --baseline /tmp/asslang-baseline \
  --output /tmp/asslang-improvements.json
```

## Before/after performance on the same host

The complete report is `composability-benchmarks-node.json`, including source hashes,
baseline/candidate compiler-file hashes, Node/V8/CPU information, p50/p95, batches
and counts. These are new paired measurements, not comparisons with older reports.
Each function receives 40 warmups, calibration toward 4 ms per batch, and 21 samples.
Measurement order alternates baseline/candidate. **p50 and p95 are quantiles of
batch averages, not individual-call tail latencies.** Scheduling, GC and JIT effects
remain possible; this is one warmed host/process run, not a universal guarantee.

### Uncached compilation

Identical source is compiled by both versions, including parse, inference, staging,
binary emission and Wasm validation. This excludes native machine-code compilation,
I/O, module instantiation and process startup. ABI and certificate equality are checked.
Typed chunk assembly avoids repeated flattening/spreading during binary emission;
consecutive local declarations use run-length encoding without renumbering locals.
Top-level duplicate-name checks use sets rather than quadratic scans.

| Identical source | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Wasm bytes before → after |
|---|---:|---:|---:|---:|
| examples/energy.ass | 0.4612 | 0.3410 | 1.35× | 901 → 891 |
| examples/algorithms/welford.ass | 0.7173 | 0.3592 | 2.00× | 1479 → 1445 |
| examples/concepts/machine_composition.ass | 1.1590 | 1.2083 | 0.96× | 1199 → 1165 |
| examples/algorithms/convolution.ass | 0.7184 | 0.4655 | 1.54× | 1556 → 1520 |
| generated/300-unused-helpers | 1.4751 | 1.2646 | 1.17× | 369 → 367 |
| generated/24-record-sinks | 1.1499 | 0.8701 | 1.32× | 5639 → 5444 |

The machine-composition case was about 4% slower in this run; the other five
uncached cases improved. The earlier exploratory run varied substantially. No
performance assertion in the test suite assumes a universal speedup.

### Exact-source cache hits

This compares the current uncached compiler with its explicit LRU, including the
defensive snapshot returned on a hit. It is not evidence of per-definition incremental
compilation. A cache miss still performs a full build and adds retention/snapshot work.

| Source | Current uncached p50 (ms) | Cache-hit p50 (ms) | Speedup |
|---|---:|---:|---:|
| examples/energy.ass | 0.1628 | 0.0437 | 3.73× |
| examples/algorithms/welford.ass | 0.2008 | 0.0347 | 5.79× |
| examples/concepts/machine_composition.ass | 0.5123 | 0.0265 | 19.36× |
| examples/algorithms/convolution.ass | 0.1845 | 0.0343 | 5.39× |
| generated/24-record-sinks | 0.7772 | 0.1517 | 5.12× |

### Runtime transfers

Both implementations run the same source over **32,768 Float64Array elements** in a
fixed **1 MiB arena**. Copying calls include input/result copying and clearing. Prepared
calls exclude preparation but include result copying and output clearing. Result
equality is checked before timing. This isolates bulk-transfer improvements from
claims about raw guest arithmetic, and preserves the owning-result contract.

| Kernel / path | Baseline p50 (ms) | Candidate p50 (ms) | Speedup |
|---|---:|---:|---:|
| sum / copying | 0.1856 | 0.0574 | 3.23× |
| sum / prepared | 0.0247 | 0.0241 | 1.02× |
| identity-output / copying | 0.2284 | 0.0884 | 2.58× |
| identity-output / prepared | 0.1049 | 0.0578 | 1.82× |
| prefix-output / copying | 0.2435 | 0.0994 | 2.45× |
| prefix-output / prepared | 0.1157 | 0.0806 | 1.43× |

### Algorithmic stopping

Both searches return the same first index or -1 on finite input. The old source uses
an exhaustive fold; the new source explicitly uses `fold_until`. Raw Wasm calls reuse
encoded inputs, with no adapter copy or scrub cost. The first-hit case visits **one
rather than 65,536 events**; its near-call-overhead timing is too sensitive to headline
as a universal multiplicative speedup. The table includes adverse last/absent cases.

| Match | Baseline p50 (ms) | Candidate p50 (ms) | Candidate events |
|---|---:|---:|---:|
| first | 0.046556 | 0.000011 | 1 |
| middle | 0.063078 | 0.034452 | 32769 |
| last | 0.082759 | 0.071852 | 65536 |
| absent | 0.080955 | 0.069629 | 65536 |

This is an algorithmic improvement over an exhaustive traversal, not a claim that
Wasm invented early exit or necessarily outperforms an optimized JS early-exit loop.
Ordinary `runtime.call` still copies the entire input before running a stopping kernel.
Prepared inputs are the relevant API when repeating queries over an unchanged array.

## Limits and preserved boundaries

No SIMD, guest heap, runtime closures, implicit host authority, async effects, general
recursion, dynamic reducer objects or materialized intermediate records were added.
The ABI version is unchanged; source linking is one global namespace. Stopping sinks
remain excluded from exhaustive fusion cohorts. Library product state can still grow
with composition; existing source/expansion/ABI resource limits remain in force.
A native WebAssembly.Module carries code, not a shared private runtime or capability.
No blanket allocation-free claim is made about JS compiler/cache/adapter operations.
