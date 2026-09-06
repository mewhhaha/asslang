# Asslang theory and implementation

Design changes begin here, before code. The repository-wide workflow is in
[AGENTS.md](../AGENTS.md).

- [Implementation theory](IMPLEMENTATION.md): phases, representations, invariants,
  and the boundary between static abstractions and runtime kernels.
- [Canonical syntax](SYNTAX.md): unary arrows, whitespace calls, products, explicit
  blocks, deterministic parsing, and migration from the legacy surface.
- [Causal streams](CAUSAL.md), [JTE](JTE.md), and [concepts](CONCEPTS.md): event
  alignment, sequential access, and scalar machines.
- [Composability](COMPOSABILITY.md) and [integration](INTEGRATION.md): reducers,
  linked sources, compiler sessions, and optional reduction fusion.
- [ASABI 1](ABI.md), [effects](EFFECTS.md), and [leases](LEASES.md): representation,
  host authority, and input lifetime.
- [Validation](VALIDATION.md), [composability validation](COMPOSABILITY-VALIDATION.md),
  and [provenance](PROVENANCE.md): dated evidence and its limitations.

Existing benchmark JSON and `history/` are historical evidence, not measurements
of subsequent changes. New validation reports must identify what was actually run.
