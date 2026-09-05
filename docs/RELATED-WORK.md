# Related work and scope of claims

Sources checked on 2026-09-05. These are relevant precedents, not evidence that JTE
already inherits their proofs or matches their expressiveness/performance.

1. Oleg Kiselyov, Aggelos Biboudis, Nick Palladinos, Yannis Smaragdakis,
   **Stream Fusion, to Completeness** (2016 preprint / POPL 2017).
   [Primary source](https://arxiv.org/abs/1612.06668).
   Staging and rich stream representations already provide elimination of
   intermediate abstractions. JTE does not claim to invent fusion.

2. Oleg Kiselyov, Tomoaki Kobayashi, Nick Palladinos,
   **Complete Fusion for Stateful Streams: Equational Theory of Stateful Streams
   and Fusion as Normalization-by-Evaluation** (2024; revised 2026-02-10).
   [Primary source](https://arxiv.org/abs/2412.15768).
   Develops an equational theory and implementation for composable stateful stream
   fusion. Its coverage and formal treatment exceed this small pure prototype.

3. Scott Kovach, Praneeth Kolichala, Kyle A. Miller, David Broman, Fredrik Kjolstad,
   **Fast Collection Operations from Indexed Stream Fusion** (2025-07-08).
   [Primary source](https://arxiv.org/abs/2507.06456).
   Indexed streams support collection combinations without intermediate
   allocations. This is a close comparison point for future relational operators.

4. Thomas Bagrel, **Formalization and Implementation of Safe Destination Passing
   in Pure Functional Programming Settings** (posted 2026-01-13).
   [Primary source](https://arxiv.org/abs/2601.08529).
   Combines linearity and scope/age structure in a destination calculus with a
   mechanized safety proof. The proposed JTE destination/support extension must
   be compared against this work, not presented as invention of destinations.

5. **Tracking Captured Variables in Types** (2021).
   [Primary source](https://arxiv.org/html/2105.11896v1).
   Capture information can support effect/resource and region reasoning. JTE's
   proposed resource support component is not implemented or independently proven.

6. Alistair O'Brien, Didier Remy, Gabriel Scherer,
   **Omnidirectional type inference for ML: principality any way**
   (2025; revised 2026-05-01).
   [Primary source](https://arxiv.org/abs/2511.10343).
   Suspended constraints and incremental instantiation offer relevant approaches
   to richer inference. The bootstrap here uses conventional inference instead.

7. WebAssembly Community Group, **Wasm 3.0 Completed** (2025-09-17).
   [Official announcement](https://webassembly.org/news/2025-09-17-wasm-3.0/).
   Browser capabilities should be selected individually, not inferred from a
   catch-all “3+” label. The prototype emits a conservative core subset and does
   not need WasmGC, memory64, SIMD, or tail-call extensions yet. The unrelated
   wasm3 project is an interpreter, not Chrome's WebAssembly version.

8. V8, **A new way to bring garbage collected programming languages efficiently
   to WebAssembly** (2023-11-01).
   [Official article](https://v8.dev/blog/wasm-gc-porting).
   WasmGC can reuse the VM collector for managed objects. It is a possible future
   managed-island implementation, not the representation used in this prototype.

## Deliberately unclaimed

No exhaustive novelty search, proof of worldwide priority, or peer-reviewed result
is asserted. No end-to-end compiler correctness proof is included. No comparison
shows this prototype faster than existing languages or fusion systems. A measured
sub-millisecond warm compile of a tiny kernel does not establish large-program
scalability. Naming the experiment is not evidence for any of those claims.
