# Numeric shape programming: executed validation

[Design and examples](TYPE-PROGRAMMING.md) · [Validation index](EVIDENCE.md)

## Source and scope

Based on main `6be919cf32041208b208d8764508c398d1ad2677`, tree
`9769016a9d0fb3e54bc19808a26136ddbd0c0bfb`. The retained source archive was
reconstructed and its Git tree matches that published baseline exactly. The
previous unfinished type-programming edits were not recoverable; this is a new
implementation of the documented narrow numeric-shape mechanism, not an assertion
that the lost code or its failing test was repaired. A design-only local commit
precedes implementation and tests.

`product_map`, `product_zip` and `product_fold` add compile-time traversal of
numeric product structure. The input numbers and generated scalar/array work
remain dynamic. Algorithms live in `lib/products.ass` and reuse ordinary source
operators and Horner evaluation. `src/products.mjs` owns the structural restriction
and bounded staged traversal; two existing compiler modules integrate it. No
parser, scalar opcode, Wasm emitter, AD implementation, ABI, runtime adapter,
dependency or workflow permission changes. The callable core deliberately grows
from 30 to 33. Five pre-existing test files update exact registry-count assertions
accordingly; their semantic checks are not removed or weakened. Historical
reports and the short root README remain unchanged.

## Completed local commands

September 15, 2026; Node v22.16.0, Linux x64, Chromium 144.0.7559.96.
Local checks are not remote CI status. Publication and remote status are recorded
separately; this report does not assert that a branch or PR exists.

| Check | Result |
| --- | --- |
| Reconstructed unchanged baseline `npm test` | 1,746 passed; zero failures/skips |
| Implementation `npm test` | 1,782 passed; zero failures/skips |
| `npm run test:type-programming` | 30 passed |
| `npm run test:docs` | 26 passed |
| `npm run test:browser` | 2,450 core + 276 experiment checks passed |
| Actual-baseline corpus comparison | 126 ASTs; 1,008 binaries, ABI objects and certificates identical |
| Explicit fieldwise source in the actual old compiler | 24 binaries, ABI objects and certificates identical |
| Required host/reducer runners, case studies, workflows and new example | Passed |
| Example build, core audit, source prelude and operator snapshot checks | Passed |
| HTTP browser path | Attempted; `net::ERR_BLOCKED_BY_ADMINISTRATOR` |

The full Node suite keeps default concurrency and all existing assertions. Both
browser harnesses register the new checks, but only the engine bundle completed
in this environment. It executes 64 dedicated shape-programming assertions in
eight lowering configurations, plus twelve checks through the three corpus
examples. Its 138 existing experiment cases remain. No policy was bypassed and
no HTTP module/worker loading or other-engine result is claimed.

## Working programs and costs

The driver `examples/interop/type-programming.mjs` executes three registered
`.ass` programs with exact loop/output allowances; one less unit or byte fails
where applicable. The documentation source blocks are matched to the exact files.

| Program | Result | Loop sites | Loop units | Final array bytes |
| --- | --- | ---: | ---: | ---: |
| Shape-derived Horner arithmetic | {mass:49,position:{x:19,y:32}} | 1 | 3 | 0 |
| Shape-folded function pipeline | 41 | 0 | 0 | 0 |
| Shape-folded ranges and scan | [0,1,1,2,4,4] | 1 | 6 | 48 |

All three report zero intermediate buffers. Returned record descriptors, host
input/output copies and compiler memory still exist. This is not runtime type
reflection, unrestricted type-level evaluation, or a proof that every callback
has constant cost. The record polynomial still visits its three coefficients;
the array plan still visits six runtime events. Only structural traversal is
elaborated away.

Each example is expanded independently to explicit ordinary source and compiled
with the actual baseline compiler. All three agree byte-for-byte across eight
SIMD/fusion/memoization modes. An unmetered comparison gives:

| Program | Derived / explicit syntax nodes | Derived / explicit staging work | Both Wasm bytes |
| --- | ---: | ---: | ---: |
| Record polynomial, including linked helper definitions | 631 / 386 | 224 / 180 | 1,805 |
| Function pipeline | 81 / 82 | 107 / 73 | 701 |
| Range pipeline | 83 / 98 | 95 / 100 | 1,520 |

These front-end counters are not timing measurements; included source-library
sets differ. The derived versions have the same scalar-graph node counts as the
explicit versions (21, 11 and 63 respectively). No general compile-time or
throughput advantage is claimed. Existing programs that do not use the newly
reserved names preserve all tested baseline artifacts.

## Functional, type and boundary checks

Nine shared positive programs run across eight lowering modes against explicit
expected values and an independent interpreter. They cover scalar, nested and
empty products; exact zip; scalar/Boolean/record/function/stream accumulators.
480 seeded pairs of nested products are checked against independent pathwise
map/zip and ordered-fold arithmetic. A 12-element positional product distinguishes
numeric positions 9 and 10 from alphabetical field ordering. Reordered field
construction has identical artifacts.

The representation restriction propagates through variables, record components,
open tails, aliases, partial applications, helper construction and instantiation.
Unused callers with invalid leaves fail during inference. Empty shapes do not
excuse ill-typed callbacks. Same leaf count with different field paths is rejected.
Symbol fields remain inaccessible to generic traversal. Generic function fields
retain normal let polymorphism and captures stay monomorphic. Ambiguous exported
shapes retain E_ABI rather than silently becoming scalar. Source-local errors
retain the caller file; existing operator scopes still select the actual leaf
operations.

The input is structural, not required-finite data. Signed zero, NaN and infinities
remain valid Num values; identity map preserves their existing behavior. An
ordered four-leaf sum checks cancellation-sensitive evaluation. Ignored witnesses,
unused fields and callbacks on empty products do not force numeric traps in the
actual Wasm tests. The independent interpreter is a value oracle for total inputs:
its product-fold shape discovery forces leaf thunks, like its existing eager scan
oracle, so it is not used to certify demand. Direct Wasm tests and explicit source
comparisons cover that separate obligation.

Gradient, JVP and VJP of unrolled product arithmetic use the existing graph
transforms, with analytic expected derivatives in all eight modes. Unsupported
loop-containing derivative graphs still fail. Function-valued folds stay staged
and cannot escape the ABI. A source-folded range plan gets normal concat bounds
and a fresh event domain; it cannot forge alignment with an unrelated source.
Products inside flattened block scans retain local resets and static zip
alignment. A nested sort still obeys E_ORDER_SCOPE. Pure host aliases are rejected;
previously performed values can be reused without replaying their host call.

Bounds test exactly 128 numeric leaves, 16 record levels and 4,096 shape nodes
including empty records, and reject one over each. Concrete aggregate shape
limits are rechecked at staging after generic-helper specialization. A tiny
staging allowance fails without raising its bound. The tests do not claim that
component constraints encode a fully dependent aggregate-size theorem.

Raw calls use the existing ABI arena and preserve result signs/NaN classification
and canaries. Prepared calls retain input snapshots, scalar override behavior,
read-only result fields, and independent subsequent values. Source cache snapshots
are isolated, and calls recover after loop/output-capacity failures. The first
focused test run incorrectly tried to mutate a read-only returned field; the next
incorrectly treated the whole record as frozen. The final test checks the actual
non-writable property descriptor and subsequent result ownership. The runtime was
not changed to accommodate those test mistakes.

## Interpretation and reproduction

```sh
npm run test:type-programming
npm run example:type-programming
npm run audit:core
npm test
npm run test:browser
```

The design proves the structural projection/left-fold scheme and the tests check
concrete instantiations. This does not constitute proof-assistant verification,
independent formal audit, worldwide novelty, arbitrary type programming, or a
promise that all staged callbacks produce efficient guest code. New names are a
migration boundary for source that previously defined those names. All numbers
remain f64, and all existing source, ABI, scope and memory restrictions remain.
