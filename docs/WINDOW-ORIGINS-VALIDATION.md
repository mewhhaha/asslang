# Window-origin validation

This report records the executed checks for the source-defined indexed-window
candidate based on `5ce234321da937cec87025089f4d46d97a1fe965`. The theory commit
object is `c25e2aa9d727ff5f7a92a1c46e06068ba6bb34d6`; the implementation
commit object is `a523dc12843603a9e79d98c476f6b1676309bc02`, whose tree is
`2f24750822ea8335e75019a6d5700995d87f3ddd`. The local test snapshot was
reconstructed from the retained successful CI artifact for the base; its initial
Git tree exactly matched base tree `d26a91aa8b5c89f435e8ff7d0b200c779483f1c4`.

## What was checked

`window_map_indexed` is ordinary linked source in `lib/windows.ass`. For each
complete window it gives the callback `{index,start,window}`, where `index` is the
outer zero-based ordinal and `start=index*stride`. Existing `window_map` is now a
source specialization that discards the first two fields.

Fresh Node 22.16.0 checks on the exact implementation tree:

- `npm run test:window-origins`: 6/6 passed. The suite checks an independent JS
  slice oracle over empty/short/overlapping/gapped cases in all eight SIMD ×
  reduction-fusion × reduction-memoization configurations; width/stride traps and
  laziness; source-local type errors; dense/seekable access rejection; ASABI
  escape rejection; late random access; provenance; and the executable example.
- `npm run test:window-maps`: 21/21 passed, including the existing 8,192-case
  exhaustive binary-array family and 480 seeded neighborhood/chunk cases.
- `npm test`: 1,807/1,807 passed, with zero failed, skipped, cancelled, or todo.
- `npm run example:host`, `npm run example:reducers`, and
  `npm run example:case-studies`: passed. The expanded case-study runner executed
  the new `window-origin-report` in both scalar and SIMD configurations.
- `npm run example:window-origins`: passed.
- `npm run test:docs`: 26/26 passed; 107 top-level documents were reachable and
  301 local links were checked.
- `npm run audit:core`: passed and still reports 37 callable names: 33 compiler
  primitives plus the four source-prelude functions. `window_map_indexed` is not
  in that callable core.
- `npm run check:prelude` and `npm run check:operators`: snapshots matched.
- `npm run test:browser`: Chromium 144.0.7559.96 passed 2,454 core checks. The
  experiment bundle passed 276 checks across 138 cases.

`npm run test:browser:http` was also attempted. Chromium started, but navigation
was rejected by the execution environment with `net::ERR_BLOCKED_BY_ADMINISTRATOR`.
No bypass was attempted. Therefore HTTP module/playground-worker loading is not
validated by this pass; the normal non-HTTP Chromium suite above is the fresh
browser evidence.

## Compatibility and provenance evidence

The focused suite embeds the exact pre-change `window_map` source and recompiles
`smooth`, `correlate`, and `neighborhood_report` against both libraries in all
eight lowering configurations. The resulting Wasm bytes, ABI objects, JTE
certificates, per-function lowering stats, and intermediate-buffer accounting are
identical. This is finite regression evidence for the derived specialization, not
a proof for every possible callback.

A coordinate-aware direct callback and the old explicit workaround were also run
in all eight configurations:

```ass
window_map_indexed xs width stride ({start,window} -> start + sum window)
```

versus

```ass
let totals = window_map xs width stride sum;
zip_checked (range (count totals)) totals
  (index -> total -> index*stride + total)
```

Their values agree for the exercised inputs. The direct form reports zero runtime
zip checks; the workaround reports one. Under default lowering the direct
artifact is 1,534 Wasm bytes versus 1,632 for that particular workaround. These
are exact artifact observations, not a timing or general code-size claim. Two
independently constructed indexed-window calls remain different event domains and
ordinary `zip` is rejected with `E_DOMAIN`; numeric `index`/`start` values are not
alignment authority.

## Bounds, demand, and resource observations

A scalar lookup into the last selected complete window of virtual `range` inputs
was checked for `(N,W,S)` values `(1_000_000_000,1009,65537)`,
`(2147483647,3,7)`, and `(2147483647,1,2147483647)`. Results were independently
computed with BigInt arithmetic. The artifact reports zero loops, zero
intermediate-buffer bytes, no Wasm memory requirement, and no imports; a lookup
one position past the final window traps. This shows the selected-access lowering
does not visit or materialize the prefix in those cases.

The registered `origin_report` example maps `[1,2,3,4,5,6]` with width 3 and stride
2 to `{indexes:[0,1], starts:[0,2], totals:[6,12]}`. It remains ASABI 1, emits
2,463 Wasm bytes, reports four emitted loops, zero runtime zip checks and zero
intermediate-buffer bytes, and needs exactly 48 output bytes for that call. With
the current loop-budget lowering it succeeds at 12 aggregate loop units and traps
at 11. Returned arrays still use ordinary output materialization; zero
intermediate-buffer bytes does not mean zero JS/runtime memory use.

Structural width/stride validation is unchanged: non-positive, fractional,
non-finite, or values above `INT32_MAX` trap when the result shape is demanded.
An entirely unused pure invocation remains lazy, and `count` does not demand the
callback body. Filtered and causal-scan sources retain the existing dense/access
rejections. Nested windows still cannot cross the concrete ABI.

## Limits

This pass adds no parser syntax, compiler primitive, JTE rule, ABI kind, guest
heap allocation, runtime reflection, or implicit import. It does not add general
`enumerate`, padded/mutable/strided windows, or a recurrence that reuses work
between overlapping reductions. Full reductions remain governed by the existing
per-window work and loop-budget rules. No wall-clock benchmark was run, so no
speedup is claimed. Finite artifact equality and oracle tests are evidence, not a
formal proof.

The related-work comparison uses Rust's stable slice `windows` and iterator
`enumerate` documentation only as established examples of overlapping windows
and zero-based iteration positions. Asslang's contribution here is the source
integration with its existing checked staged views and JTE provenance; no novelty
claim is made for window enumeration.
