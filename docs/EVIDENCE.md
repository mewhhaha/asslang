# Validation and provenance

[Documentation](README.md) · [Contributing](../AGENTS.md)

Reports are records of **specific revisions and environments**, not rolling claims
about the current branch. Test counts belong in these reports, not in the README.
Read each report's limitations before generalizing a measurement.

## Documentation and executable examples

[Documentation refresh and conditional evidence](DOCUMENTATION-VALIDATION.md)
records the directly executed README/guide snippets, local links, new algebra
checks and regression runs for this change.

## Feature reports

| Area | Executed validation |
| --- | --- |
| Principal module interfaces | [Adjoints and information-loss witnesses](EVIDENCE-INTERFACES-VALIDATION.md). |
| Compositional evidence contracts | [Symbolic algebra and staging](EVIDENCE-ALGEBRA-VALIDATION.md). |
| Shared proof frontiers | [Batch proofs](DESCENT-BATCHES-VALIDATION.md). |
| Goal-directed evidence | [Query proofs](DESCENT-QUERIES-VALIDATION.md). |
| Restricted or retained evidence | [Relative descent](DESCENT-EXTENSIONS-VALIDATION.md). |
| Partial-record assembly | [Descent](DESCENT-VALIDATION.md). |
| Observation recovery | [Reconstruction](RECONSTRUCTION-VALIDATION.md). |
| Loop budgets | [Original checks](LOOP-BUDGETS-VALIDATION.md), [reconstruction integration](LOOP-BUDGETS-INTEGRATION.md). |
| Static protocols | [Record symbols](RECORD-SYMBOLS-VALIDATION.md). |
| Reverse differentiation | [VJP](VJP-VALIDATION.md), [pullbacks](PULLBACK-VALIDATION.md). |
| Forward differentiation | [Gradients](GRADIENTS-VALIDATION.md), [linearization](LINEARIZE-VALIDATION.md). |
| Language and tooling | [Syntax](SYNTAX-VALIDATION.md), [diagnostics](DIAGNOSTICS-VALIDATION.md). |
| Kernels and examples | [Composition](COMPOSABILITY-VALIDATION.md), [SIMD/examples](EXAMPLES-SIMD-VALIDATION.md), [fusion integration](INTEGRATION.md). |

## Earlier evidence and research context

The [original validation overview](VALIDATION.md) links the earlier experiments
and benchmark artifacts. [Provenance](PROVENANCE.md) distinguishes publication
history from execution evidence; [related work](RELATED-WORK.md) records context.
Those documents and the artifacts under `history/` remain unchanged.

Browser engine tests execute a bundled compiler in Chromium. They do not by
themselves prove HTTP module or worker loading, other browser-engine support,
or performance. Tests of concrete Wasm bytes and iteration budgets are likewise
specific to their workloads and options. No report should be read as an audited
sandbox claim or independent mathematical peer review.
