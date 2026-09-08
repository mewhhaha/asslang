# Asslang theory and implementation

Design changes begin here, before code. The repository-wide workflow is in
[AGENTS.md](../AGENTS.md).

- [Reconstruction bases](RECONSTRUCTION.md): finite observation graphs, exact
  source-component covers, and staged restoration with explicit coherence checks.
- [Static record symbols](RECORD-SYMBOLS.md): explicit typed protocol keys,
  staged dictionaries, and call-frame/ABI memory boundaries. See the
  [executed validation](RECORD-SYMBOLS-VALIDATION.md).
- [Reusable reverse pullbacks](PULLBACK.md): prepare an objective and reverse
  analysis once, then apply independent output weights with staged callables.
  See the [executed validation](PULLBACK-VALIDATION.md).
- [Reverse-mode vector-Jacobian products](VJP.md): output-weighted sensitivities
  with branch-gated reverse accumulation and product-shaped cotangents. See the
  [executed validation](VJP-VALIDATION.md).
- [Reusable linearization](LINEARIZE.md): prepare a forward derivative once and
  reuse its statically staged pushforward across directions and numeric products.
  See the [executed validation](LINEARIZE-VALIDATION.md).
- [Finite product gradients](GRADIENTS.md): scalar objectives, product-shaped
  forward gradients, nested derivatives, and bounded basis expansion. See the
  [executed gradient validation](GRADIENTS-VALIDATION.md).
- [Differential staging](DIFFERENTIAL-STAGING.md): perturbation-scoped forward
  differentiation, demand preservation, and atomic performed-result boundaries.
- [Finite callable choices](STAGED-CALLABLES.md): demand-preserving branch
  specialization of higher-order policies without guest closures.
- [Expanded examples and ordered SIMD](EXAMPLES-SIMD.md): corpus categories,
  extensibility, default reduction cohorts, SIMD eligibility, and app case studies.
- [Implementation theory](IMPLEMENTATION.md): phases, representations, invariants,
  and the boundary between static abstractions and runtime kernels.
- [Structured diagnostics](DIAGNOSTICS.md): source-local error data, full-pipeline
  non-executing checks, JSON CLI output, and playground navigation. See the
  [executed diagnostics validation](DIAGNOSTICS-VALIDATION.md).
- [Canonical syntax](SYNTAX.md): unary arrows, whitespace calls, products, explicit
  blocks, deterministic parsing, and migration from the legacy surface.
- [Causal streams](CAUSAL.md), [JTE](JTE.md), and [concepts](CONCEPTS.md): event
  alignment, sequential access, and scalar machines.
- [Composability](COMPOSABILITY.md) and [integration](INTEGRATION.md): reducers,
  linked sources, compiler sessions, and demand-scoped reduction fusion.
- [ASABI 1](ABI.md), [effects](EFFECTS.md), and [leases](LEASES.md): representation,
  host authority, and input lifetime.
- [Syntax validation](SYNTAX-VALIDATION.md): executed unary-language checks and
  parser measurements, including limitations.
- [Validation](VALIDATION.md), [composability validation](COMPOSABILITY-VALIDATION.md),
  and [provenance](PROVENANCE.md): dated evidence and its limitations.

Existing benchmark JSON and `history/` are historical evidence, not measurements
of subsequent changes. New validation reports must identify what was actually run.

* [Examples and SIMD validation](EXAMPLES-SIMD-VALIDATION.md): executed checks and remaining limitations.
