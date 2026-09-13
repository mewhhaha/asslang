# Chunk programs without chunk buffers

[Array views](ARRAY-VIEWS.md) · [Vertical composition](VERTICAL-COMPOSITION.md)

## Run the examples

```sh
npm run example:chunk-views
npm run test:chunk-views
printf '[[10,13,20,18,30],2]' | node examples/case-studies/app.mjs chunk-block-report
```

### Reset the reference, not the running total

For `[10,13,20,18,30]` and width 2, subtract the first reading in each block.
Flatten those pointwise adjustments, zip them with the original readings, and
scan continuously. Relative readings are `[0,3,0,-2,0]`, totals `[0,3,3,1,1]`.
The final singleton block is handled automatically. No chunk data or descriptor
array is built; one default fused loop returns the two traces and final state.

<!-- chunk-example: block_report -->
```ass
// Reset the reference in each block, then carry one state across all blocks.
export fn block_report = (readings:[Num]) -> (width:Num) -> do {
  let relative =
    readings
    |> chunks width
    |> map (block -> do {
      let first = at block 0;
      block |> map (reading -> do {
        let value = reading-first;
        require (value-value == 0) value
      })
    })
    |> flatten;
  let initial = {value:0, total:0, original:0};
  let history =
    zip readings relative (reading -> value -> {reading, value})
    |> scan initial (state -> row -> {
      value: row.value,
      total: state.total+row.value,
      original: state.original+row.reading,
    });
  {
    relative: history |> map (state -> state.value),
    totals: history |> map (state -> state.total),
    state: history |> fold initial (previous -> next -> next),
  }
};
```

### Scan inside each block

The same readings give `[33,58,30]`: sum each block's running totals.
The inner scan starts fresh per block; unlike the first example, it is not a
continuous scan across the flattened sequence. Only three results are stored.

<!-- chunk-example: block_exposure -->
```ass
// Sum running totals independently inside each block, including the short tail.
export fn block_exposure = (readings:[Num]) -> (width:Num) ->
  readings
  |> chunks width
  |> map (block ->
    block
    |> scan 0 (total -> reading -> total+reading)
    |> sum);
```

### Pair blocks, then pair their elements

For `[1,2,3,4,5]` and `[2,3,4,5,6]` at width 2, the block dot products
are `[8,32,30]`. The outer check compares block counts; the inner check also
protects unequal final-block lengths. No host zip or temporary block arrays.

<!-- chunk-example: paired_blocks -->
```ass
// One dot product per block, with checked pairing at both levels.
export fn paired_blocks = (left:[Num]) -> (right:[Num]) -> (width:Num) ->
  left
  |> chunks width
  |> zip_checked (chunks right width) (a -> b ->
    zip_checked a b (x -> y -> x*y) |> sum);
```

The driver checks exact loop and output allowances: five units and 80 output
bytes for the five-reading report, eight units and 24 bytes for each three-block
reduction. Output descriptors are separate. One fewer loop unit traps. These are
artifact/workspace measurements, not throughput benchmarks. Complete default
and disabled-fusion results are covered by the tests.

For a simpler reduction, `xs |> chunks width |> map sum` uses the
same nested-loop mechanism. Functions and partial applications remain ordinary
staged Asslang, rather than a second chunk-specific callback language.

## Design before implementation

Merged main `f074696532798345c0e67c572b75652d336d469c`, tree
`e85ca6e55b54dbfb0259b3aee80fca271e4b3900`, supports one checked cut and virtual
concatenation. Repeating a calculation over many fixed-width blocks still requires
manual ranges, offsets and tail handling. The unchanged baseline passed 1,404
Node tests with concurrency two before this change.

Add `chunks : [a] -> Num -> [[a]]` and `flatten : [[a]] -> [a]` as staged view
operations. `chunks xs width` yields consecutive nonempty blocks, with a possibly
short last block. Empty input has no blocks. Width is a positive integer at most
INT32_MAX and is checked on structural demand even for empty input. No new token,
indentation rule, tuple convention, ABI layout or host nested-array format is
introduced. The two builtin names become reserved globally.

The nested stream is a compiler plan, not an allocated array of arrays. Ordinary
`map`, `zip`, `zip_checked`, `at`, `filter` and folds may consume its block values.
A block callback can return a scalar/record as before, or directly return a stream.
This extension is restricted to callbacks receiving block streams; scalar-to-stream
`map` and records containing stream fields are not a general ragged-array feature.
Nested chunking itself is deferred. A nested stream cannot cross the existing ABI:
reduce its blocks, select a block, or use checked flattening first.

## Two deliberately separate consumption paths

**Block reductions.** `xs |> chunks width |> map sum` emits an
outer block loop containing a normal inner reduction. It visits N elements and
C=ceil(N/width) block events, uses scalar locals and the final C-element output,
and needs no block data or descriptor buffers. The ordinary inner operation may
be a scan, stopping fold, checked zip, filter, or record fold. Its own demand and
cost remain. Multiple independently returned summaries can replay work; no new
multi-sink optimization is claimed.

**Cover-preserving flattening.** `chunks xs width |> map (block -> map block f)
|> flatten` turns a checked complete ordered cover back into a flat indexed plan.
For flat position i use quotient q=floor(i/width) and remainder r=i%width; substitute
q into the block callback and r into its inner item. Mapping either level changes
values, not positions. A subsequent ordinary zip with xs can use the recovered
event domain, without a length check. A subsequent scan carries one state across
the entire flattened result. This does not reset that scan at block boundaries.

Flattening requires an unfiltered, unpermuted complete outer chunk cover and a
dense, seekable inner stream covering the corresponding whole block in order.
Maps and same-domain zips preserve that proof; an inner split followed by checked
rejoin can recover it. Mixing different chunk families, replacing blocks, changing
length, rotation, sorting, outer filters and unrelated checked zips do not forge
it. Different widths can each flatten their own complete cover back to the same
source domain; that does not equate their outer block domains. An independently
selected block receives a fresh domain, so selecting block
0 and block 1 cannot accidentally prove event alignment.

The initial flattening path rejects item/structural graphs containing reductions,
stopping folds or bounded iterations (`E_CHUNK_WORK`), and causal inner streams
(`E_CHUNK_ACCESS`). In particular it must not silently recompute `sum block` for
every flattened element. Put block aggregates on the reduction path, or scan after
flattening. This is an explicit limit rather than a hidden quadratic or allocating
fallback. An existing materialized sort is an atomic dependency with its existing
scratch/demand semantics, not a new per-block sort. Sort construction inside a
block callback remains rejected by the ordinary runtime-scope rule.

## Structural demand and empty cases

The outer plan retains source guards and a checked positive width. The inner view
has exact extent min(width,N-q*width). It has no speculative loads from the tail.
Block-local guards introduced by transformations are structural obligations. On
flatten demand, preflight these guards over all C blocks using one metered scalar
validation reduction before any flattened items. This validates empty/count/at
consumers as well as full output. With no such guards, no preflight loop is emitted.
This is consistent with concat's strict structural contract; it is not lazy-list
flattening. Later block structural errors can fail a requested early item.

Item expressions remain demand-driven: an unused mapped value or an element
past a stopping fold is not evaluated just to validate structure. An entirely
unused or unselected chunk computation stays lazy, while types are still checked.
Count of blocks computes C without entering elements; count of a flattened view
validates structure, not mapped item values. Empty input has no inner blocks and
runs no block-local guards or lazy scan seeds. Source guards and width validation
still run. No exact first-trap or partial-output equivalence with manual rewrites
is promised. Failed raw outputs must be discarded; host effects are not rolled back.

## Representation, scope and arithmetic

Store one staged outer cursor, one inner cursor, a checked width, extent formulas
and compiler-only family lineage. There is no runtime offset vector, descriptor
array, persistent rope, heap closure or scratch reservation for chunks/flatten.
The metadata size depends on the source expression, not N or C. Existing output
arrays, input copying, compiler allocations and native-ordering scratch still cost
memory. No constant-space materialized output claim is intended.

Compute C as zero for N=0, otherwise 1+floor((N-1)/width), avoiding N+width-1
overflow. For a valid block index q<C, q*width <= N-1, so multiplication fits i32.
The inner length is min(width,N-q*width); a valid r gives q*width+r<N. Flatten
uses these same equations, and width validation precedes division/remainder.
All public counts are still Num with the existing checked integer boundary.
Generated operations are compiler-only i32 arithmetic, not reassociation of f64.

Substitution must descend into stream-valued items and their guards, machines,
initial values and nested reductions. Lexical cursor identities remain distinct;
reusing a block family in a nested traversal cannot capture its outer traversal.
Selecting one block creates fresh provenance after substitution. Existing sort
nodes and issued effect results stay atomic invocation dependencies. The existing
64-level view-depth and source/staging budgets remain; no limit is raised.

## Proof obligations

For N>=0 and positive W, the half-open intervals
[qW,min((q+1)W,N)), 0<=q<C, are nonempty, disjoint, ordered and cover [0,N).
Division with remainder gives each original i a unique pair (q,r). The block
injection maps that pair back to qW+r=i. Thus flattening the certified cover is
identity on positions, even when a block-local map changes every value.

The ledger reconstructs the family from `chunks` and `chunk` parents. Flatten
must match that exact family in both dimensions, not merely their counts. Mapping
preserves lineage, while a new/selected/filtered domain does not. The verifier
checks obligations and parent structure before accepting a restored source domain.
A forged domain or an inner view from another family must be rejected. The ledger
certifies relational facts, not the complete generated binary.

Nested block folds have the usual induction on the outer block index, and the
existing reduction/scan induction inside each block. Every source position is
visited once for one full fold per block. Scan initialization belongs to the inner
traversal, so each block begins with its seed without a stored scan history. A
scan after flatten uses one continuous recurrence instead. f64 arithmetic order
is unchanged within each actual recurrence; aggregate regrouping across blocks
is NOT an equality claim about floating-point sums.

Flattened pointwise work is O(N) for bounded item functions, plus O(C) structural
preflight when needed, with no intermediate data buffers. A block reduction path
costs O(C+sum blockWork), not automatically O(N) for arbitrary callbacks. Guard
loops and every nested reduction use the existing shared invocation allowance.
This design deliberately does not promise arbitrary efficient flat_map.

## Validation plan and prior art

Run useful block summaries, per-block causal totals and aligned flattened
adjustments. Compare against independent JS block loops, explicit indexed source
and the reference interpreter. Cover all eight lowering configurations, empty and
short tails, width validation, maximum virtual extents, nested captures, same and
independent domains, selected block provenance, Bool/record items, strict shapes,
partial application, source diagnostics, effects, leases and raw canaries.
Check exact loop/output capacities, no scratch, no input mutation, cache copies,
post-trap reuse and certificate tampering. Compare all prior corpus bytes/ABI/
certificates to the actual baseline. Register examples and both browser harnesses;
run required repository checks and report only what completed.

Nested array programs, deferred views and flattening have substantial prior art.
Futhark's July 31, 2026 discussion describes segmented representations and the
space risks of full flattening; its August 12 discussion separates irregular
flatmap expressiveness from the compiler's flattening transformation:
https://futhark-lang.org/blog/2026-07-31-full-flattening.html
https://futhark-lang.org/blog/2026-08-12-flatmap.html
Sources checked September 13, 2026. This much narrower sequential-Wasm design uses
an arithmetic chunk cover rather than a runtime segment vector. No new general
category-theory theorem, worldwide novelty, GPU parallelism, universal fusion,
formal proof-assistant check or measured throughput improvement is claimed.

## Executed evidence

[Validation report](CHUNK-VIEWS-VALIDATION.md) records the actual kernels, exact
resource boundaries, baseline comparisons, browser results and remaining limits.
