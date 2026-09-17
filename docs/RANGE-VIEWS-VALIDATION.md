# Source-defined range focus — executed validation

This report records the checks executed for the `lib/views.ass` range-focus pass.
It is revision-specific evidence, not a proof of all callbacks, all floating-point
programs, or a wall-clock performance claim.

## Provenance

Live `main` at the start was
`755cafaa2b335c1c848500aedafd87ce600c3324`, tree
`bf14645250d02e9d102fd02a9505715b017978dc`. The corresponding GitHub Actions
run 35176676267 had completed successfully, and its retained validation source
archive reconstructed that tree exactly with local `git write-tree`. There were no
open pull requests. PR #42 was already merged, so its bounded numeric-product work
was part of the baseline but was not modified by this pass.

The theory-first commit object is
`a5201816c3fa813963c0d9e2e9c50943644f8d96`. The implementation commit object is
`1f69eab5a9557aa2675c35dd6e76fc1ee292a848`, whose tree is
`361efbb7765760a38c4fee6f2d5fac5a2b0678c0`. That tree exactly matches the local
implementation tree that supplied the executable and focused test evidence below.
The final documentation-only commit adds this report and the development journal;
its fresh CI result is separate evidence.

Environment: Node 22.16.0 on Linux x64; headless Chromium 144.0.7559.96.

## Executed checks

The implementation tree passed:

- `npm run test:range-views`: **7/7** tests passed.
- `npm run test:array-views`: **35/35** tests passed.
- `npm test`: **1,799/1,799** tests passed, with zero failures, skips,
  cancellations, or todos.
- `npm run example:range-views`: passed.
- `npm run example:host`, `npm run example:reducers`, and
  `npm run example:case-studies`: passed.
- `npm run test:docs`: **26/26** tests passed.
- `npm run audit:core`, `npm run check:prelude`, and
  `npm run check:operators`: passed.
- `npm run test:browser -- --output ...`: Chromium passed **2,450** core checks;
  the experiment bundle passed **276 checks / 138 cases**. HTTP module loading
  and playground-worker loading were not exercised by this command.
- `git diff --check`: passed before the implementation commit.

The focused test covers all eight combinations of SIMD, reduction fusion, and
reduction memoization. For the same source helper versus the explicit two-cut /
two-join expansion, emitted Wasm bytes, ASABI metadata, and JTE certificates are
identical in all eight modes. That is deterministic compiler evidence for this
helper, not a general source-equivalence theorem.

## Resource observations

The executable example links `lib/views.ass` explicitly and maps the middle two
values of `[10,20,30,40]` by `+5`. It returns `[10,25,35,40]`; an ordinary `zip`
with the original returns corrections `[0,5,5,0]`. The compiled module reports:

- ASABI **1**;
- **2,783** emitted Wasm bytes;
- one loop in each of the two exported array-producing functions;
- **4** restored cut-cover domains across the two exports;
- **0** runtime zip checks in both exports;
- **0** intermediate-buffer bytes.

A separate scalar lookup through `map_range` over a virtual one-billion-element
`range` compiled with `maxLoopIterations: 0` and executed before, inside, and after
the focused region. It reported zero loops, zero intermediate-buffer bytes,
`needsMemory: false`, and no Wasm imports. This demonstrates that the source helper
does not force materialization for that indexed use; returning a large array would
still require ordinary output storage and runtime work.

## Bounds, demand, and limitations

Tests exercise valid boundaries, endpoint/zero-length focus, fractional and
negative inputs, NaN/infinity, oversize ranges, callback traps, and an unused
invalid pure range. A zero-length focus does not demand its callback body, and
untouched prefix/suffix values do not run the mapper. A bare `focus` remains a
fresh event domain and ordinary `zip` rejects it; nested ordered reassembly restores
the source domain and removes the runtime positional check.

The helper adds no parser syntax, compiler callable, scalar/JTE opcode, ABI kind,
reflection mechanism, guest allocation path, or default-prelude name. Existing
array-view segment/nesting and global compiler bounds remain unchanged. Returning
`split_range`'s three arrays across ASABI still materializes three owned outputs.
No timing benchmark was run, so no wall-clock speedup is claimed. The interval
argument in `RANGE-VIEWS.md` plus finite tests are not a proof-assistant result.

Futhark's official performance guide was checked on 2026-09-17 as established
prior art for index-transformation views and their possible materialization:
https://futhark.readthedocs.io/en/latest/performance.html#free-operations . The
Asslang work here is the source-level composition of its existing checked cut-cover
witnesses; no novelty claim is made for slicing or range updates.
