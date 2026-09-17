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

## 2026-09-17 — Source-defined indexed window origins

Base main: `5ce234321da937cec87025089f4d46d97a1fe965`, tree
`d26a91aa8b5c89f435e8ff7d0b200c779483f1c4`. Its retained successful CI source
artifact was reconstructed locally and produced that exact Git tree. There were
no open PRs or issues at the start; PR #42 remained merged and the prior range-view
pass was already on main.

Problem addressed: coordinate-aware neighborhood code had to construct a second
`range`, recompute `index*stride`, and use `zip_checked` merely to recover positions
that `window_map` already owns internally. This pass adds source-only
`window_map_indexed`, whose callback receives `{index,start,window}` from the same
outer traversal, and derives legacy `window_map` from it. It adds no parser form,
compiler primitive, JTE rule, ABI kind, guest allocation, reflection mechanism, or
implicit prelude name.

Before:

```ass
let totals = window_map samples width stride sum;
zip_checked (range (count totals)) totals
  (index -> total -> {start:index*stride, total})
```

After explicit linkage:

```ass
window_map_indexed samples width stride
  ({index,start,window} -> {index,start,total:sum window})
```

Theory commit object: `c25e2aa9d727ff5f7a92a1c46e06068ba6bb34d6`.
Implementation commit object: `a523dc12843603a9e79d98c476f6b1676309bc02`,
tree `2f24750822ea8335e75019a6d5700995d87f3ddd`, which exactly matched the locally
tested implementation tree. Full evidence is in `docs/WINDOW-ORIGINS-VALIDATION.md`.
Rust's stable `slice::windows` and `Iterator::enumerate` documentation were checked
as established prior art for overlapping neighborhoods and zero-based positions;
no window/enumeration novelty claim is made.

Fresh local checks on Node 22.16.0: focused indexed windows 6/6, existing window
maps 21/21, full Node suite 1,807/1,807, docs 26/26, required host/reducer/case-study
examples, the new driver, core audit, prelude snapshot and operator snapshot all
passed. Chromium 144 passed 2,454 core checks plus 276 experiment checks / 138
cases. The separate HTTP-browser mode was attempted but navigation was blocked by
the environment with `net::ERR_BLOCKED_BY_ADMINISTRATOR`; no bypass was attempted.

Existing smooth/correlate/neighborhood-report artifacts are byte-, ABI-,
certificate-, and per-function-stat identical to the embedded old library in all
eight lowering configurations. The new direct coordinate form removes the one
runtime positional zip check from the old workaround for the tested pattern but
does not forge alignment with separately constructed streams. The executable
origin report stays ASABI 1, emits 2,463 Wasm bytes, reports four loops, zero
runtime zip checks, zero intermediate-buffer bytes, exactly 48 output bytes, and
succeeds at the measured 12-unit loop budget while 11 traps. A selected lookup in
virtual ranges up to `INT32_MAX` uses zero loops, no Wasm memory and no imports.
No wall-clock benchmark was run.

Next useful direction: resist adding a general `enumerate` builtin until a second
abstraction demonstrates a coherent event-index contract across filters, causal
streams and checked pairings. Prefer another source-level composition gap, or a
bounded compile-time/type-programming improvement, over widening the trusted core
for notation alone.

## 2026-09-17 — Byte input span integrity

Base main: `499563c03b6054da7ec49abc2c629bd11e1f54d2`, tree
`e749665fc976eb4621766482ccebc7608e20b774`, reproduced exactly from retained
CI source artifact 10488603385. PR #42 was merged and no PR was open.

Confirmed defect: Bytes reserved through public `byteLength` but copied and
advertised public `length`. False or throwing properties could desynchronize the
call frame, overlap later allocations, or execute host getters. The repair uses
one intrinsic typed-array length for allocation, copying and wire slots, and
requires an actual view before Uint8Array classification. No language/core/ABI/
guest-allocation/resource-limit boundary changes.

Theory object `d5a509ab98397d7dfa1bf77fec73e3642aaf8693` precedes implementation
object `9d88199d5800b780046860c2d25749150912d92c`, implementation tree
`1995bb7c268e5e4b9a653a9cba198ea789ac9275`. ECMA-262 intrinsic length,
typed-array copy and `ArrayBuffer.isView` algorithms were checked September 17;
`docs/BYTES-INPUT-INTEGRITY.md` records the representation argument.

Validation: old adapter with the new regressions 2 pass/13 fail; fix 15/15; focused
Bytes/ABI/lease/effects 53/53; an exact full Node run with the final production and
`test/*.test.mjs` blobs 1,822/1,822; docs 26/26; required host/reducer/case-study
examples and core/prelude/operator checks passed. Fresh publishable-tree Chromium
144 engine validation passed 2,454 core checks plus 276 experiment checks / 138
cases. HTTP navigation was policy-blocked; other engines were not run. Later fresh
full-suite retries timed out after more than 1,600 tests with no observed failure
and are not counted as additional passes.

Thirty-two actual old/new artifacts match across eight lowering modes. A 3-byte
report uses 32 arena bytes (3 input + 5 padding + 24 descriptor), no additional
guest output/scratch/intermediate bytes, and a separate owned 3-byte host result.
Its one loop visits three bytes; no timing claim. A temporary 64-check dedicated
browser insertion also passed but is not retained in the published large harness;
the 15-case Node regression is the durable adversarial test.

An initial normal UTF-8 object upload was safety-status blocked. No alternate
encoding or transport was attempted. The same ordinary Git-object flow later
succeeded, so publication continued without circumvention. Full evidence and
limitations are in `docs/BYTES-INPUT-INTEGRITY-VALIDATION.md`.

Next useful direction: normalize detached/invalid typed-view diagnostics across
Num and Bytes only if it can preserve current realm/proxy authority and ownership
boundaries; otherwise prefer the next bounded source-level composition gap.


## 2026-09-17 — Typed-view input validity

Base main: `e82260f398ddcc69164439ec95a475e40bd8e2ba`, tree
`d467984f3251d0b155c2c77f7afce0dbfac3e7c7`, reconstructed exactly from successful
CI artifact 10503998005. No pull request was open. This pass follows the previous
byte-integrity priority by normalizing detached and resizable-buffer out-of-bounds
`Uint8Array` / `Float64Array` inputs before arena allocation.

Before, genuine but invalid typed views reached the intrinsic copy and leaked a
native `TypeError`; the numeric path could align the arena first, and a numeric
proxy could execute `getPrototypeOf` during classification. After, one captured
non-generic `%TypedArray%.prototype.at` preflight validates backing storage, then
the existing intrinsic length drives reservation and copy. Invalid views become
`ABIError` / `E_ABI_VALUE`; valid empty views, subviews, subclasses, Node Buffer,
prepared ownership and capability sequencing remain intact. No source syntax,
compiler primitive, JTE/Wasm rule, ASABI version/layout, guest allocation,
dependency or limit changed.

Theory object: `3e756b5c804dcc7922ebb7d5db9a981c9a85cbf9`. Implementation object:
`7b098726dbfc17f2ecca506999b5aaf640cd6ec7`, tree
`23955a5095cabbe10281b9df986cf49efb6a625d`, exactly matching the tested local
implementation tree. ECMA-262 typed-array `at`, out-of-bounds validation and
`ArrayBuffer.isView` were checked as primary standards sources; no novelty claim.

Fresh implementation checks on Node 22.16.0: old adapter with new regressions
2 pass/6 fail; fix 8/8; focused typed-view/Bytes/ABI/ergonomics/lease/effects
77/77; full Node suite 1,830/1,830; docs 26/26; required host/reducer/case-study
examples and core/prelude/operator audits passed. Chromium 144 passed 2,454 core
checks plus 276 experiment checks / 138 cases. HTTP navigation was attempted but
blocked with `net::ERR_BLOCKED_BY_ADMINISTRATOR`; no bypass.

Twenty-four representative old/new Wasm, ABI, JTE certificate and non-timing-stat
comparisons match across eight lowering modes. A rejected detached numeric view
uses zero arena bytes from a fresh runtime; valid three-element Bytes and f64 inputs
measure 3 and 24 payload bytes respectively, with ASABI 1, one reduction loop and
zero intermediate-buffer bytes. No timing claim. Full details and limitations are
in `docs/TYPED-VIEW-INPUTS-VALIDATION.md`.

Next useful direction: return to a source-level composition gap or bounded type
programming rather than expanding host-boundary work unless another concrete ABI
correctness defect is reproduced.
