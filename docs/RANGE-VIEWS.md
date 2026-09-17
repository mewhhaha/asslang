# Source-defined range focus over indexed views

[Split and rejoin views](ARRAY-VIEWS.md) already provide the trusted indexed
mechanism. This document specifies a source-library abstraction over that mechanism;
it does not add a parser form, compiler builtin, ABI kind, runtime allocation path,
or provenance rule.

## Problem and source contract

A common contiguous edit currently repeats two cuts and two joins:

```ass
let {left: before, right: tail} = split_at xs start;
let {left: focus, right: after} = split_at tail length;
concat before (concat (map focus adjust) after)
```

The arithmetic is simple, but the nesting is semantically important. The second
cut must be inside the first cut's right side, and the joins must rebuild the
inner cover before the outer cover. Equal lengths alone cannot recover Asslang's
event domain.

Add an explicitly linked source library `lib/views.ass` with two ordinary
functions:

```text
split_range : [a] -> Num -> Num -> {before:[a], focus:[a], after:[a]}
map_range   : [a] -> Num -> Num -> (a -> a) -> [a]
```

`split_range xs start length` performs the two checked `split_at` operations and
returns their three pieces. `map_range xs start length f` maps only `focus`, then
rejoins `focus` with `after` and finally `before` with that reconstructed tail.
The mapper is intentionally endomorphic: changing the focused element type would
make it impossible to concatenate the untouched prefix and suffix.

Before:

```ass
let {left: before, right: tail} = split_at samples start;
let {left: focus, right: after} = split_at tail length;
concat before (concat (map focus (x -> x*gain)) after)
```

After linking `lib/views.ass`:

```ass
map_range samples start length (x -> x*gain)
```

The lower-level `split_range` remains useful when the focused region feeds more
than one operation or when callers want to inspect the three pieces separately.
No name from this library is loaded by the default prelude.

## Bounds, demand, and provenance

The existing `split_at` contract is authoritative. `start` must be an integer in
`[0,count xs]`; after that cut succeeds, `length` must be an integer in
`[0,count xs-start]`. Negative zero behaves as zero. Fractions, negative values,
NaN, infinity, an oversized start, or a length extending past the suffix trap.
There is no clamping, negative indexing, wraparound, or hidden conversion from an
end index.

An observed range validates both cuts, including a zero-length focus. An entirely
unused pure range remains undemanded under the existing demand graph. Mapping a
zero-length focus does not demand the callback body. For a nonempty range, only
selected focused elements run the callback; untouched prefix/suffix elements do
not. Existing input guards, strict sort barriers, loop budgets, effects, and raw
ABI span checks remain independent.

`split_range` returns nested cut-cover descendants. Its `focus` alone has a fresh
subrange event domain, so equal length does not authorize `zip xs focus`. In
contrast, `map_range` preserves the exact nested witnesses through `map`, rejoins
the inner focus/after cover in order, then rejoins the outer before/tail cover.
The existing `rejoin` certificate rules therefore restore the original event
domain. Ordinary `zip xs (map_range xs ...)` is valid without a runtime length
check. Swapping pieces, using an independently created cut, filtering, sorting, or
`zip_checked` still breaks that proof exactly as documented by `ARRAY-VIEWS.md`.

## Representation and resource contract

Both helpers are source expansion over existing view plans. A successful staged
`split_range` adds two split plans. A staged `map_range` adds those cuts, one map,
and two concatenations; the concatenations are virtual balanced index dispatch,
not guest array copies. The helpers introduce no scratch reservation and no
intermediate guest data buffer. A scalar `at` into a virtual input can therefore
remain loop-free even when the logical input is very large.

This does not make output materialization free. Returning the final array still
requires ordinary ASABI output storage and writes. Returning the three
`split_range` arrays across ASABI materializes three owned outputs; no borrowed
alias escapes to JavaScript. User callbacks retain their own scalar, loop, guard,
and staging costs. Existing 64-segment / 64-view nesting bounds and global
parser/inference/staging limits remain unchanged.

No core-inventory callable moves layers. The implementation commit should list
`lib/views.ass` among source libraries so the audit documents where the abstraction
lives; `split_at`, `concat`, `map`, and the cut-cover verifier remain the trusted
mechanisms.

## Correctness argument

Let `n = count xs`, `0 <= start <= n`, and `0 <= length <= n-start`. The first
cut decomposes source positions into `B=[0,start)` and `T=[start,n)`. The second
cut decomposes `T` into `F=[start,start+length)` and
`A=[start+length,n)`. These intervals are ordered, disjoint, and cover `[0,n)`.
`split_range` therefore returns exactly the three intended indexed views.

For `map_range`, mapping `f` over `F` preserves F's event positions. Rejoining F
with A reconstructs T's event domain by the existing complementary-cover rule;
rejoining B with that result reconstructs xs's event domain. At position `i`, the
result is `f(xs[i])` iff `start <= i < start+length`, otherwise `xs[i]`. This is a
positional argument over the existing certificate rules, not a proof of callback
purity beyond what the compiler already checks.

## Alternatives and trade-offs

A new slice builtin or `xs[start:end]` syntax would duplicate bounds and view
semantics that are already expressible from two `split_at` calls. A helper that
returned only the middle slice would be smaller but would throw away the useful
ordered cover needed to reassemble aligned output. A helper taking an end index
would make composition with known lengths less direct and would need a subtraction
whose overflow/bounds story merely recreates the existing second cut. Clamping
would hide caller mistakes and differ from `split_at`.

Callers can always use `zip_checked` after constructing unrelated same-length
views, but that pays a positional guard and intentionally produces a fresh domain.
`map_range` is specifically for an edit of one source where the original cut-cover
witness already proves alignment.

## Related work

Array slicing and view-based index transformations are established techniques.
Futhark's current performance guide describes slicing, `take`, and `drop` as
operations that can compile to views, while also documenting situations where a
view must be materialized:
https://futhark.readthedocs.io/en/latest/performance.html#free-operations
(checked 2026-09-17). Asslang's narrower contract here is source composition over
its existing checked split/rejoin witness system; no novelty claim is made for
array slicing or range updates.

## Validation plan

Add focused tests that compile the library with explicit source linkage and cover:

- scalar, Boolean, and record arrays plus inferred polymorphism;
- boundary, zero-length, invalid-start and invalid-length behavior;
- callback laziness outside the focus and on an empty focus;
- all eight scalar/SIMD/reduction-fusion/memoization configurations;
- ordinary `zip` alignment after `map_range` and refusal to align a bare focus;
- equality with the explicit two-cut/two-join source expansion, including emitted
  Wasm/ABI/certificate where the compiler is deterministic;
- a large virtual `range` scalar lookup with zero loops and no linear memory;
- output/scratch/intermediate-buffer accounting and loop-budget behavior;
- stable source diagnostics for invalid callers.

Run the focused range-view test and example, `npm test`, host/reducer/case-study
examples, documentation checks, the core/prelude/operator audits, and the browser
suite when Chromium is available. Record exact results against the exact source
revision rather than treating this plan as evidence.
