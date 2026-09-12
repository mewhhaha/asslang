# Local patterns and vertical composition: validation

[Examples, design and lowering argument](VERTICAL-COMPOSITION.md) · [Validation index](EVIDENCE.md)

## Revision and scope

Based on merged main `fb0467b59ce6c5365466d8806bbdce0f4bf17527`, tree
`4010694595195ce1dd78c4a9f7bbf61909c1af56`. The supplied source archive reproduced
that tree exactly. The unchanged baseline passed 1,245 Node tests. The design-only
commit precedes implementation, examples and tests.

The only changed core module is `src/unary.mjs`. Local patterns lower to existing
lambda, record, block, call and projection nodes. No tokenizer, inference-engine,
JTE, Wasm writer, ABI, effect-authority, loop-policy, dependency or workflow-permission
change is introduced. Three registered task examples and the actual calibration
kernel demonstrate the spelling. The README gains one link and remains 84 lines.

## Executed checks

September 12, 2026; Node v22.16.0, Linux x64, Chromium 144.0.7559.96.
Local execution is separate from any fresh remote CI status.

| Check | Result |
| --- | --- |
| Unchanged baseline `npm test` | 1,245 passed; zero failures/skips |
| Final `npm test` | 1,279 passed; zero failures/skips |
| `npm run test:local-patterns` | 28 passed |
| `npm run test:docs` | 26 passed |
| `npm run test:browser` | 1,554 core + 276 experiment checks passed |
| `npm run test:browser:http` | Attempted; `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| Required host/reducer runners, workflow and case-study runners, example build | Passed |
| Vertical example driver and documented threshold CLI invocation | Passed |
| Syntax checks and `git diff --check` | Passed |

Both browser harnesses register the checks. Only the bundled engine path completed
here; no browser policy was changed or bypassed. The 30 dedicated new assertions
cover twelve positive programs in both scalar/SIMD modes, shape failures, stopping
before an invalid suffix, exact budget failure and recovery. The three new corpus
entries add twelve checks through existing normal/fused/SIMD paths. The full
experiment suite has 138 cases. HTTP loading, workers and other engines remain
unverified, as do human readability improvements and elapsed-time performance.

## Compatibility against the actual baseline

A separate checkout of the old source was imported alongside the new compiler.
All 93 old accepted corpus sources produce identical parsed ASTs. Each source
also produces identical Wasm bytes in all eight SIMD/fusion/memoization settings:
744 binary comparisons, not merely comparisons between modes of the new compiler.

The rewritten calibration source is compared with the old source in the old
compiler across those settings, both with and without loop instrumentation:
all sixteen module binaries match. All three new tasks are also expanded to
old-style named bindings/projections and compiled with the old compiler; their
24 binary comparisons agree. The compatibility script is retained with the
external delivery bundle so these checks can be rerun against two checkouts.
These are finite comparisons, not an all-program binary-compatibility proof.

The front-end cost is not zero. In the unmetered calibration comparison, syntax
nodes increase from 223 to 243, inference constraints from 355 to 382, and staging
work from 302 to 324; both modules are 20,536 bytes. Generated pattern nodes count
against the existing limits. A smaller source surface does not imply a cheaper
compiler, and no compilation-time or throughput speedup is claimed.

## What the examples demonstrate

The prefix task returns `{total:5,visited:2,reached:true}` on `[2,3,-99]` and limit
5 without evaluating the invalid suffix transition. It rejects invalid prefix
samples, infinite accumulated totals, and nonpositive/nonfinite limits. Dedicated
Wasm tests check exact two-iteration budgets and one below. The corpus uses a
total suffix `[2,3,100]` because the reference interpreter's scan is eager; its
limitations are not hidden by skipping an existing check.

The shared-history task returns totals `[1,3,6]`, alert flags `[false,true,true]`
and final value 6. The default writer shares one traversal and causal machine;
pattern unpacking does not clone the producer. Duplicate output arrays remain
independently owned. Independent calls to a producer still create independent
machines, so naming coincident formulas does not erase their provenance.

The paired-error task returns count 3, RMS `sqrt(5/3)`, and maximum absolute error
2 on the documented data. Unequal lengths and nonfinite data still fail. Empty
input has an explicit zero-report convention. Each task emits one loop by default
and is byte-identical to explicit projections. The driver reports source line
counts of 15/16/16 versus 18/17/19 for those explicit-projection variants; these
small examples are not a readability experiment or a general code-size theorem.

All three source blocks in the guide are checked against their exact registered
`.ass` files. Vertical, compact and CRLF versions compile to identical bytes
across eight lowering modes. Comments between tokens remain ordinary whitespace.
A 64-stage pipeline and 120 local pattern bindings compile under existing limits.
No automatic semicolon insertion or indentation interpretation is introduced.

## Type, scope, authority and demand checks

Twelve shared positive cases exercise nested record/tuple selection, open rows,
unit and singleton tuples, annotations, renaming, static-symbol keys, partial
applications and polymorphic function fields. They run in all eight Node modes
against fixed expectations and the existing reference evaluator. That evaluator
is independent of JTE/Wasm, but shares the parser; AST tests and explicit old
programs provide separate evidence for the new lowering itself.

A 32-program family across eight modes gives 256 binary comparisons with explicit
projections and 1,280 checked numeric evaluations. A separate AST traversal checks
that a producer initializer appears only once. The compiler-level pattern lambda
does not contain the continuation: destructured identity functions can be used
at Num and Bool independently, while free monomorphic captures still reject that
inconsistent use. Occurs checks, function-ABI restrictions and row typing remain.

Negative cases check missing and extra tuple fields, malformed annotations,
nested contradictory annotations, unused invalid product shapes, duplicate names,
forward references and unknown symbols. Explicit annotations on a new local
binding are additional constraints: they cannot erase its tuple arity. Existing
parameter-pattern lowering is unchanged. `_` is tested as a real variable, not a
wildcard. Errors retain named-source locations; an invalid local pattern mentions
its `=` boundary rather than incorrectly instructing the user to add `->`.

Pure bindings still do not assert truth. An unused trapping field stays lazy;
a selected field of a required record retains its guard. Product destructuring
of `fold_until` results does not force unvisited input. Causal random access and
unrelated-stream zips retain their errors. Cache copies, prepared input snapshots,
separate output ownership and post-trap reuse are exercised.

For annotated `perform` bindings, the direct host call is retained as a separate
performed node before pure unpacking. Two calls execute exactly once in order,
even when the second result is unused. Missing capabilities, aliases pretending
to be hosts, partial/over-applied calls and wrong result shapes/types are rejected.
No new effect syntax or product-valued host result is invented.

## Bounds and interpretation

Excessive delimiter depth, a 10,000-name pattern and tiny expansion budgets fail
with controlled limit diagnostics. Generated checks/projections are charged to
the normal node budget; no compiler bounds were increased. This is static product
decomposition, not runtime matching, variants, collection destructuring, record
updates or wildcard syntax. Original parenthesized callback and data-first pipe
rules remain, including the distinction between `x |> f a` and `x |> (f a)`.

The initial full run found the new design page not yet linked from the docs index.
Navigation was completed, and focused/full/browser checks were rerun. No language
assertion, interpreter rule or limit was weakened to obtain the final results.
The design and tests support a source-level simplification with explicit semantics;
there is no proof-assistant check, independent formal review, worldwide novelty
claim or user study establishing universal elegance.
