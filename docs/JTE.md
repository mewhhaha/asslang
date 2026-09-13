# Jacob Torrang encoding: current model

Asslang 0.2 implements the `jte-1-causal` observation certificate alongside
conventional inferred value types. For a stream it derives an event-domain
identity, density and seekability. Scan preserves alignment but removes direct
random-access permission. Selective transduction creates a new event domain.
The backend uses these facts with lexical cursors and scalar transition frames.

[CAUSAL.md](CAUSAL.md) specifies the rules, evaluation order, examples, current
restrictions and research context. [LEASES.md](LEASES.md) describes explicit JS
input lifetimes without changing ASABI 1. [CONCEPTS.md](CONCEPTS.md) distinguishes
implemented encodings from unimplemented type-system features.

This does not implement a universal bit encoding, unrestricted dependent inference,
formal compiler verification, or modular resource-support contracts. Historical
priority is not established. The previous ASABI model is preserved in
[history/JTE-asabi1.md](history/JTE-asabi1.md), and v0 in history/JTE-v0.md.

## Cut-cover view extension

Certificates using `split_at`/`concat` identify as `jte-3-views`. The verifier
tracks complementary cut witnesses, restores a parent event domain only on an
ordered rejoin, and preserves the existing dense/seekable requirements. Older
programs retain their existing certificate versions. The [array-view design](ARRAY-VIEWS.md)
explains the relational proof boundary and its distinction from value equality.
