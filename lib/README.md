# Staged library helpers

`reducers.ass` is source-level Asslang, not JavaScript and not built into the
compiler. Link it explicitly:

```sh
node src/cli.mjs examples/concepts/terminal_product.ass \
  --lib lib/reducers.ass --run milestones --args '[[2,11,3,100]]'
npm run example:reducers
```

Exhaustive reducers expose `initial`, `step`, `finish`; terminal reducers' steps
return `{state, done}`. Protocol operations and captures are staged away.
`reducer_product` runs two exhaustive lanes in one structural fold. `until_both`
and `until_either` freeze completed terminal lanes and expose partial completion
when input exhausts. Input/result transformations and gated accumulation are
ordinary higher-order functions. No names in this file are compiler intrinsics.

See [semantics and examples](../docs/COMPOSABILITY.md) for the completion flags,
empty-input conventions, strict state updates, and source-linking limitations.

## Clocked state composition

`machines.ass` extends the same reducer protocol with serial composition, resets,
and resumable state histories. Reuse `reducer_product`, `reducer_filter`, and the
input/result adapters rather than a second set of machine operators. Under a
scan, `reducer_filter` holds state on disabled events; it does not drop events.

```sh
npm run example:clocked-machines
node src/cli.mjs examples/case-studies/machines/block_cascade.ass \
  --lib lib/reducers.ass --lib lib/machines.ass --no-prelude \
  --run block_cascade --args '[[1,2,3,4,5,6,7],3]'
```

[Clocked machines](../docs/CLOCKED-MACHINES.md) explains shared-prefix factoring,
update clocks, initial-state demand, resets versus checkpoints, and measured work.
These helpers are source definitions, not new compiler primitives.

`machine-differentials.ass` is an optional numeric-machine JVP adapter. It uses
the source prelude; core-only clients must explicitly link `lib/prelude.ass`.
[Streaming sensitivities](../docs/MACHINE-SENSITIVITY.md) explains directional
inputs, tangent checkpoints and the supported per-event AD subset.

## Contiguous range focus

`views.ass` composes two checked splits into `{before, focus, after}` and derives
`map_range` by rejoining the nested cut covers in order. The edit therefore keeps
the original event domain for ordinary `zip` without adding a slice builtin or
intermediate guest array. Link it explicitly and see
[source-defined range focus](../docs/RANGE-VIEWS.md) for bounds, demand and provenance.

## Window origins

`windows.ass` keeps `window_map` as the translation-invariant neighborhood helper
and adds `window_map_indexed` for callbacks that need the output ordinal or source
start. The callback receives `{index,start,window}` from the same staged traversal,
so callers do not need to construct and `zip_checked` a second position stream.
The metadata and symbolic window stay compiler-side. See
[window origins](../docs/WINDOW-ORIGINS.md) for provenance, demand, and compatibility.

