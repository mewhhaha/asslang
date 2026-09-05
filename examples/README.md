# Reduction-fusion integration

`rms.ass` from PR #1 is registered in the shared corpus. Dense `count` already
avoids traversal, so RMS uses one loop with either compiler option. Explicit
same-schedule reductions can additionally fuse with `experimentalReductionFusion`.
`multi_reduction.ass` goes from two loops to one, and `scan_replay.ass` shares one
recurrence frame instead of replaying it twice. Fusion remains off by default.

# Corpus update: 0.2

There are 35 accepted exports across 33 source files, and 3 deliberate rejections.
New cases cover prefix scan, EWMA, segmented scans, running z-scores, rolling means,
ASCII unsigned-integer lexing, bounded Newton iteration, product/connection of
machine descriptions, and separate-consumer recurrence replay. Every source and
export is registered in `corpus.mjs`, which drives correctness and benchmarks.

`algorithms/prefix_scan.ass` is a linear-time replacement for the intentionally
quadratic `pathological/repeated_prefix.ass`. The compiler does not automatically
rewrite the old algorithm. `pathological/scan_replay.ass` intentionally retains two
traversals. `rejected/` checks non-seekable history and unproved transducer alignment.

The remaining notes describe the original algorithm corpus and still apply:

# Executable example corpus

`corpus.mjs` registers every `.ass` file and every accepted export. Tests enforce
complete registration, compare fixed expected answers with both Wasm execution
and an allocation-heavy reference interpreter, and check the rejected example's
diagnostic. The same manifest supplies compilation and runtime benchmarks.

| Directory | Examples / purpose |
| --- | --- |
| Root | Energy, sum of squares, aligned filtered views, checked dot product, deliberate provenance rejection |
| `algorithms/` | Welford statistics, centered linear regression, Fibonacci, normalization, window correlation, binary search, Horner polynomial evaluation, partition, pairwise distances, byte checksum |
| `concepts/` | Staged trait dictionaries, inferred type-shape transformations, runtime contracts and static relational refinements |
| `interop/` | Nested JS values and explicitly granted host effects; `host.mjs` is a runnable embedding |
| `pathological/` | Shared reductions, repeated prefixes, multiple reductions and expanding function composition |

Run `npm run test:corpus`, `npm run bench`, and `npm run bench:browser`. The browser
playground also lists the corpus, accepts a JSON argument array, and requires an
explicit checkbox for its tightly restricted demo host grants.

## Performance traps retained deliberately

**Repeated prefixes** read well as a range of prefix reductions, but still take
quadratic work. The JS benchmark baseline deliberately uses a linear scan; this
is a missing algorithmic lowering, not something hidden by a weak comparison.

**Multiple reductions** still perform multiple traversals. Welford's record state
is the current way to write a true one-pass multi-statistic computation. There is
no general multi-sink fusion pass.

**Expanding composition** is staged by body expansion. Larger generated variants
reach the explicit `E_LIMIT` budget. There is no claim of separate compilation or
linear compile-time complexity.

**Convolution** still pays repeated checked random-access costs and lacks SIMD and
loop tiling. It is retained even when slower than the JS baseline.

Two discovered pathologies were fixed: nested traversals now distinguish lexical
cursors from JTE observation identity, and reductions invariant across a loop are
memoized lazily on first demand. Dense `count` also uses the validated extent
rather than traversing values. Tests keep empty/unselected trapping computations
from being speculatively evaluated by those changes.

The algorithms use f64 arithmetic, not arbitrary precision. `convolve` applies
weights in their given order (the cross-correlation convention). `lower_bound`
requires sorted input; it does not scan to validate that precondition. The checksum
is additive and explicitly non-cryptographic. Empty and degenerate numerical cases
have documented outputs rather than hidden divide-by-zero behavior.
