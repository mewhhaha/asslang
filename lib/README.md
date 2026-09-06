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
