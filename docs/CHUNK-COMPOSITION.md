# Blocks as views, not arrays of arrays

[Array views](ARRAY-VIEWS.md) · [Vertical composition](VERTICAL-COMPOSITION.md)

## Write the block operation, not boundary bookkeeping

```sh
npm run example:chunk-composition
npm run test:chunk-composition
printf '[[1,2,3,4,5,6,7],3]' | node examples/case-studies/app.mjs chunk-report
```

### Local resets and a continuing global scan

<!-- chunk-example: block_report -->
```ass
// A local scan resets per block; the global scan continues through all blocks.
fn running_block = block -> block |> scan 0 (subtotal -> x -> subtotal+x);
export fn block_report = (samples:[Num]) -> (width:Num) -> do {
  let within = samples |> chunks width |> map running_block |> flatten;
  let initial = {local:0, total:0};
  let history =
    zip samples within (sample -> local -> {sample, local})
    |> scan initial (state -> row -> {local:row.local, total:state.total+row.sample});
  {
    local: history |> map (state -> state.local),
    totals: history |> map (state -> state.total),
    state: history |> fold initial (previous -> next -> next),
  }
};
```

For `[1,2,3,4,5,6,7]` and width 3, local totals are `[1,3,6,4,9,15,7]`;
global totals are `[1,3,6,10,15,21,28]`. The last block contains just 7.
Default fusion emits one loop and two scalar machines (three state slots), with
zero runtime zip checks. There are no intermediate block or boundary buffers.
Seven events require seven loop units; the two final arrays occupy 112 output
bytes, apart from the descriptor. Disabling fusion retains three consumer loops.
This does not promise faster wall-clock execution than an expert handwritten loop.

### One energy summary per block

<!-- chunk-example: block_energy -->
```ass
// One summary per nonempty block, including a short final block.
export fn block_energy = (samples:[Num]) -> (width:Num) ->
  samples
  |> chunks width
  |> map (block -> block |> map (x -> x*x) |> sum);
```

The same input yields `[14,77,49]`. One outer block loop and an inner reduction
use ten loop units (seven samples plus three blocks), and 24 final output bytes.
No block data array is created between them.

### Remove the mean with one summary computation per block

<!-- chunk-example: block_center -->
```ass
// The scan seed computes the mean once per block, not once per sample.
fn centered_block = block ->
  block
  |> scan {mean:sum block / count block, value:0}
    (state -> x -> {mean:state.mean, value:x-state.mean})
  |> map (state -> state.value);
export fn block_center = (samples:[Num]) -> (width:Num) ->
  samples |> chunks width |> map centered_block |> flatten;
```

The result is `[-1,0,1,-1,0,1,0]`. The seed visits each block once to compute
its mean; the scan then visits it once to emit centered values. This is fourteen
loop units and 56 final output bytes, not a one-pass claim. Empty input evaluates
no mean and performs no division by an empty block count.

A simpler-looking `map block (x -> x - sum block / count block)` can recompute the
sum per sample. Block-invariant memoization is not implemented by this pass.
The explicit seed makes the intended work visible while reusing ordinary scan.

The driver also reads the final block length of a virtual billion-element range
with zero loops and no linear-memory import. It does not allocate a billion values.
[Executed validation](CHUNK-COMPOSITION-VALIDATION.md) separates these native
resource checks from performance and proof-assistant claims.

## Design before implementation

PR #33 gave the language two-part indexed covers. The next gap is a runtime
number of blocks: authors should be able to map an ordinary array function over
blocks, then flatten the result, without a host `slice` loop, a guest array of
arrays, or per-element boundary/offset buffers.

Add `chunks : [a] -> Num -> [[a]]` and `flatten : [[a]] -> [a]`, with the existing
`map` operating on compiler-known chunk families. Newlines, arrows, tuples and
pipes retain their meanings. These two names become reserved builtin names.
The initial nested-array representation is deliberately scoped: chunk families
support `map`, `count`, and `flatten`, not arbitrary nested array storage or an
array-of-arrays ABI. This is a language feature, not a host sorting-style bridge.

A representative expression is:

```text
samples |> chunks width |> map (block -> scan block 0 (s -> x -> s+x)) |> flatten
```

Ordinary scalar/record-valued block summaries are also useful:

```text
samples |> chunks width |> map (block -> sum (map block (x -> x*x)))
```

The first performs a resetting scan in one flat traversal. The second emits an
outer loop and the existing inner reduction, visiting n values plus ceil(n/width)
blocks. Neither creates block data buffers. No parallel reassociation of f64
recurrences is implied.

Baseline main is `f074696532798345c0e67c572b75652d336d469c`, tree
`e85ca6e55b54dbfb0259b3aee80fca271e4b3900`. Its CI archive reproduces the exact
tree. Record completed commands separately; do not confuse a test plan with a pass.

## Shape, access and demand

The width is a positive integral Num no larger than INT32_MAX. Zero, signed zero,
fractions, negatives and nonfinite values trap even for empty input or a demanded
`count`. The input must be dense and seekable without causal machines. Blocks
are contiguous, nonempty, ordered views; the last may be shorter. Empty input
contains zero blocks. The original source's structural guards remain mandatory.

A mapped block callback can return a scalar/record summary, yielding an ordinary
stream of summaries. To return arrays for later flattening, it must preserve the
exact local event domain and extent node, have no mask, and return one output
per local input event. Map, scan, same-event zip, nested certified chunks/flatten,
and split/map/rejoin can meet this obligation. Filtering, rotation, duplication,
unrelated arrays, arbitrary ragged expansion and a merely equal length cannot.
They get an explicit error instead of a hidden materialization fallback. Sorting
inside the callback retains the existing E_ORDER_SCOPE boundary.

A family is static compiler data. Exporting `[[Num]]`, dynamically selecting
between families, or passing families to unsupported outer operations is rejected.
Helpers, partial application, ordinary record fields and local pattern aliases can
carry this static representation. `count` of a mapped family does not execute
its callbacks, just as count of an ordinary pure map does not run its item body.
An unused family remains lazy. No source arrays or prepared snapshots are mutated.

Flattened pointwise maps can remain seekable. A block-local scan or a block-level
structural guard makes the flattened result sequential. Local structural guards
are checked when entering each visited block, including when a value-ignoring
consumer traverses it. They do not run on nonexistent blocks. Element guards
remain lazy. `fold_until` stops before entering later blocks and does not execute
their seeds/guards. No count or random-access optimization may erase those
obligations. An empty final result checks source/width guards but runs no local
callback guard and no scan seed.

## Staged representation and flattening

A chunk family stores its indexed source, checked width, an outer block cursor b,
and one symbolic inner stream with local cursor j. With n source events:

    B = n div w + (n mod w != 0)
    offset = b*w
    length = min(w, n-offset)
    element = source[offset+j]

The ceil division does not compute n+w-1, which could overflow. Every multiplied
offset belongs to an actual block b<B; thus offset<n<=INT32_MAX. Source storage
and already-existing ordering scratch are not reallocated for these views.

A scalar-valued map uses the ordinary nested-loop emitter. An array-valued map
stages its callback once on the symbolic inner stream. Flattening substitutes
b=i div w and j=i mod w, reusing the source cursor coordinate system. Substituting
offset=i-j makes the unchanged item expression simplify `(i-j)+j` to i under
existing exact index identities. This is not a user-float algebra rewrite.

Each flattened causal machine gets fresh state/cell identities, plus a reset
predicate at local index zero. Its initial values are evaluated at the first
visited event and at each reset, before its normal simultaneous update. A
block-level structural guard is a zero-state checkpoint machine placed before
local transitions. Nested blocks combine reset boundaries, so a short outer tail
does not accidentally carry inner state from a previous outer block. Input-index
substitution must replace only free coordinates: nested reductions/iterations
keep their own bound cursors and accumulators, even when a scan seed consumes
the same local source. Substitution uses a separate cache per binding scope.
Reduction dependencies, ordering discovery and fusion safety scans
must inspect reset predicates and checkpoint guards as well as old machine roots.
Older machines have neither field and keep their original emitted instructions.

No boundary vector, shape vector, nested runtime closure, block descriptor array,
intermediate data buffer, heap allocator, new ABI slot or import is needed.
Final arrays retain their ordinary independently owned output storage. An existing
sort before chunks retains its own explicit ASABI 2 scratch cost. This feature
does not make materialization magically free.

## Checked cover and correctness

The observation ledger records a fresh block-layout witness and the local items
of that exact layout. A flattened callback must still denote that local domain.
The flatten rule restores the original input domain, but loses seekability when
local transitions or checkpoint guards are present. It restores an enclosing
cut cover when applicable. The verifier reconstructs the layout from parents;
matching lengths or independently supplied annotations are not proof. New rules
use `jte-4-chunks`; old programs retain their old certificates.

For w>0 and 0<=i<n, Euclidean division uniquely supplies b=floor(i/w), j=i mod w.
Then 0<=j<min(w,n-b*w) and b*w+j=i. These maps give an order-preserving bijection
between all local block events in block order and the original source events.
Consequently a local same-event map/zip transformation still aligns with the
original source after flattening. Chunking and flattening the identity are an
identity on successful values, while the width check is retained.

For a local scan, induct on blocks, then on position within a block. At j=0 the
flattened machine loads the original block seed; at the next local position it
has the same previous state and inputs as the separate scan. Its simultaneous
state update and f64 operation order are unchanged. At the next block it resets,
so the induction restarts rather than linking independent histories. Several
chained local scans keep their original schedule. A scan *after* flattening is
not reset at block boundaries. Stopping before a boundary does not demand that
block's seed or guard. These are written algorithm/lowering invariants, not an
end-to-end proof-assistant verification of the compiler.

## Work, composition and limitations

Pointwise/local-scan flattening adds bounded scalar coordinate/reset work per
visited item and one frame per local machine, independent of input size and the
number of blocks. With callbacks without nested loops, one full traversal costs
n emitted loop units; compatible output sinks can use existing output fusion.
Block summaries cost n+B units for one ordinary full reduction per block.
Empty blocks do not exist, and an empty family costs no loop units.

Nested user reductions/iterations retain their own costs. In particular,
`map block (x -> x - sum block / count block)` is not automatically a cached
once-per-block summary: it can repeat the reduction per item. The feature must
not advertise every arbitrary callback as linear-time or implicitly move partial
work across demand boundaries. Bind summaries in scan seeds when a block-local
state machine should compute them once; generalized block-invariant memoization
is separate work. Deep nesting can also add coordinate arithmetic. Existing
syntax/staging bounds and a 64-level view depth limit remain.

Associativity of arbitrary ragged flattening, unrestricted arrays of arrays,
rechunking a causal result, parallel prefix reassociation and a universal
throughput improvement are outside this change. Simpler code and bounded storage
are tested separately from performance claims. No zero allocation claim is made
about the JavaScript compiler or input/output adapter.

## Validation plan and related work

Run the unchanged baseline first. Compare block-prefix transforms and summaries
with independent JavaScript slice/scan/fold loops, all legal widths in small
exhaustive families, and all eight lowering options. Check short tails, empty
inputs, signed zero, strict/lazy seeds, multiple/nested scans, enclosing loops,
source guards, invalid shapes, source-local diagnostics, effects, ABI rejection,
exact loop/output capacity and raw memory canaries. Check forged layout proofs,
identity routing elimination, inherited cut covers and shared output fusion.
Register complete examples and both browser harnesses. Compare all old corpus
binaries/ABIs/certificates with the actual baseline; preserve historical reports.

Segmented operations and flattening are established ideas, not new mathematics.
The Futhark book describes map/scan flattening:
https://futhark-book.readthedocs.io/en/latest/regular-flattening.html .
Futhark's July 31, 2026 implementation discussion describes symbolic arrays and
space pitfalls in general flattening:
https://futhark-lang.org/blog/2026-07-31-full-flattening.html .
Sources checked September 13, 2026. The contribution here is a bounded native
compiler integration: symbolic regular block families, checked event-cover
elimination, and strictly ordered resettable state without segment buffers.
It is not a worldwide novelty claim, GPU compiler, new parallel scan, or user study.
