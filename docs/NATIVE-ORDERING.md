# Native stable ordering and bounded scratch

[Partition experiment](PARTITION-RECURSION.md) · [Documentation](README.md)

## Design before implementation

PR #30 tested a host lowering target; it did not implement sorting in Asslang.
The next step makes a finite ordering barrier usable in ordinary pipelines:

```text
readings |> sort_by (reading -> abs (reading-center))
```

`sort_by : [a] -> (a -> Num) -> [a]` stably orders finite keys, with scalar
Num/Bool or nested scalar-record payloads (at most 32 leaves). It is a closed
compiler builtin, not a runtime host callback. Arrows, pipes and application
retain their existing rules. This is the native storage/reordering substrate,
NOT the proposed `partition_rec` checker, unrestricted recursion, an automatic
quicksort recognition pass, or a new sorting algorithm.

Baseline main `269b23cd45a9230dce248e5d804805925f769280` has tree
`968cb40d1d02d95afd6bfdabd56b09ecd7387d3a`. The supplied source reconstructs that
exact tree. The design is recorded before code or test changes.

## Semantic contract and composition

On demand, consume the whole finite input once in its original event order,
including causal transitions and filtering. Evaluate every payload leaf and one
key per accepted item; reject a nonfinite key. Keys are ascending and equal keys
preserve input order. Both signs of zero are equivalent keys. Payloads themselves
may be nonfinite when their key is finite; no arithmetic is applied while copying
payloads. A record payload is strict at this barrier: projecting one output field
later does not excuse a trap in another input payload field.

The barrier is lazy as a whole. Unused sorting and unselected branches do not
execute it. Once demanded, even `count`, `at` or `fold_until` must finish it and
validate all accepted keys. Sorting a prefix is not selection; `at sorted 0` is
not rewritten to a minimum search. Empty input executes source guards but no
key calls or causal initialization. NaN is never treated as a total-order key.

A shared sorted binding materializes once per invocation, independently of the
reduction-memoization option. Its immutable rows can feed `map`, `filter`, `scan`,
reductions, `at`, record projections, and further top-level `sort_by` stages.
Separate calls receive separate ordering identities. JTE introduces a new dense,
seekable event domain; sorting does not prove alignment with the original stream
or an independent sort. Explicit `zip_checked` remains the positional operation.
Record streams must be projected to supported scalar streams before export;
ASABI does not gain arrays of records. Partial application and named key helpers
remain statically staged. Source key computations can have their own metered
loops and cost; sorting O(n log n) does not bound arbitrary key production.

This first version rejects construction of a sort inside a runtime stream
callback or `iterate` transition (`E_ORDER_SCOPE`). Bind invariant orders outside
those loops and reuse them. This makes invocation lifetime and caching sound
without pretending that one scratch frame handles arbitrarily many dependent
inner sorts. Ordinary top-level branches and sequential orders are supported.
Existing source/type/expansion limits apply, with at most 32 reachable sort sites
per export and 32 payload leaves per site. Sorting cannot be differentiated;
ordinary unsupported-AD diagnostics remain rather than inventing a derivative.

## Native representation and stable algorithm

Each accepted row is a cached f64 key followed by one eight-byte slot per payload
leaf. Num uses f64 load/store; Bool uses four bytes within its slot. Two adjacent
row buffers of stride `8*(1+leaves)` are reserved in an invocation scratch arena.
No JS sort, host import, `memory.grow`, guest object graph or recursive stack is
used. One source traversal materializes rows. Iterative bottom-up mergesort merges
adjacent sorted runs into the other buffer and swaps the two base pointers.
Choosing the left row when keys are equal establishes stability. No copy-back
pass or concatenated child array is required. Downstream streams read the final
buffer and materialize their own ordinary output arrays as required.

Reserve using the source traversal extent N, even for filtered input with m<=N
accepted rows. Required scratch at one site is `16*(1+leaves)*N` bytes. This bound
is deliberately conservative for sparse data, which may fail a workspace bound
even when a compact accepted-row allocation would fit. Unlike existing sparse
output materialization, sorting is a new explicit storage barrier with this
published reservation contract. Multiple demanded sorts retain disjoint buffers
until invocation end; their reservation sizes add. There is no lifetime reuse or
claim of one global O(n) workspace for a pipeline of an unbounded number of sorts.

At least one payload leaf is required. Initial source guards/extent are evaluated
before reservation; a dependency sort can therefore finish before a later sort.
Reserve the complete two-buffer region before running item/key expressions, so
other previously bound sorts demanded by a key cannot overlap this region.
A per-site private flag marks completion; no flag is set on a failed sort, and
all flags/cursors start fresh on each export call. No partially ordered result
is published after a trap.

## Scratch ABI: opt-in version, unchanged old programs

ASABI 1 has no scratch argument. Do not hide writes in input/output storage or
pretend that intermediate storage is zero. Modules with a reachable sort use
**ASABI 2**, a narrow extension with unchanged value layouts and per-export
`scratch:{version:1,slots:[pointer,capacity]}` metadata. The two i32 slots follow
all existing input and (when indirect) output slots. Non-sorting exports in the
same module keep their original slots. Modules without reachable sorts remain
ASABI 1 and retain their previous binaries. An old adapter rejects version 2
rather than accidentally running an unfamiliar raw convention.

The current adapter accepts both versions. `call`, `prepare` and `prepareCall`
accept `scratchBytes` only for exports with scratch metadata. It is a host-owned
capacity, not an authority capability or permission to allocate without limit.
Defaults use half of the remaining aligned arena for an indirect result, or all
of it for a scalar result; the output uses the rest unless `outputBytes` is given.
Explicit `scratchBytes` and `outputBytes` give reproducible separate limits. Input
lowering and result descriptor allocation precede the two regions. Normal calls
scrub/reset the arena; prepared calls preserve input snapshots but scrub scratch
and output after every run, including failure. No raw scratch view escapes.

At entry, check scratch alignment, span, nonwrapping end <= INT32_MAX, and
nonoverlap with every borrowed input, output descriptor and output allowance.
Checks run before host effects. Before reservation, compare N with
`floor((scratchEnd-scratchCursor)/(2*stride))`; only then multiply. This proves
both regions fit without overflow. Every row address is within its reserved
region by the loop invariants. A raw caller must pass an unshared memory and
exclusive, disjoint regions and discard failed-call results. Engine memory bounds
are necessary but not sufficient for separation within linear memory [1].

Diagnostics expose scratch reservation sites/strides and the stable merge
algorithm. `intermediateBufferBytes` is null (runtime-sized), not zero, for a
module that needs scratch. The existing zero count remains for old programs.
The emitted-loop budget meters source materialization, merge passes, run dispatch
and each merged row. There is no separate unmetered sort counter or comparison
callback. Static leaf copies are bounded by the 32-leaf cap, not charged as
individual loop iterations. Key/producer loops debit the same invocation budget.

## Proof obligations

**Materialization.** Induct on source events. The existing causal schedule has
unchanged gates/state; accepted rows are written consecutively in source order.
Each row contains the complete payload and its one finite key. The accepted count
never exceeds source extent, so it remains inside the first reserved buffer.

**Merge invariant.** Initially each length-one run is sorted and stable. Merging
two adjacent stable sorted runs by selecting the smallest head, choosing the left
on equality, produces exactly their stable sorted permutation. Exhausted runs
contribute only the other run. The output cursor fills the same interval once.
Distinct intervals in a pass are disjoint and cover all m rows. Buffer swapping
therefore preserves the invariant at doubled run width. When width>=m, the whole
buffer is sorted, stable, and a permutation of materialized rows. Row copies do
not recompute keys or change payload bits.

**Work.** Let h=ceil(log2(max(1,m))). Each of h passes dispatches at most m runs
and writes exactly m rows. Sorting comparisons are at most m*h. Added loop work
is at most N+h+2*m*h (excluding input/key loops and downstream consumers).
This is O(N + (leaves+1)*m*log(m+1)) primitive row-copy work, with a fixed leaf cap.
It is worst-case, independent of pivot behavior. The all-equal case here is still
O(m log m), unlike PR #30's three-way partition special case. No universal speedup
or parity with tuned native host sorting is claimed.

**Sharing and scope.** Invocation-closed orders have the same immutable inputs on
every demand in that call. The first successful demand establishes the final
pointer/count and flag; subsequent demands reuse them. Calls within runtime
binding scopes are rejected, so a flag cannot accidentally reuse a previous
iteration's data. New domains prevent an ordering operation from forging original
stream alignment. Guards in unselected branches remain unselected.

**Memory.** Checked reservation gives two bounded disjoint row regions. Source
writes index<m<=N; merge writes index<m; read cursors are checked against their
run ends before loading. Finite capacity also bounds doubled widths/run offsets
well below i32 overflow. Output remains separately allocated and copied; scratch
pointers are compiler-internal and never an ABI value. Separate-demand sorts use
monotone reservation, not overlapping reuse. These are written invariants, not
a machine-checked proof of the complete compiler.

## Alternatives, validation and sources

A generated JS wrapper would repeat the host experiment rather than add native
execution. Hiding scratch in output allowance would obscure capacity and scalar
result behavior. Extending v1 silently risks incompatible adapters. A full
partition-recursion checker is valuable but not prerequisite to verifying native
scratch, ordering provenance, and strict materialization separately. Stable merge
is chosen for a small verifiable first backend, not as a claim it is fastest.
Destination-based functional compilation and explicit work models are established
ideas [2,3]. The sort contract, not recognition of a pretty recurrence, selects
the algorithm; the recursive proposal remains separate future work.

Validate fixed/seeded/exhaustive stable permutations, finite keys, signed zero,
strict records, sparse/causal inputs, chained and shared orders, branch demand,
raw/managed/prepared memory, overlap/alignment/capacity traps, exact loop budgets,
large adversarial inputs, scope/type/AD/provenance errors and source locations.
Compare all old corpus binaries against the actual baseline across eight lowering
modes. Extend the independent reference interpreter only with a simple stable
semantic model. Add complete examples to normal discovery, both browser harnesses,
and execute required full/host/reducer checks. Report only completed runs.

[1] WebAssembly core specification, memory instructions:
https://www.w3.org/TR/wasm-core-1/#memory-instructions%E2%91%A0
[2] Shaikhha et al., Destination-Passing Style, FHPC 2017:
https://www.microsoft.com/en-us/research/publication/using-destination-passing-style-compile-functional-language-efficient-low-level-code/
[3] NESL, nested parallelism and explicit work/depth:
https://www.cs.cmu.edu/~scandal/nesl.html

Sources checked September 12, 2026. No historical novelty, automatic algorithm
proof synthesis, parallel speedup, proof assistant or audited sandbox is claimed.
