# Ordered f64x2 SIMD

```sh
node src/cli.mjs examples/simd/squared_distance.ass --simd \
  --run distance --args '[[1,2,3],[4,6,3]]'
node src/cli.mjs examples/simd/clamped_map.ass --lib lib/patterns.ass \
  --simd --check --explain
npm run test:simd
```

In JavaScript, use `compile(source, {simd: true})`. `supportsSIMD()` probes the
current engine without running guest code. Without the option, emission stays
scalar. Ordinary source code works in both modes; no vector type crosses ASABI 1.
A target without SIMD receives `E_TARGET` only when the module actually needs it.

The initial backend supports dense, stateless f64 numeric maps built from direct
current-cursor input loads, parameters/constants, and lane-wise arithmetic, abs,
negation, sqrt, floor, min and max. Materialized maps store two values at a time.
Additive reductions calculate two input values together but add the lanes to the
scalar accumulator in original order. There is no f32 narrowing, relaxed SIMD,
FMA, independent lane accumulator, or sum reassociation.

Odd-length tails and empty inputs use the scalar path correctly. ASABI's 8-byte
alignment is sufficient; 16-byte alignment is not imposed on callers. Pair stores
check capacity, and input spans are validated before vector loads. Filtering,
causal state, random checked indexing, trapping map expressions and other
non-whitelisted shapes remain scalar. A shared reduction cohort takes precedence
over SIMD, so `simd: true` does not promise every loop will vectorize.

Inspect `stats.functions[i].simd.vectorizedLoops` and `vectorInstructions` to see
what was emitted. Vectorization is not a measured speedup claim. See the
[design](../../docs/EXAMPLES-SIMD.md) and [validation report](../../docs/EXAMPLES-SIMD-VALIDATION.md).
