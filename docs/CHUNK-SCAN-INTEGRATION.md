# Chunk scan integration

[Chunk views](CHUNK-VIEWS.md) · [Documentation](README.md)

## Contract before implementation

Reconcile PR #35 with merged #34 (main ec52b058). Keep the arithmetic stream-family
representation, outer family zips, selected blocks, integer width checks, and
pointwise flattening semantics from main. Add flattening of a complete dense
block-local scan by resetting its scalar machine at each block boundary. No nested
array storage, descriptor buffers, new token, allocator or ABI is needed.

`xs |> chunks w |> map (b -> scan b 0 (s -> x -> s+x)) |> flatten` must execute
one flat ordered traversal with resets at positions divisible by w. Its event
domain is the source domain, but it is sequential, not randomly indexable. A
following scan remains global. Chained local scans each reset. Shared flattened
bindings share machines; separate flatten calls own distinct state.

## Reconcile policies explicitly

Retain main's metered **preflight of structural block guards** before any flattened
item is consumed. A bad guard in a later block can still fail an early consumer.
Do not import the draft's different visited-only guard policy. Scan seeds remain
lazy: an empty input invokes no seed, and a stopped traversal invokes no later
block seed. These are different, documented obligations.

Retain E_CHUNK_WORK for per-item reductions and iterations, including machine
transition/output/gate expressions. Permit such work in scan seeds, where it is
executed once per visited block, using the existing aggregate loop meter. This
supports per-block mean removal without silently approving quadratic callbacks.
Accept dense, full-cover causal scans; reject sparse/transduced or changed-cover
inner streams. Existing outer family zips and `at` selection must still work.

## Representation and proof

For a valid width w, i = floor(i/w)*w + (i mod w) determines the unique block and
local position. Replace free outer/local coordinates with those expressions.
Protect a nested reduction's bound cursor and accumulator, not its captured block
origin or extent. Use a separate substitution cache for each lexical scope.
Create fresh accumulator/cell identities per flatten, and reset each machine at
local position zero. Any nested reset is combined with this boundary.

Induction on each block's positions shows the same seed and simultaneous state
updates as the original local scan. Induction over block boundaries establishes
the concatenated result. Floating-point operation order is unchanged; no
associativity, parallel prefix, or intermediate materialization is assumed.
The verifier derives nonseekability from the inner scan proof rather than trusting
a requested indexed flag. All code that visits machine dependencies includes reset
expressions, including ordering discovery and loop-memoization planning.

## Compatibility and validation plan

Use main as the base rather than replacing its compiler with the earlier draft.
Retain all historical reports. Existing negative assertions that specifically
reject now-supported scan flattening must become positive regression coverage;
keep the remaining scope/cover/work checks. Test both implementations' useful cases,
including nested seed binders, selected causal blocks, outer family zips, strict
preflight versus lazy seeds, empty data, exact budgets, fused reports, signed zero,
source locations, borrowed memory and certificate tampering.

Run the full Node suite, host/reducer examples and available browser suite; compare
all existing corpus bytes, ABI and JTE certificates with actual main. Report results
here or in a new integration report, not as changes to historical measurements.
This is integration of segmented-state lowering, not a new mathematical algorithm
or machine-checked proof. Do not mark review-ready without successful remote CI.
