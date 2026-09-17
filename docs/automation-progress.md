# Automated development progress

This journal records bounded direct-main development passes. Historical entries are
append-only summaries; validation claims belong to the exact revisions named.

## 2026-09-17 — Structured optimization over numeric products

Base main: `8e40a8fdee0b4a9eed0ea1c129d5e09b08fb1e22` (tree
`ab1712bdaf6f8ddccaa1fa13037444663f527200`). PR #42 was already merged in that
base, so numeric `product_map`, `product_zip`, `product_fold`, `product_axpy`,
source `grad`, and their existing shape-programming checks were available.

Problem addressed: AD already returns gradients matching nested numeric-product
shapes, but reusable optimization algorithms still had to depend directly on
product helpers or hand-project record fields. The pass adds `lib/optimization.ass`
with a source-derived vector dictionary plus generic and numeric-product gradient
and momentum steps. No parser form, compiler optimizer intrinsic, scalar/JTE
opcode, runtime reflection registry, ABI change, guest allocation mechanism, or
default-prelude name was added. The trusted callable core remains unchanged.

Before:

```ass
let g = grad loss point;
{
  gain: point.gain-rate*g.gain,
  model: {
    bias: point.model.bias-rate*g.model.bias,
    slope: point.model.slope-rate*g.model.slope,
  },
}
```

After:

```ass
let next = product_gradient_step loss point rate;
```

An algorithm can instead consume a source dictionary:

```ass
let vector = numeric_vector point;
let next = gradient_step_with vector loss point rate;
```

Theory and alternatives are in `docs/STRUCTURED-OPTIMIZATION.md`. JAX's official
pytree documentation was checked September 17, 2026 as relevant prior art for
mapping transformations over matching nested structures. Asslang's integration is
narrower and static; no runtime container registry, equivalence, or novelty claim
is implied.

Commit chain prepared from the base:

- theory: `76483fa639713a1022b8851463d9f3ffaf75be4d`
- implementation/tests/example: `099437ccfda8bc9ce8555a32d31e5cb011cb7f56`
- documentation reachability fix: `8db07b13aff90ede7db084fae540ac9b7897847e`

GitHub Actions run https://github.com/mewhhaha/asslang/actions/runs/35165058909
checked out exact candidate `8db07b13aff90ede7db084fae540ac9b7897847e`
with credentials disabled. Fresh remote-CI results:

- `npm test`: 1,788 passed, 0 failed, skipped or cancelled.
- host, reducer and case-study example runners: passed.
- structured-optimization example: passed; ASABI 1, 0 loops, 0 intermediate
  buffer bytes, 3,542 emitted Wasm bytes; the two-step nested momentum oracle matched.
- core audit, prelude snapshot and operator snapshot checks: passed.
- Chromium 152: 2,450 core checks passed; experiment bundle 276 checks / 138 cases
  passed. HTTP module and playground-worker loading were not exercised.

The first temporary validation run exposed an orphaned documentation-journal link.
It also revealed that piping `npm test` to `tee` without `pipefail` can mask a test
exit code. The candidate was fixed, and the successful rerun explicitly used
`set -o pipefail`. This journal records the corrected run, not the misleading
wrapper conclusion from the first attempt.

The focused tests cover scalar/nested products over eight compiler option
combinations, a custom clipped AXPY dictionary, lazy unused dictionary fields,
invalid/mismatched products in unused callers with source names, two explicit
momentum steps, direct source-expansion Wasm equality, and renamed-library equality.
These are executable checks, not a proof. No timing benchmark was run, so this pass
makes no speed claim. Existing product limits of 128 leaves, 16 record levels and
4,096 shape nodes remain unchanged; existing `grad` activity/graph restrictions
also remain unchanged.

Next useful direction: evaluate whether another algorithm can consume the same
small dictionary without adding compiler surface, or whether the current dictionary
should remain intentionally minimal after real source use. Do not add optimizer
names merely for breadth.
