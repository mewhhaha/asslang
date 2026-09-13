# Split, transform, and rejoin without intermediate buffers

[Vertical composition](VERTICAL-COMPOSITION.md) · [Native ordering](NATIVE-ORDERING.md)

## Use the structure, not index bookkeeping

```sh
npm run example:array-views
npm run test:array-views
printf '[[1,2,3,4],2]' | node examples/case-studies/app.mjs view-rotate-scan
```

### Different transforms, one aligned report

Adjust the two sections independently. Rejoin them in source order, pair their
values with the original readings using ordinary `zip`, and carry one scan state
through the whole report. The cut witness, not a length comparison, supplies the
alignment proof.

<!-- array-view-example: section_report -->
```ass
// Adjust sections independently, then recover the original event alignment.
fn section_finite = x -> x-x == 0;
fn section_scale = gain -> x -> do {
  let value = gain*x;
  require (section_finite x && section_finite value) value
};
export fn section_report = (samples:[Num]) ->
  (settings:{cut:Num,leftGain:Num,rightGain:Num}) -> do {
  let checked = require (section_finite settings.leftGain && section_finite settings.rightGain) samples;
  let {left, right} = checked |> split_at settings.cut;
  let adjusted = concat
    (left |> map (section_scale settings.leftGain))
    (right |> map (section_scale settings.rightGain));
  let initial = {value:0, total:0, correction:0};
  let history =
    zip samples adjusted (original -> value -> {original, value})
    |> scan initial (state -> row -> do {
      let total = state.total+row.value;
      let correction = state.correction+(row.value-row.original);
      require (section_finite total && section_finite correction)
        {value:row.value, total, correction}
    });
  {
    values: history |> map (state -> state.value),
    totals: history |> map (state -> state.total),
    state: history |> fold initial (previous -> next -> next),
  }
};
```

For `[1,2,3,4]` and `{cut:2,leftGain:10,rightGain:100}`, values are
`[10,20,300,400]`, cumulative totals `[10,30,330,730]`, and total correction 720.
The comparison asserts one loop, one causal machine, zero runtime zip checks,
and zero intermediate-buffer bytes. Four input events need exactly four loop
units under default fusion; with fusion disabled the three consumers need twelve.
The two final numeric arrays occupy 64 output bytes, separately from their record
descriptor. No array temporary is hidden in scratch or input storage.

### Rotate first, scan once

<!-- array-view-example: rotate_scan -->
```ass
// Rotate the indexed source, then run ONE scan across the new boundary.
export fn rotate_scan = (samples:[Num]) -> (cut:Num) -> do {
  let {left, right} = samples |> split_at cut;
  right
  |> concat left
  |> scan 0 (total -> sample -> total+sample)
};
```

At cut 2, `[1,2,3,4]` becomes a virtual `[3,4,1,2]`; the result is `[3,7,8,10]`.
State does not restart at the join. The reversed halves have a NEW event domain;
ordinary `zip` with the unrotated source correctly fails.

### Compare adjacent measurements without creating two arrays

<!-- array-view-example: adjacent_deltas -->
```ass
// Two overlapping views; pairing is intentionally positional, not same-event.
export fn adjacent_deltas = (samples:[Num]) -> do {
  let size = count samples;
  let {left: earlier} = samples |> split_at (max 0 (size-1));
  let {right: later} = samples |> split_at (min 1 size);
  earlier |> zip_checked later (previous -> next -> next-previous)
};
```

`[2,5,4,10]` gives `[3,-1,6]`; zero or one sample gives an empty result. These
views intentionally refer to DIFFERENT events, so pairing is `zip_checked`, not
an invented original-domain proof. It uses one loop, no causal state, and no
intermediate data buffer. These are finite numerical examples, not time-series
unit or timestamp validation services.

The example driver also looks up a rotated billion-element `range` with zero
loops and no linear-memory import. The range is a formula, not a billion-element
allocation. Returning all of it would still require output space and work.

[Executed checks](ARRAY-VIEWS-VALIDATION.md) report concrete results and limits.

## Design before implementation

The previous passes made local products and priority keys compositional. Array
structure still has a gap: splitting a dense input, transforming each side,
joining it, and zipping it with its original positions requires hand-written
index arithmetic or host-side intermediate arrays. Equal lengths alone cannot
justify an aligned `zip` in Asslang.

Add two ordinary data-first builtins, with no new punctuation or ABI kind:

    split_at : [a] -> Num -> {left:[a], right:[a]}
    concat   : [a] -> [a] -> [a]

`split_at xs k` makes checked views [0,k) and [k,n). `concat left right` is a
virtual ordered concatenation. Neither allocates a guest data buffer or copies
source elements. The consumer supplies the traversal. A split carries a compiler-
owned cut witness; rejoining its left and right descendants IN THAT ORDER can
recover the original event domain after independent maps. It does not assert
that the transformed values equal the original values. An ordinary `zip` can
then pair corresponding original/transformed events without a runtime length
check. Unrelated or reversed concatenations receive fresh domains.

Base: merged main `f5a1c545a8c2f363234095ac171267d5ee12ab9f`, tree
`563126c210909e823702530ca75f40bc9329febd`. The supplied archive reconstructs that
exact tree. Record actually completed baseline and final tests in a separate
validation report; do not treat a proposed check as an executed result.

## Value, demand, and access contract

The input to either operation must be dense and seekable with no evolving causal
machine. Borrowed arrays, ranges, mapped/zipped dense sources, previous views,
and already-materialized sorted streams qualify. Filtered streams and scan or
transduce outputs do not. Split the indexed source BEFORE scanning, or use an
explicit existing materialization boundary first. Do not silently replay a scan,
allocate a history, guess sparse lengths, or erase rejected suffix transitions.
This first feature is not arbitrary ragged flattening, data-dependent partition,
or lazy concatenation of unrelated state machines.

The cut is an integer in [0,n], inclusive; negative zero acts as zero. Fractions,
negative values, NaN, infinity, and oversized cuts trap. There is no clamping.
An observed split side validates its source guards and cut, including on empty
input and when only `count` is demanded. Concatenation validates the source guards
of BOTH sides and a nonoverflowing total extent <= INT32_MAX,
even when only its first item is selected. These are finite structural views, not
lazy-list append whose right-hand shape is unobserved. Existing consumer-specific
pure guard scheduling is retained; the first trap and work before a failed call
are not an ordering guarantee. Element expressions remain
lazy: only the selected side's element runs, and `count` need not run map bodies.
An unused view remains undemanded as a whole. Existing raw entry-span checks and
explicit effect sequencing remain independent.

Joining views of a `sort_by` result still demands its existing strict sorting
barrier to obtain its extent. The sort keeps its scratch buffers, finite-key
validation, and invocation cache; a view does not make that cost disappear.
`at` remains bounds-checked, and downstream `scan`, `transduce`, `filter`, folds,
and zips keep their existing contracts. Scanning after a concatenation carries
one state across the boundary; scanning each independent input would be different.
No recurrence is reassociated, no automatic differentiation through new index
operations is claimed, and no intermediate array is promised for repeated access.

A whole `{left,right}` returned across ASABI is materialized into the ordinary
separate output arrays. This is an internal no-copy view, NOT a borrowed alias
escaping to JavaScript. Outputs keep their ownership and eight-byte alignment.
Source inputs and prepared snapshots are not mutated. `stats.arrayViews` reports STAGED split/concat counts, restored domains and the
maximum flattened segment count (including staged unused bindings); it is not
a runtime allocation counter. No scratch arguments or
new memory imports are needed unless an existing operation already needs them.

## Representation and balanced concatenation

A split rebases an indexed item graph onto a new local cursor and changes its
extent. Source guards plus a checked cut remain explicit. A concat is a finite
compile-time list of segment plans, a checked length, and a balanced conditional
index dispatch. Within a segment, substitute `globalIndex - segmentStart` for its
local cursor. Only that leaf's item graph is executed. Record items select each
scalar leaf under the same branch conditions; no guest record object is created.

Scalar prefix boundaries are evaluated with the structural guards before a
consumer loop, not recomputed by a linear prefix walk for each element. Directly
adjacent concatenations are flattened before dispatch, capped at 64
segments; at most 64 nested view operations are supported. A map or another
operation that changes the item graph is a boundary for this flattening, not an
excuse to substitute stale segment metadata. For S directly flattened segments,
selection uses O(log S) decisions per demanded scalar leaf rather than a linear
chain of tests. Mapped or split subviews may still contain nested dispatch;
the per-value cost is the sum of the dispatch depths it actually traverses.
Repeated expansion remains subject to the existing staging/node budgets. These
bounds do not imply O(1) evaluation of arbitrarily complex user callbacks.

Two new checked scalar operations validate cut/total extents before i32 address
arithmetic. Internal index addition/subtraction and comparison use i32, with
bounds supplied by the view invariants. Simplify only exact integer identities
such as `(i-k)+k=i`, not f64 user arithmetic. A certified rejoin can reuse the parent cursor identities; ordinary nested
traversals still run the existing lexical cursor-renaming pass. Equal rebased
item nodes need no selection branch. An untouched split/rejoin can therefore remove its element
routing while retaining the mandatory cut guard. Source length does not determine
view metadata size or guest scalar-local count.

Joining does not memoize computation or turn arbitrary repeated consumers into
one traversal. Existing reduction/output fusion controls compatible sinks. The
motivating split/map/rejoin/zip/scan report should have one traversal and one scan
frame under default fusion, zero intermediate buffers, and only final output
storage. Fusion disabled retains its ordinary separate consumers. A scalar lookup
in a virtual billion-element range can have zero loops and no linear memory at
all; materializing that range still requires output storage and runtime work.

## Cut-cover observation proof

Extend the observation certificate with `split_left`, `split_right`, `concat`,
and `rejoin`. The first rule requires a dense seekable parent and the checked-cut
obligation. The right rule refers to that exact left rule and exact parent, not a
similar cut expression or equal extent. Each side has a fresh domain and carries
its side of the same ordered cover. Existing maps and domain-preserving zips can
carry the cover; filtering, checked positional zips, conditionally selected
streams, and sorting introduce fresh domains. Causal operations still lose
seekability. Never propagate an old cover just because a plan used object spread.

`rejoin` checks matching complementary cover witnesses in left/right order and
restores their parent domain and any enclosing cover. Thus splitting a side and
rejoining its own halves can be nested before the outer rejoin. A mapped left
joined with a mapped right can change values and types but still preserves event
positions. A right/left rotation, different cuts, duplicated sides, or unrelated
sources uses the ordinary fresh-domain `concat` rule. The verifier independently
reconstructs covers from certificate parents; it does not trust a supplied domain
or user annotation. Certificates using these rules are `jte-3-views`; older
programs retain their previous certificate versions and entries.

This ledger checks relational observations, not every Wasm instruction or the
arithmetic implementation of the runtime guard. In particular it is not an
independent end-to-end formal verifier. Forged witnesses, wrong parents, swapped
sides, missing cut obligations, wrong access, and invented restored domains must
be rejected by tests.

## Correctness arguments

**Split.** After checking 0<=k<=n, left position i<k denotes source position i;
right position j<n-k denotes source position k+j<n. These injections are
disjoint, cover exactly [0,n), and preserve order within each side. Their graphs
therefore need no source copying, even for empty boundary pieces.

**Concat.** Let cumulative segment boundaries be p_0=0,...,p_S=n. For every
0<=i<n there is exactly one NONEMPTY interval [p_j,p_{j+1}) containing i.
Balanced comparison against the boundary at each internal split chooses the
subtree containing that interval, even when some intervals are empty. The leaf
uses 0<=i-p_j<length_j, so substituted loads stay inside their own source domains.
Joining two validated nonnegative lengths checks a<=INT32_MAX-b before adding;
all prefixes of a successful view are representable. Scalar prefix arithmetic
may precede a guard in an extent-only consumer, but no item address is used before
that consumer's structural checks succeed. Element branches remain conditional, not a
speculative select that evaluates an out-of-range load from the inactive side.

**Reassembly and maps.** If L/R are a checked cut and f/g are the selected pure
per-element maps, then at source position i the joined value is f(X_i) for i<k,
otherwise g(X_i). It still denotes the i-th original event. In the special case
f=g this equals map f X in successful values, but the cut is still validated and
resource/demand behavior of arbitrary refactorings is not declared identical.
For a complete ordered cover, the piece injections followed by concatenation
are the identity on source positions. Nested cover elimination follows induction
on cut witnesses, not length comparison. Value-level concat associativity does
not automatically equate unrelated JTE domains or authorize dropping guards.

**Scan and zip.** After a checked reassembly, zip sees the same source event at
every index. A scan over that item graph starts with the same seed and applies
one transition per event, including across segment boundaries. Induction on the
index proves the same states as an explicit index-based loop. No parallel prefix
or associative rearrangement of floating-point additions is used. For compatible
returned traces and final-state folds, existing output-fusion invariants yield
one shared causal traversal; this feature does not invent a new fusion rule.

**Memory and work.** No view node allocates linear-memory data. Final output and
pre-existing sort scratch retain their ordinary costs. Split/count/length checks
are scalar work; indexing adds conditional dispatch; a single downstream traversal
of n elements charges n loop units, plus user nested work. Returned arrays need
their own output writes. This is no-intermediate-buffer composition, not free
computation, a zero-host-allocation claim, or a wall-clock speedup.

## Alternatives and validation plan

Host slice/concat introduces copied intermediates and loses stream provenance.
Hand-written `range |> map (i -> at ...)` can already achieve a no-buffer loop,
but obscures bounds and creates an unrelated event domain. Unrestricted scan
slicing risks replay and suffix-demand changes. A buffer/rope runtime would add
ownership and allocation machinery unnecessary for this static finite segment
case. General segment flattening and arbitrary causal concatenation deserve a
separate design rather than an implicit allocation fallback here.

Test split boundaries, invalid cuts, overflow, empty segments, nested/rotated
joins, scalar/Bool/record payloads, all eight lowering configurations, original
alignment recovery, and refusal to align unrelated views. Compare seeded
split/map/join/zip/scan programs with an independent JS loop and the reference
interpreter. Inspect zero scratch, exact loop/output capacity, raw canaries,
input isolation, ignored-side traps, sort barriers, cache copies, prepared calls,
nested captures, effects, source locations, certificate tampering and limits.
Register useful `.ass` examples and both browser harnesses. Compare old binaries,
ABI, and certificates against the actual baseline. Run all required repository
checks and record limitations separately; preserve historical reports.

## Related work and scope of novelty

Deferred arrays, fusion, and array views are established. Svensson/Svenningsson,
*Defunctionalizing Push Arrays* (2014), describes computing arrays without storing
their elements: https://research.chalmers.se/en/publication/204969 .
Lippmeier et al., *Guiding Parallel Array Fusion with Index Types* (2012), uses
representation/index information to guide fusion:
https://simon.peytonjones.org/parallel-array-fusion/ . Futhark's performance guide
explains when views do and do not avoid copies:
https://futhark.readthedocs.io/en/v0.25.11/performance.html .
Sources checked September 13, 2026. The contribution here is their focused
integration with Asslang's checked cut-cover event lineage and causal consumer
fusion. No historical first, new general category-theory theorem, universal
fusion, proof-assistant verification, or measured readability result is asserted.
