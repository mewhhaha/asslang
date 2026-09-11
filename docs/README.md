# Asslang documentation

Start with a runnable program, then follow the contract for the abstraction you use.
The [repository README](../README.md) is the overview; this directory holds the detail.

## Start here

| Guide | Use it for |
| --- | --- |
| [Getting started](GETTING-STARTED.md) | Node setup, CLI and JS calls, diagnostics, tests, limits. |
| [Language tour](LANGUAGE-TOUR.md) | Canonical syntax, streams, derivatives, demand and effects. |
| [Category theory in practice](CATEGORY-THEORY.md) | Choose a reconstruction/proof helper and run complete examples. |
| [Example corpus](../examples/README.md) | Algorithms, unsupported fixtures and app-like case studies. |
| [Validation and provenance](EVIDENCE.md) | Revision-specific checks, measurements and limitations. |

## Language, runtime and compiler

| Topic | Contract |
| --- | --- |
| Syntax and migration | [Unary syntax](SYNTAX.md), [static record symbols](RECORD-SYMBOLS.md). |
| Streams and state | [Causality](CAUSAL.md), [JTE alignment](JTE.md), [concept mappings](CONCEPTS.md). |
| Composition | [Reducers and linked sources](COMPOSABILITY.md), [staged callables](STAGED-CALLABLES.md). |
| Host boundaries | [ASABI 1](ABI.md), [explicit effects](EFFECTS.md), [input leases](LEASES.md). |
| Resource controls | [Per-invocation loop budgets](LOOP-BUDGETS.md), [compiler limits](IMPLEMENTATION.md#resource-bounds-and-evidence). |
| Diagnostics | [Non-executing checks and source locations](DIAGNOSTICS.md). |
| Lowering | [Implementation](IMPLEMENTATION.md), [ordered SIMD](EXAMPLES-SIMD.md), [reduction fusion](REDUCTION-FUSION.md), [integration history](INTEGRATION.md). |

## Numerical differentiation

| Task | Contract |
| --- | --- |
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

## Contribute and assess the evidence

Follow [AGENTS.md](../AGENTS.md): document semantics and invariants before changing
implementation, then reconcile the documents with actual tests. See the
[architecture](IMPLEMENTATION.md), [related work](RELATED-WORK.md), and
[publication provenance](PROVENANCE.md).

[Validation reports](EVIDENCE.md) preserve what was actually measured at particular
revisions. Old benchmark files and `history/` are historical evidence, not current
performance promises. A mathematical derivation and finite test suite do not
establish worldwide novelty or substitute for a proof-assistant check.
