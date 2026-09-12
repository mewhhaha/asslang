# Native ordering validation

[Design and usage](NATIVE-ORDERING.md) · [Validation index](EVIDENCE.md)

## Revision, execution boundary and scope

Base main `269b23cd45a9230dce248e5d804805925f769280` merges PR #30. Its tree
`968cb40d1d02d95afd6bfdabd56b09ecd7387d3a` exactly matches the supplied source
archive. The unchanged reconstructed baseline passed 1,297 Node tests. The
initial design document was committed before changing implementation or tests.

`sort_by` is now a compiler builtin: source consumption, key evaluation, stable
merging and downstream projection all execute in generated WebAssembly. The
example module imports only `env.memory`, not a sorting function. The host
experiment remains separate and its proposed `partition_rec` spelling remains
unimplemented. No arbitrary-recursion proof synthesis is claimed.

Sorting introduces actual runtime-sized intermediate buffers, a new JTE ordering
rule, and an explicit ASABI 2 scratch convention. Existing value layouts are not
changed; modules with no reachable order remain ASABI 1. The old reader rejects
new version-2 modules. No dependency, workflow permission, old historical report,
root README, host capability rule or parser token is changed.

## Executed local checks

September 12, 2026. Node v22.16.0, Linux x64, Chromium 144.0.7559.96;
benchmark CPU AMD EPYC 9V74. Local results are separate from GitHub CI.

| Check | Completed result |
| --- | --- |
| Unchanged baseline `npm test` | 1,297 passed; no failures/skips |
| Full `npm test` | 1,333 passed; no failures/skips |
| `npm run test:native-ordering` | 32 passed |
| `npm run test:docs` | 26 passed |
| `npm run test:browser` | 1,662 core + 276 experiment assertions; 138 experiment cases |
| `npm run test:browser:http` | Attempted; `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| Host, reducer, case-study, workflow and native-ordering examples | Passed |
| `npm run build:example` | Passed |
| New CLI example, source/document equality and driver subprocess | Passed |
| Changed/new module syntax checks; `git diff --check` | Passed |
| Actual baseline comparison | 768 identical binaries, ABI objects and JTE certificates |
| `npm run bench:native-ordering` | Executed; all timed results independently checked |

The browser suite adds 72 dedicated assertions across all eight SIMD/fusion/
memoization configurations, plus eight assertions from the two new corpus
entries. It tests the real native sorter, stable positions, no host sort imports,
exact scratch/output allowances, exact loop bounds, prepared scalar overrides,
empty results and post-trap recovery. Both HTTP and bundled harnesses register
the checks; only the bundled path completed in this environment. No browser
policy was changed or bypassed. Other browser engines and worker loading remain
unverified.

## Stable values and complete demand

Exhaustive native tests cover all 3,280 words of lengths zero through seven over
{-1,0,1}, comparing their exact original-position permutations with an independent
sort by (key, original index). The preceding experiment's linear `verifyOrder`
checker also validates those results. Another 640 seeded cases and 32 large
ordered/reverse/equal/organ-pipe cases run across eight lowering configurations;
the large structured inputs have 8,192 elements. Benchmark runs additionally
exercise 32,768 elements. These are finite tests, not a formal proof kernel.

Fixed cases cover negative keys, both signs of zero, subnormals, extreme finite
keys, nested record payloads and Bool payloads. Raw tests preserve explicit NaN
payload bits, infinity and signed-zero payloads under a finite constant key.
A nonfinite *key* always traps; nonfinite payloads are allowed when their key is
finite. The merge copies bits without arithmetic on payloads.

Tests demonstrate the strict barrier: `count` and `at` demand every accepted key;
a later invalid key cannot be hidden by selecting an early result. Every payload
leaf is materialized, including a trapping field not projected by a later map.
Unused orders and unselected branches do not execute. Empty source guards still
run, whereas empty causal initialization and key functions do not. A filtered-out
item is not keyed, and a transducer retains its original input clock before
ordering its emitted values. The reference interpreter adds only a simple stable
semantic model; its existing causal/suffix limitations are not weakened.

## Sharing, scope and provenance

A shared record order supplies values and original positions with one scratch
reservation. Chained stable sorts retain separate buffers; a sort demanded by
another sort's key cannot overlap the in-progress materialization. Reserving both
buffers before item/key evaluation is tested with this dependency shape.

Runtime callback/iterate construction is rejected with `E_ORDER_SCOPE`. An
invariant sorted binding created outside a callback can be indexed from every
iteration without repeating its sort. All eight lowering modes test this at an
exact shared work limit. Scope restrictions are conservative, not a general
scratch-lifetime inference system.

JTE marks ordered results dense and seekable with a fresh domain, including after
filtering or causal input. `at` is therefore valid on the materialized order.
Zipping an order with its unsorted source or an independent order is rejected;
shared sorted projections retain alignment. Corrupt domain and missing ordering-
obligation certificates are rejected. These are structural provenance checks,
not verification of arbitrary third-party Wasm or comparator laws.

Type and source-location tests cover wrong key results, empty/oversized payload
shapes, array-of-record ABI rejection, illegal host calls, unsupported AD and
runtime nested sorting. Partial application, local patterns, static-symbol fields,
vertical/compact/CRLF formatting, cache snapshots and old frozen binaries work.
Limits of 32 sites and 32 leaves are tested at and beyond the boundary.

## Work and memory

The ranking fixture consumes [7,10,4,7,5] with center 5 and returns positions
[4,2,0,3,1] and values [5,4,7,7,10]. Its two-leaf records have 24-byte rows and
reserve **240 scratch bytes**, plus **80 output bytes**. It consumes exactly
**39 emitted loop units**; an otherwise identical 38-unit artifact traps. The
metered module is **2,444 bytes**. Its module import list contains only memory.

For plain sorting consumed by `count`, exact loop work is independently computed
as N plus, for each doubling width below m, one pass iteration, ceil(m/(2*width))
run-dispatch iterations and m row writes. All eight modes test exact and one-less
allowances at lengths 0,1,2,3,5,16,33. Keys containing their own range reductions
are tested at a limit requiring those loops once per item, not once per merge
comparison. Earlier host effects consume capability quotas in order and are not
rolled back by a later sort-budget failure.

Raw entry tests reject scratch/input, scratch/descriptor and scratch/output
aliasing, misalignment, negative/oversized capacities and invalid pointers before
stores. Exact capacities succeed; one byte less fails. Inputs and canary bytes
outside granted regions remain unchanged. A 2,147,483,647-item range with a tiny
scratch span fails before size multiplication or iteration. Bad raw Bool values
still trap. The capacity proof bounds row addresses and doubled merge widths.

Sparse input reserves by its source traversal extent N, not accepted length m.
A stream emitting zero values can therefore still require scratch. This explicit
conservative bound is tested; existing sparse *output* allocation is unchanged.
Multiple demanded sites retain disjoint regions until invocation end. Scratch is
not output space, caller input, a hidden growing heap or an authentication token.

Managed and prepared calls copy input snapshots and return owned output values.
Prepared overrides change the next invocation's ordering without persisting;
flags/cursors reset each call. Errors do not publish partial results, expired
leases fail, and subsequent calls recover. Invalid host capacities and forged
scratch metadata are rejected. Raw callers must discard failed-call output and
provide exclusive unshared memory; this is not a sandbox audit.

## Actual-baseline compatibility

An independent baseline checkout compiles all 96 old accepted corpus entries in
all eight SIMD/fusion/memoization configurations. All **768** Wasm binaries,
ABI metadata objects and JTE certificates equal the new compiler's outputs.
A separate old-runtime import rejects a new scratch module with `E_ABI_VERSION`.
The frozen ASABI 1 binary continues to execute through the updated runtime.
Non-sorting exports inside a version-2 module keep their old raw argument slots.

These finite comparisons do not claim compatibility with hypothetical old user
functions named `sort_by`: that identifier is now a reserved builtin. Scratch
metadata is opt-in by actual reachable ordering nodes, not merely an unused
binding. No silent change to ASABI 1 layout or default old-program code is made.

## Exploratory timing, including a stronger native baseline

The benchmark records two warmups and five samples for each input/implementation.
Compilation, instantiation, input generation and reference checking are outside
timing. Wasm timings include input copying, native sorting, output copying and
whole-arena scrubbing. The prior JS partitioner includes instrumentation and
payload gathering. `nativeTyped` copies/validates and uses a JS comparator;
`nativeNumeric` copies/validates and uses the optimized numeric typed-array sort.
All generated benchmark keys are finite and contain no negative zero; numeric
builtin sorting is a valid *value* baseline here, not an identical general
signed-zero tie contract. It is not a Haskell/GHC or GPU measurement.

Median milliseconds at 32,768 keys in the recorded run:

| Input | Native Wasm | Prior JS partition | Native typed / JS comparator | Numeric typed builtin |
| --- | ---: | ---: | ---: | ---: |
| random | 2.767 | 15.051 | 6.655 | 2.713 |
| ascending | 0.785 | 9.133 | 2.575 | 1.218 |
| descending | 0.835 | 9.904 | 2.664 | 0.943 |
| equal | 0.807 | 2.414 | 2.743 | 0.822 |
| low cardinality | 0.970 | 3.637 | 3.917 | 1.286 |
| organ pipe | 0.863 | 23.451 | 2.885 | 3.723 |

The optimized numeric builtin is slightly faster on random data in this run.
These single-process samples do not establish universal speedups or stable
rankings across hardware/engines. Algorithm, instrumentation, JIT and cleanup
costs differ. Every sample is retained in the delivery JSON, including an earlier
comparator-only run, rather than selecting only favorable cases. Timing is not a
CI gate. The unmetered numeric sorting module is 1,569 bytes.

## Development corrections and remaining limits

The first regression run identified the intentionally version-sensitive old ABI
rejection test and a not-yet-linked design document. Invalid v2 metadata with no
scratch export now retains `E_ABI_VERSION`, and navigation was completed. The
first focused run found a missing test import and a shape test whose unsupported
export ABI failed before staging; those test fixtures were corrected. No compiler
limit, old assertion or browser policy was weakened. Subsequent runs passed.

This backend supplies explicit native finite ordering, not checked recursive
partition elaboration. It is scalar, not a parallel/GPU or causal SIMD sorter.
The strict barrier does not support lazy sorted prefixes or infinite inputs.
Keys may themselves be expensive, and sorting is not differentiated. Record
streams must be projected before crossing the unchanged value ABI. Scratch
lifetime reuse, nested dependent sorts and adaptive partition selection remain
outside this PR. Written proofs and finite tests are not proof-assistant
verification, independent formal review, historical novelty or production
certification. Remote commit/tree identifiers and CI results belong in the PR
rather than being inferred from these local runs.
