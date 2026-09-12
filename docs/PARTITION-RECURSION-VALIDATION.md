# Partition-recursion experiment validation

[Design, proofs and proposed syntax](PARTITION-RECURSION.md)

## Scope and source

Base: merged main f75b4586834f0f56841e58e7524bde3aec808bc7, tree
4cb759089fd5adc54ec2e364f67f03224c1c1bb9. A reconstructed baseline matches the
connected repository's tree. The design-only commit precedes implementation.

The backend is **JavaScript over typed arrays**, not generated Wasm sorting.
Existing Asslang/Wasm computes a distance key array in the integration example;
the host prototype orders its original positions. Proposed partition_rec/concat3
elaboration, region/recursive-capability checking and a Wasm sorting backend are
NOT implemented. No src file, parser rule, ABI, dependency, workflow permission,
compiler default or historical report changes. The root README is unchanged.

## Executed checks

September 12, 2026; Node v22.16.0, Linux x64, Chromium 144.0.7559.96.

| Check | Result |
| --- | --- |
| Unchanged reconstructed baseline npm test | 1,279 passed; no failures/skips |
| Full npm test on experimental source | 1,297 passed; no failures/skips |
| Focused partition-order suite | 18 passed |
| Documentation suite | 26 passed |
| Chromium engine suite | 1,582 core + 276 experiment checks passed |
| Required host and reducer examples | Passed |
| Actual Asslang/Wasm key generation | Passed across all eight lowering modes |
| Published experiment and benchmark | Executed; results independently checked |
| HTTP browser suite | Attempted; net::ERR_BLOCKED_BY_ADMINISTRATOR |

One initial full-suite attempt was interrupted by the execution timeout without
completing; the unchanged calibration suite passed on its own and a subsequent
unmodified full run completed successfully. No test assertion or resource setting
was weakened. HTTP loading/worker behavior was policy-blocked; no policy bypass,
HTTP success or other-browser result is claimed. Browser tests label the actual
backends: JavaScript sorting and Asslang/Wasm key production.

## Correctness and operational bounds

Exhaust all 3,280 words of lengths zero through seven over keys {-1,0,1}, under
first/middle/median3 pivot policies: **9,840 exact stable-permutation checks**.
Another 200 seeded arrays under all three policies give **600 comparisons** with
literal stable three-way recursion. An independent comparator sorts indices by
(key, original position); verifyOrder separately checks permutation, ascending
order and stability in linear time.

Tests exercise first-pivot fallback on sorted/reversed repeated-key data, organ
pipes, alternating signs, all-equal keys, signed zero, subnormals and extreme
finite keys. Deliberate duplicate/missing/out-of-range indices, wrong ordering
and sorted-but-unstable ties fail verification. NaN/infinity keys are rejected,
not treated as if ordinary numeric comparisons formed a total order on them.
Input/output ownership, frozen statistics, exact work-budget exhaustion and fresh
subsequent calls are checked. The maximum 1,048,576-element all-equal input runs
under the default limit; one element over the limit is rejected before allocation.
This does NOT imply every maximum-size input fits the default work budget.

All executed sort runs check the implementation-specific inequalities

    work <= n * (9*ceil(log2(max(1,n))) + 2)
    comparisons <= n * (3*ceil(log2(max(1,n))) + 3)

and the typed-storage formula 17*n + 12*(ceil(log2(max(1,n)))+2) bytes. The design
proves these conservative bounds from disjoint regions, a logarithmic partition
limit, stable merge passes and smaller-child-first scheduling. They count the
explicit loops/comparator calls and owned typed buffers, not CPU instructions,
GC, caller data, JS object headers, gathering payloads, or Wasm key generation.
No proof assistant or independent formal audit was performed.

## Separating algorithm improvements from allocation improvements

At 2,048 equal keys:

| Model | Comparator calls | Partitions |
| --- | ---: | ---: |
| Literal first-pivot two-filter recurrence | 4,192,256 | 2,047 |
| Literal median3 three-filter recurrence | 6,147 | 1 |
| Bounded region backend, median3 | 2,051 | 1 |

These are calls to each model's ordering comparator, not raw instruction counts.
The major quadratic-to-linear gain comes from handling equal keys as a terminal
band; the high-level three-way recurrence ALREADY has that advantage. One cached
classification pass then replaces three filters. The experiment must not credit
all of this improvement to allocation elimination.

For a 2,048-key organ-pipe input, the literal median3 three-way recurrence makes
3,148,797 comparisons. The region backend makes 56,522 and actually enters its
merge fallback. This demonstrates why median-of-three alone is not a worst-case
safeguard. First pivots on ascending 2,048-key data likewise enter fallback and
use 56,030 comparisons. This is not random pivoting or a distributional guarantee.

The prototype allocates 34,972 bytes of typed buffers at n=2,048. These include
copied keys, output indices, reusable scratch, tags and stack. No recursive child
arrays are created; stable scatter/copy still moves indices at each partition.
A result checker and payload gathering need additional memory outside that figure.

## Timings, not a fastest-sort claim

The retained benchmark uses two warmup runs and five recorded samples per case,
with verification and input construction outside timing. All sorting is JavaScript
on Node v22.16.0 / Intel Xeon Platinum 8573C. The reference is NOT a GHC benchmark.
The prototype and literal references are instrumented; native index sorting is
not. Native also copies and validates finite keys, but returns a JS index array
rather than a Uint32Array. JIT, case order, allocations and GC affect the timings.

Median milliseconds for 32,768 keys from this one run:

| Input | Region median3 | Native stable index sort |
| --- | ---: | ---: |
| random | 17.919 | 16.750 |
| ascending | 9.481 | 2.073 |
| descending | 9.105 | 2.053 |
| equal | 0.575 | 2.010 |
| lowCardinality | 1.782 | 4.807 |
| organPipe | 31.570 | 2.447 |

The prototype is slower on several important inputs, especially already ordered
and organ-pipe data. Native adaptive sorting remains a strong practical baseline.
The positive claim is a bounded stable implementation of the partition recurrence,
not a production throughput improvement. All raw timing samples and operation
counts are preserved in the delivery benchmark JSON. Timings are not CI gates;
no result is generalized to generated Wasm, Haskell, parallel execution or GPUs.

## Language integration and remaining work

Eight Node lowering combinations check actual Wasm distance keys, stable original
position ranking, exact guest loop exhaustion, invalid keys and recovery. The
Chromium harness performs 28 assertions including host fallback and its distinct
work budget. A negative test confirms partition_rec remains E_NAME, preventing
the proposal from being mistaken for an accepted compiler feature. Ordinary
source-local errors and pure host-call rejection remain in force.

The experiment verifies a candidate backend and its semantic specification, not
an automatic proof-directed compiler. Full integration needs finite-materialization
semantics, scratch lifetimes/bounds, structural recursive capabilities, checked
partition/ordering witnesses, reordering provenance and loop instrumentation for
all sorting work. A sorted prefix/selection rewrite needs its own demand proof.
Adding a builtin named sort would not by itself demonstrate a compositional
language mechanism. No novel sorting algorithm, unique historical priority,
user-readability study, allocation-free sort or unrestricted efficient recursion
is claimed.
