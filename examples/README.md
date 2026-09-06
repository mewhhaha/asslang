# Executable examples and feature catalogue

The corpus now registers **91 runnable exports**, **18 unsupported-feature
fixtures**, and **3 deliberate safety rejections**. `corpus.mjs` is the discovery
entry point for tests, benchmarks and the playground. `expanded-corpus.mjs` adds
43 canonical-syntax examples, including six app-like case studies. Every `.ass`
file is registered, and every accepted export has arguments and expected output.

## Start here

```sh
npm run test:corpus
npm run test:simd
npm run example:case-studies
node src/cli.mjs examples/simd/saxpy.ass --simd \
  --run saxpy --args '[[1,2,3],[4,5,6],2]'
printf '[[0,10],[2,-2],0.5]' | \
  node examples/case-studies/app.mjs particle-step --simd
```

| Area | Purpose |
| --- | --- |
| Root and `algorithms/` | Numeric reductions, scans, searches, stateful algorithms, integration, histograms, finite differences and explicit empty results |
| `patterns/` | [Language-pattern guide](patterns/README.md): currying, closures, products, option/result encodings, dictionaries, readers, lenses, state passing and dual numbers |
| `concepts/` | Staged reducers, trait dictionaries, contracts, observation proofs and shared reduction cohorts |
| `simd/` | [Ordered f64x2 kernels](simd/README.md): SAXPY, distance, polynomial maps, clipping and vector math |
| `case-studies/` | [App guide](case-studies/README.md): telemetry, checkout, sessions, inventory, simulation and text logs, plus a bounded stdin/JSON host shell |
| `interop/` | ASABI nested values, prepared calls, explicit host capabilities and legacy-compatible reducer linking |
| `unsupported/` | [Feature backlog](unsupported/README.md): checked nonworking source, exact current diagnostic, extension needed, and a supported alternative |
| `rejected/` | Safety violations that must remain errors; not a feature wish list |
| `pathological/` | Repeated-prefix quadratic work and bounded but expanding function composition |

## Examples that have graduated from pathological

`algorithms/shared_reduction.ass` uses demand-preserving lazy memoization: its
invariant sum executes once when needed, not once per output element. Empty or
unselected output does not demand it.

`concepts/multi_reduction.ass` now has one traversal by default, rather than two;
dense `count` requires no loop. `concepts/scan_replay.ass` shares the exact scan
machine between its two sinks, also in one traversal. Tests assert these shapes.
The source algorithms are not rewritten into weaker examples. To inspect the
previous independent-traversal lowering, use `reductionFusion: false` or CLI
`--no-reduction-fusion`.

Remaining costs are explicit. `pathological/repeated_prefix.ass` is still
quadratic; `algorithms/prefix_scan.ass` is the linear source-level alternative.
`pathological/expansion.ass` still expands function bodies and eventually reaches
`E_LIMIT`. Convolution still lacks loop tiling and general random-access SIMD.
No end-to-end speedup is claimed from loop counts alone.

## Correctness and interpretation

The accepted corpus compares Wasm execution, fixed answers and an independent
allocation-heavy interpreter. Expanded examples also run with scalar/SIMD crossed
with fused/unfused lowering. Unsupported examples must fail with their registered
diagnostic; unexpected success prompts promotion rather than silently skipping a
test. They do not enter the executable benchmark list.

Canonical source uses unary arrows, whitespace application, and explicit product
values. Required helper files appear in each entry's `libraries`; CLI users pass
`--lib lib/patterns.ass` or `--lib lib/reducers.ass` explicitly. Source linking is
not an implicit module loader.

`Num` is f64. Money, integer tags, units, option/result records, trait dictionaries,
and fixed-size matrices are explicitly documented encodings, not new primitive
language types. SIMD retains f64 and ordered addition. App kernels do not provide
networking, persistence, dynamic allocation or implicit authority. Historical
benchmark JSON under `docs/` remains unchanged.
