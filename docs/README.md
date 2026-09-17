# Asslang documentation

Start with a runnable program, then follow the contract for the abstraction you use.
The [repository README](../README.md) is the overview; this directory holds the detail.

## Start here

| Guide | Use it for |
| --- | --- |
| [Getting started](GETTING-STARTED.md) | Node setup, CLI and JS calls, diagnostics, tests, limits. |
| [Language tour](LANGUAGE-TOUR.md) | Canonical syntax, streams, derivatives, demand and effects. |
| [Category theory in practice](CATEGORY-THEORY.md) | Choose a reconstruction/proof helper and run complete examples. |
| [Vertical composition](VERTICAL-COMPOSITION.md) | Read pipelines top to bottom, unpack named results and retain checked behavior. |
| [Practical workflows](CASE-STUDIES.md) | Resumable monitoring, robust calibration and law-aware release preflight. |
| [Example corpus](../examples/README.md) | Algorithms, unsupported fixtures and app-like case studies. |
| [Validation and provenance](EVIDENCE.md) | Revision-specific checks, measurements and limitations. |

## Compiler core and source libraries

[Core and source prelude](CORE-AND-PRELUDE.md) audits every builtin, moves derived
operations into ordinary source, and explains which semantic boundaries stay native.

## Language, runtime and compiler

| Topic | Contract |
| --- | --- |
| Syntax and migration | [Unary syntax](SYNTAX.md), [static record symbols](RECORD-SYMBOLS.md). |
| Streams and state | [Causality](CAUSAL.md), [JTE alignment](JTE.md), [concept mappings](CONCEPTS.md). |
| Composition | [Reducers and linked sources](COMPOSABILITY.md), [staged callables](STAGED-CALLABLES.md). |
| Host boundaries | [ASABI 1](ABI.md), [explicit effects](EFFECTS.md), [input leases](LEASES.md). |
| Resource controls | [Per-invocation loop budgets](LOOP-BUDGETS.md), [compiler limits](IMPLEMENTATION.md#resource-bounds-and-evidence). |
| Diagnostics | [Non-executing checks and source locations](DIAGNOSTICS.md). |
| Lowering | [Implementation](IMPLEMENTATION.md), [ordered SIMD](EXAMPLES-SIMD.md), [reduction fusion](REDUCTION-FUSION.md), [causal output fusion](OUTPUT-FUSION.md), [integration history](INTEGRATION.md). |

## No-buffer array composition

[Split and rejoin views](ARRAY-VIEWS.md) carry cut-cover alignment through maps,
then feed zips and scans without intermediate guest arrays. [Source range focus](RANGE-VIEWS.md)
packages nested cuts into reusable contiguous edits while retaining the same witnesses.

## Ordering by several priorities

[Tuple keys](LEXICOGRAPHIC-KEYS.md) express primary and tie-breaking priorities
in one native stable sort, including reusable nested subkeys.

## Chunk-level array programs

[Chunk views](CHUNK-VIEWS.md) compose block reductions and aligned pointwise
flattening without arrays of block data or descriptors.

## Source-defined state machines

[Clocked machines](CLOCKED-MACHINES.md) compose serial stages, share prefixes,
hold independent lanes on one event clock, and resume/reset explicit product state.
They reuse the reducer protocol without adding compiler primitives.

## Numerical differentiation

| Task | Contract |
| --- | --- |
| Fit data with a large predictor origin | [Scaled calibration and saved models](CALIBRATION-COORDINATES.md). |
| Understand differentiation and demand | [Differential staging](DIFFERENTIAL-STAGING.md). |
| Scalar objectives over numeric products | [Gradients](GRADIENTS.md). |
| Reuse forward derivatives across directions | [Linearization](LINEARIZE.md). |
| Weight output sensitivities | [Reverse VJPs](VJP.md). |
| Reuse reverse plans across output weights | [Pullbacks](PULLBACK.md). |

## Observation diagrams and evidence

Read the [practical guide](CATEGORY-THEORY.md) before the derivations.
These are explicit models and generated protocols, not inferred laws about arbitrary programs.

| Question | Derivation and API |
| --- | --- |
| Which observations determine a coherent record? | [Reconstruction bases](RECONSTRUCTION.md). |
| Which overlaps must agree to glue records? | [Optimal descent](DESCENT.md). |
| What is the cheapest permitted extension of retained comparisons? | [Relative descent](DESCENT-EXTENSIONS.md). |
| What evidence proves one requested equality? | [Query-directed proofs and metrics](DESCENT-QUERIES.md). |
| Which alternative supports share work across goals? | [Batch frontiers](DESCENT-BATCHES.md). |
| How can components instantiate symbolic requirements without enumerating supports? | [Compositional evidence algebra](EVIDENCE-ALGEBRA.md). |
| Which public summaries guarantee a private contract, and what information is missing? | [Principal evidence interfaces](EVIDENCE-INTERFACES.md). |
| Which additional summaries make all consumers exactly expressible at least cost? | [Certified interface refinement](EVIDENCE-REFINEMENT.md). |
| When do conditional requirements survive an interface translation, and how can a view be realized? | [Implication-preserving transport](EVIDENCE-TRANSPORT.md). |
| What additional evidence handles every promised alternative? | [Conditional evidence and Heyting implication](EVIDENCE-RESIDUALS.md); bounded teaching example. |
| What laws hold between public flags, and can those laws repair conditional transport? | [Law-aware evidence presentations](EVIDENCE-PRESENTATIONS.md). |

## Native finite ordering

[Stable ordering and scratch ownership](NATIVE-ORDERING.md) describes `sort_by`,
strict finite materialization, new provenance, cached keys and disjoint scratch.
Existing non-sorting modules stay ASABI 1.

## Language design experiments

[Elegant partition recursion](PARTITION-RECURSION.md) tests a stable, bounded host
backend and proposes a checked recursive source form. That recursive form remains
proposed; the subsequent native `sort_by` substrate is documented separately above.

## Contribute and assess the evidence

Follow [AGENTS.md](../AGENTS.md): document semantics and invariants before changing
implementation, then reconcile the documents with actual tests. See the
[architecture](IMPLEMENTATION.md), [related work](RELATED-WORK.md), and
[publication provenance](PROVENANCE.md). The [automation development journal](automation-progress.md)
records bounded direct-main passes separately from revision-specific validation reports.

[Validation reports](EVIDENCE.md) preserve what was actually measured at particular
revisions. Old benchmark files and `history/` are historical evidence, not current
performance promises. A mathematical derivation and finite test suite do not
establish worldwide novelty or substitute for a proof-assistant check.

[Chunk scan integration](CHUNK-SCAN-INTEGRATION.md) extends arithmetic families
with buffer-free local scan flattening, while preserving existing guard/work policies.

[Neighborhood maps](WINDOW-MAPS.md) use overlapping read-only views for smoothing,
correlation and local summaries without a window matrix or a new compiler primitive.
[Window origins](WINDOW-ORIGINS.md) expose each existing window's ordinal and source
start to source callbacks without constructing and checked-zipping a second position stream.
[Window/chunk integration](WINDOW-CHUNK-INTEGRATION.md) records their combined
contracts, regression checks, and reconciliation after the chunk-scan merge.

[Source operator algebra](SOURCE-OPERATORS.md) composes derivatives, adjoints and
bounded matrix-free solvers without new compiler primitives.
[Streaming sensitivities](MACHINE-SENSITIVITY.md) lift a source machine with JVP,
then scan and resume its value/tangent state without a reverse tape.

[Machine publication validation](CLOCKED-MACHINES-PUBLICATION.md) records the integration with operator-enabled main.

[Old-state feedback](MACHINE-FEEDBACK.md) closes reusable source pipelines over their
previous state, with error-feedback quantization and closed-loop sensitivities.

[Lexical source operators](LEXICAL-OPERATORS.md) bind local notation to ordinary
functions, with relative precedence and no global overload registry.

[All source-defined expression operators](ALL-SOURCE-OPERATORS.md) completes Boolean,
pipe, and unary notation with a source-backed default library.

## Shape-directed compile-time programming

[Numeric products](TYPE-PROGRAMMING.md) derive arithmetic and staged function/array
plans from finite type shapes; field data stays dynamic and no reflection table is emitted.

[Structured optimization](STRUCTURED-OPTIMIZATION.md) composes those finite numeric
products with source `grad`, derived vector dictionaries, gradient steps and explicit
momentum state without adding an optimizer primitive or runtime parameter-tree registry.
[Gradient norm clipping](GRADIENT-CLIPPING.md) reuses the same source dictionary
for a bounded global-norm update, with explicit floating-point and demand behavior.
