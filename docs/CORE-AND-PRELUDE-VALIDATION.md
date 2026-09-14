# Source prelude and semantic core: executed validation

[Design, usage and full audit](CORE-AND-PRELUDE.md) · [Inventory](core-inventory.json)

## Revision and scope

Based on main `00c22376ca58c4134e704b08c15939d7affe17d5`, tree
`3769fe5476ca935557f26919802ad449086b8f82`, including the merged window/chunk repair.
The provided source archive reconstructed that tree exactly. The unchanged
baseline passed 1,508 Node tests. A design-only commit precedes implementation.

The public callable names and arities remain the same by default. Four names
(sum, grad, jvp, vjp) now resolve through ordinary parsed/inferred/staged source;
30 names retain compiler primitive handlers. The old one-shot forward/reverse
functions and alias inference/staging cases are removed, not bypassed by a source-
looking JS implementation. The explicit core-only option is new. Core expressions,
JTE evidence, the Wasm emitter, runtime/ABI adapter and memory/loop policies are
unchanged. This is an ownership/mechanism audit, not mathematical minimization.

The implicit source is versioned in lib/prelude.ass. Its checked-in text snapshot
allows synchronous compilation in Node, workers and browsers without implicit
filesystem/network loading. The generator parses and infers the definitions over
primitives alone and rejects host declarations, symbol declarations and primitive
name collisions. Tests compare its deterministic output, source and arity table.
No dependency or workflow-permission change; historical reports and README stay.

## Completed local runs

September 14, 2026; Node v22.16.0, Linux x64, Chromium 144.0.7559.96.
These local results are distinct from GitHub CI at the published head.

| Check | Result |
| --- | --- |
| Unchanged baseline npm test | 1,508 passed, no failures/skips |
| Full npm test | 1,540 passed, no failures/skips |
| Focused core/prelude suite | 30 passed |
| Documentation suite | 26 passed |
| Chromium engine | 2,013 core + 276 experiment checks passed |
| Core inventory and prelude snapshot checks | Passed; 34 names covered: 30 primitive, four source |
| Actual old corpus comparison | 112 ASTs; 896 binaries, ABI objects and JTE certificates identical |
| Additional AD comparison against old compiler | 624 binaries/ABI/certificates and 160 diagnostic code/phase/offset results identical |
| Required host/reducer, case-study, workflow, window and chunk drivers | Passed |
| Source/core comparison example and example build | Passed |
| HTTP browser path | Attempted; policy-blocked navigation |

The AD comparison includes 98 existing gradient/JVP/VJP/linearize/pullback cases
across eight SIMD/fusion/memoization configurations: 78 successful-compilation
cases and 20 expected failures. Their outputs and exceptions are also exercised
by the unchanged full test suite. The corpus comparison uses the actual baseline
compiler/source, not two options in the new implementation. These are finite
comparisons, not a theorem about every possible program.

All 47 dedicated browser assertions execute the source prelude: eleven positive
cases in scalar/SIMD modes compare implicit versus explicitly supplied source
bytes and results; three more cover cache mode isolation, value-only derivative
validation and structural count. The new array corpus entry adds four checks.
Both browser harnesses register the checks. Engine success does not establish HTTP
module or worker loading; the HTTP attempt failed with
net::ERR_BLOCKED_BY_ADMINISTRATOR, without modifying or bypassing policy.
Other browser engines were not tested.

## Source equivalence, types and demand

Every dedicated positive case compares implicit prelude compilation with the
exact same definitions explicitly linked in prelude:false mode, across all eight
lowering settings. Independently renaming the four source definitions and their
call sites also gives identical Wasm; no handler recognizes their bodies or new
names. Cases cover ordered cancellation, sparse and causal sums, sum inside a
block-scan seed, product gradients, product JVP/VJP, nested derivatives, function
fields, partial application and legacy calls.

Function schemes are inferred normally. Local shadowing does not capture helper
binders or primitive references. Source definitions get private per-compilation
ASTs: mutating one infer result does not poison a later compile. Internal helper
schemes do not pollute public user signatures or named-source manifests. Primitive
names remain protected in core-only mode; source alias names may be user-defined
there, but are still reserved by default. The source option is checked as Boolean
and included in cache identity for all session APIs.

One-shot JVP/VJP still build and check the derivative at staging even when only
.value is selected. They therefore do not inherit the weaker value-only usage
of a reusable plan with no application. Invalid shapes/types, empty gradients,
unsupported graph operations and the 64-input-gradient-leaf limit remain tested.
NaN/infinity/signed-zero and cancellation-sensitive sums retain their f64 result.
A tangent or cotangent still demands the corresponding guarded primal. Empty
causal input retains lazy scan initialization, while source-stream guards remain
mandatory. Unused runtime results remain lazy, though source is type-checked.

Captured performed values remain single atomic effect results. A one-call host
capability supports all three source derivative forms without replay; calling a
host from a pure objective still fails. Source decomposition gains no I/O or
ability to forge JTE evidence, affect the ABI, or bypass a loop/memory allowance.

Source-local diagnostics point to the saturated calling expression for failures
inside a shipped helper, including partially applied helpers. User objective
syntax keeps its original file/offset. Additional old-compiler diagnostic
comparisons cover existing errors exactly. There is no promise about which error
wins in a program with several independent invalid operations.

## Executable counterexamples to unsafe core reduction

Count on a dense mapped range succeeds with zero loop units and does not evaluate
a trapping mapper. A counting fold on the same range needs traversal work. Count
on a causal stream still advances state and traps when its transition is invalid.
This rules out replacing count with one unconditional source fold.

A map preserves a source domain. Reconstructing the same values using a fresh
range and at does not prove alignment with the original array. An emit-always
transduce likewise cannot replace domain-preserving scan in a subsequent zip.
The tests demand the relevant E_DOMAIN/E_CAUSAL_ACCESS failures rather than adding
special cases that infer provenance from equal lengths.

Checking two lengths in source cannot authorize a zip of independent domains;
zip_checked is the primitive that introduces a new checked positional domain.
A full fold that freezes its accumulator still visits upstream causal transitions
in an invalid suffix; fold_until does not. A conditional implementation of min
returns +0 where f64 min returns -0, and may return a finite operand where native
min returns NaN. These are real distinctions in this language, not claims that
no alternative core could ever encode their semantics.

## Work and storage measurements

Same source and maxLoopIterations:10 on old and new compilers:

| Program | Inference constraints, old/new | Staging work, old/new | Scalar nodes | Wasm bytes (both) |
| --- | ---: | ---: | ---: | ---: |
| Scalar sum | 6 / 28 | 4 / 20 | 8 | 628 |
| Product gradient | 33 / 47 | 19 / 27 | 47 | 1,359 |
| Scalar JVP | 18 / 40 | 14 / 30 | 16 | 1,027 |
| Product-output VJP | 22 / 44 | 20 / 36 | 30 | 1,518 |
| Combined block/AD example | 140 / 220 | 102 / 158 | 107 | 3,220 |

Each compilation using the shipped prelude parses 56 additional source AST nodes.
They are charged once, not once per helper, to the existing 50,000-node bound.
Only referenced helpers are inferred. Actual helper invocation/expansion is normal
metered staging work. Tests enforce the exact combined-node boundary and the
existing expansion failure; no default is raised. Programs with unusually small
maxExpansion may newly fail. No compile-time speedup or reduced total compiler
line-count claim follows from removing dispatch branches.

The combined example returns block energies [14,77,49], gradient {x:6,y:8},
along_x=6 and weighted reverse derivative {x:8,y:2}. Exactly ten loop units and
24 final-array bytes succeed; nine units or 23 bytes fail. There are two loop
sites and zero intermediate data buffers. Its old/new artifacts and the new
implicit/explicit-source artifacts are identical. Scalar/SIMD additive folding,
existing fusion, views, block state and sorting scratch retain their current
lowering. Normal output arrays, result descriptors and host storage still exist.

## Findings and remaining boundaries

The first full implementation run failed the orphan-document check: the new design
page had not yet been added to the index. After adding navigation, the full suite
passed; no existing assertion was weakened. The combined AD example is kept as a
named source fragment with independent expected derivatives, rather than extending
or skipping the corpus interpreter's unsupported AD semantics. Its array-only
companion is in the ordinary corpus and browser paths.

This PR establishes a source-prelude boundary and a test-enforced inventory. It
does not yet unify all stream operations into a single IR instruction, introduce
user-defined effects, implement generic numeric-product traversal, add region
polymorphism, or elaborate checked recursive partitions. Those prospective core
changes need their own evidence and compatibility decisions. Existing planning
APIs remain explicit JavaScript tools, not misrepresented as source-language code.

No proof assistant, independent formal compiler audit, worldwide novelty,
user-readability study or universal fastest/minimal-core claim is made. The source
and representation arguments are accompanied by finite executable evidence, not
substituted for it. Publication/CI identifiers are recorded in the PR discussion.
