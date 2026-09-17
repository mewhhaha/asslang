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

## 2026-09-17 — Source-defined gradient norm clipping

Base main: `cde8ed35415f894180fbb6557a75d4dec2b42d95`. There were no open PRs,
and the latest main CI run for that base had completed successfully. The previous
structured-optimization pass was therefore the live starting point.

Problem addressed: `numeric_vector` already exposed `dot`, `scale` and `axpy`, but
no reusable algorithm consumed all three. Callers that wanted a global gradient
norm cap had to spell the protocol manually. This pass adds ordinary-source
`clipped_gradient_step_with` and `product_clipped_gradient_step`; no parser form,
compiler primitive, scalar/JTE opcode, ABI change, guest allocation, reflection
registry or default-prelude name was added.

Before:

```ass
let gradient = grad objective point;
let norm = sqrt (vector.dot gradient gradient);
let direction = if norm > maxNorm
  then vector.scale gradient (maxNorm / norm)
  else gradient;
vector.axpy point direction (-rate)
```

After:

```ass
product_clipped_gradient_step objective point rate maxNorm
```

The theory-first commit is `5141944aaaae2692253fb79bf31d88ef5dc46e6c`; the
implementation/tests/example commit is `06710f2d8711f6b2c5f6bec7db10e3a30eaffd4f`.
Pascanu, Mikolov and Bengio's arXiv:1211.5063 was checked as prior art for norm
clipping; no novelty claim is made for that policy. Asslang's contribution in this
pass is the source-dictionary integration over its existing static numeric products
and AD graph.

Fresh local validation used Node 22.16.0: 10/10 focused optimization tests and
1,792/1,792 full Node tests passed; required host/reducer/case-study examples, the
structured optimizer driver, core audit, prelude snapshot, operator snapshot and
26/26 documentation tests passed. Headless Chromium 144 passed 2,450 core checks;
the experiment bundle passed 276 checks / 138 cases. The structured example stayed
ASABI 1 and reported 5,272 Wasm bytes, zero loops and zero intermediate buffer
bytes. HTTP module and playground-worker loading were not exercised. No timing
benchmark was run.

The clipping branch is strict (`norm > maxNorm`), a negative bound traps through
`require`, an exact/under-bound gradient does not demand `scale`, and zero is a
valid cap without a hidden epsilon. NaN/infinite gradients are not sanitized; the
existing IEEE behavior remains visible. Product shape limits remain 128 leaves,
16 record levels and 4,096 shape nodes. Tests are regression evidence, not formal
proofs of algebraic laws or all floating-point cases.

Next useful direction: use the same small vector dictionary for a materially
different algorithm only if it exposes a real composition gap; otherwise shift
attention back to array/view ergonomics or bounded compile-time programming rather
than accumulating optimizer names.

## 2026-09-17 — Source-defined contiguous range focus

Base main: `755cafaa2b335c1c848500aedafd87ce600c3324`, tree
`bf14645250d02e9d102fd02a9505715b017978dc`. Its retained CI source archive was
reconstructed locally and matched that tree exactly. There were no open PRs, and
PR #42 was already merged.

Problem addressed: contiguous edits repeatedly spelled two nested `split_at`
operations and two ordered `concat` operations. The nesting is not mere index
bookkeeping: those exact complementary cut witnesses are what restore the original
event domain. This pass adds explicitly linked `lib/views.ass` with polymorphic
`split_range` and endomorphic `map_range`. `map_range` edits only the focused
region and rejoins inner then outer covers, so ordinary `zip` with the original
source needs no runtime positional check. A bare focused subview remains distinct.
No parser form, compiler primitive, ABI change, reflection registry, guest
allocation mechanism, or default-prelude name was added.

Before:

```ass
let {left: before, right: tail} = split_at samples start;
let {left: focus, right: after} = split_at tail length;
concat before (concat (map focus adjust) after)
```

After explicit linkage:

```ass
map_range samples start length adjust
```

Theory precedes implementation at
`a5201816c3fa813963c0d9e2e9c50943644f8d96`; implementation is
`1f69eab5a9557aa2675c35dd6e76fc1ee292a848`, tree
`361efbb7765760a38c4fee6f2d5fac5a2b0678c0`, which exactly matched the locally
tested implementation tree. Full executed evidence is preserved in
`docs/RANGE-VIEWS-VALIDATION.md`.

Fresh local checks: focused range views 7/7, existing array views 35/35, full Node
suite 1,799/1,799, documentation 26/26, required host/reducer/case-study examples,
core audit, prelude/operator snapshots, and the new range example all passed.
Chromium 144 passed 2,450 core checks plus the 276-check / 138-case experiment
bundle; HTTP module and playground-worker loading were not exercised. The example
stayed ASABI 1, emitted 2,783 Wasm bytes, used one loop per exported array result,
restored four domains across its two exports, had zero runtime zip checks and zero
intermediate-buffer bytes. A scalar lookup in a virtual billion-element range had
zero loops and no Wasm memory/import requirement.

The helper's emitted Wasm, ABI object, and JTE certificate match the explicit
source expansion in all eight lowering configurations. This and the interval
argument are evidence, not a formal proof. No timing benchmark was run. Existing
64-segment/view nesting and global compiler limits are unchanged; returned arrays
still require output materialization. Futhark's official performance guide was
checked 2026-09-17 for established view/materialization prior art; no slicing or
range-update novelty is claimed.

Next useful direction: evaluate whether read-only window construction can reuse
`split_range` without obscuring its distinct stride/width contract, or instead
look for another repeated array-view composition where witness preservation removes
manual index plumbing. Do not add a slice primitive merely for notation.
