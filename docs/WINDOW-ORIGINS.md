# Window origins without a second positional stream

[Neighborhood maps](WINDOW-MAPS.md) already build complete overlapping windows as
checked read-only views. This document specifies a source-library extension that
exposes each window's output ordinal and source start position to the callback.
It adds no parser form, compiler builtin, JTE rule, ABI kind, runtime allocation,
or implicit import.

## Problem

`window_map` deliberately gives a callback only the symbolic window. That is ideal
for translation-invariant kernels, but coordinate-aware code has to reconstruct a
second stream of positions. For example, attaching an origin to each window sum
currently needs a separately created `range` and positional pairing:

```ass
let totals = window_map samples width stride sum;
zip_checked (range (count totals)) totals
  (index -> total -> {start:index*stride, total})
```

The values are straightforward, but the pairing is not same-event evidence. The
range and the window result were constructed independently, so ordinary `zip` is
correctly unavailable and `zip_checked` inserts a runtime positional guard. The
window implementation already has the exact ordinal and start while selecting the
window. Reconstructing them outside the callback is repeated plumbing.

Add one ordinary source function in `lib/windows.ass`:

```text
window_map_indexed : [a] -> Num -> Num
  -> ({index:Num, start:Num, window:[a]} -> b) -> [b]
```

For output ordinal `q`, the callback receives `{index:q, start:q*stride, window}`.
`window` is the same complete checked view that `window_map` currently supplies.
The metadata record is staged compiler data; a nested window still cannot escape
through ASABI. Existing `window_map` becomes the source specialization:

```ass
fn window_map = xs -> width -> stride -> f ->
  window_map_indexed xs width stride ({window} -> f window);
```

This keeps the simpler API for translation-invariant callers while giving
coordinate-aware kernels the already-known position without a second stream.

## Semantics and invariants

Let `N=count xs`, positive integer width `W`, and positive integer stride `S`.
The existing window contract remains authoritative: `W` and `S` must be integral,
positive, and at most `INT32_MAX`. The output count is `M=0` when `N<W`, otherwise
`1+floor((N-W)/S)`. For every demanded output `q` in `[0,M)`, define
`start=q*S`; the window contains source positions `[start,start+W)`.

The callback record has three fields:

- `index` is the zero-based output ordinal `q`;
- `start` is the zero-based source origin `q*S`;
- `window` is the complete read-only indexed view at that origin.

Because every emitted `q` satisfies `q*S <= N-W <= INT32_MAX`, both metadata
numbers are exact integers in f64. No floor, clamping, negative indexing, wrapping,
or host-provided position proof is introduced. The existing two checked
`split_at` operations remain the authority for window access.

Width/stride validity remains structural: demanding the result shape validates
both even when no window exists. An entirely unused pure call remains lazy.
Demanding only `count` does not execute the user callback. A selected output runs
only its selected callback and window work. Callback guards, local reductions,
causal state, sort scratch, loop budgets, and host-effect restrictions retain
their existing contracts.

The output event domain remains the outer `range M` domain of that one window-map
construction. `index` and `start` are scalar values, not JTE evidence. They do not
align an independently created stream, another `window_map_indexed` call, or the
original input. Such pairings still require their existing proof or
`zip_checked` guard. Overlapping windows remain intentionally not a cut cover.

## Representation, lowering, and compatibility

Implementation stays in source. `window_map_indexed` computes `start` from the
existing outer cursor, performs the same two view cuts, then calls the supplied
function with a staged record. No descriptor array, index array, copied window,
new scratch buffer, closure object, or guest heap allocation is added. If a
callback ignores `index` or `start`, ordinary staging removes the unused scalar
work. If it ignores `window`, the existing view/access checks still define which
sources are admissible.

`window_map` is derived from `window_map_indexed`, so the old public source
contract, width/stride guards, event domains, floating-point callback order,
ASABI, and output ownership do not change. Representative old `window_map`
programs should emit byte-identical Wasm, ABI metadata, and certificates across
all scalar/SIMD, reduction-fusion, and reduction-memoization configurations. That
is a validation obligation, not an assumption.

The new helper can remove one *positional pairing guard* from the motivating
coordinate-aware pattern because the position is no longer a separate stream.
It does not promise fewer loops for callbacks that still perform per-window
reductions, and it is not a wall-clock performance claim. A full reduction over
M windows of width W remains O(M*W) work under the existing lowering.

## Alternatives and trade-offs

A general `enumerate` stream builtin would be broader, but it would introduce a
new core operation and require a language-wide decision about which event index is
observed after filtering, checked pairing, and causal transforms. The immediate
problem is narrower: the window constructor already owns a stable outer ordinal.
Keep that fact local to the source abstraction instead of expanding the trusted
core.

Callers can keep spelling `zip_checked (range (count windows)) windows ...`; it is
correct but duplicates the position plan and pays a positional guard because the
streams are independently constructed. A callback receiving only `start` would be
smaller, but callers sometimes need the ordinal independently of stride, and both
numbers already exist as bounded scalar expressions. A three-argument curried
callback would work, but a named record is clearer about which coordinate is
which and uses the canonical structural-pattern syntax.

This helper does not add padded windows, mutable windows, arbitrary strided views,
window flattening, or a once-only recurrence for overlapping reductions. Those
have different numerical, aliasing, or provenance contracts.

## Related work

Attaching iteration positions to values is established. Rust's stable slice API
provides overlapping `windows`, and Rust's `Iterator::enumerate` pairs iteration
items with their zero-based count. Asslang's change combines the same familiar
usability pattern with its existing staged window construction; it does not claim
a new window or enumeration algorithm.

Primary sources checked 2026-09-17:

- https://doc.rust-lang.org/stable/core/primitive.slice.html#method.windows
- https://doc.rust-lang.org/stable/core/iter/trait.Iterator.html#method.enumerate

## Validation plan

Before publication, validate the exact candidate with:

- independent slice-oracle checks for `index`, `start`, overlap, gaps, short input,
  empty output, and boundary widths/strides;
- all eight scalar/SIMD/reduction-fusion/memoization configurations;
- exact old-`window_map` artifact compatibility for the existing window examples;
- equivalence with the explicit old `zip_checked` position workaround, while
  confirming the new form needs no runtime zip check;
- selected late windows over virtual `range` inputs up to `INT32_MAX` without
  forcing preceding windows;
- strict/lazy callback demand, structural parameter traps, source-local type
  diagnostics, nested-record callbacks, and refusal to export the window field;
- loop, output, scratch, intermediate-buffer, ASABI, and certificate inspection;
- a registered coordinate-aware example and driver;
- `npm test`, host/reducer/case-study examples, documentation checks, core/prelude/
  operator audits, and Chromium tests when available.

Record executed results in a revision-specific validation document; do not turn
this plan into a claim that unrun checks passed.
