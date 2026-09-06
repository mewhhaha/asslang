# Implementation theory

This document maps the current kernel prototype to its implementation. It is not
a promise of general-purpose language features. See [SYNTAX.md](SYNTAX.md) for the
canonical surface and its lowering, and the feature documents
linked from [the index](README.md) for detailed rules and historical evidence.

## One checked pipeline

`src/compiler.mjs` composes parsing, inference, staging, Wasm emission, and binary
validation. `compileSources` links explicitly provided source fragments in one
namespace and remaps errors to file-local offsets; it is not an implicit loader.
Compiler sessions cache complete, independent artifact snapshots, not mutable
per-definition inference state.

`src/unary.mjs` parses the canonical surface and lowers it to the shared AST.
`src/frontend.mjs` tokenizes with source offsets, retains the legacy grammar, and infers
Hindley–Milner-style types with record rows. Generalization excludes variables
free in the local environment. The occurs check rejects infinite types. Recursive
definition dependencies are rejected rather than silently unrolled. Export
annotations close otherwise ambiguous ABI boundaries. Ordinary types do not
contain runtime stream lengths or event identities.

Canonical functions consume one value at a time. A chain `x -> y -> body` can be
represented internally as a parameter vector as long as application and type
unification preserve currying. This is an implementation optimization, not a
second source-level argument convention. A tuple or record is one product value,
not a comma-separated call argument list. Pattern lowering must bind the input
once, keep lexical scope, and reject duplicate bindings.

## Static abstractions, dynamic scalar work

`src/jte.mjs` interprets statically known functions into a scalar graph and stream
plans. Closures, records containing functions, and partial applications exist in
the compiler; they do not require guest closure allocations. Applying a prefix of
a function's arguments retains a captured environment. Applying the remainder
continues staging. Functions may not escape through the concrete ABI.

A stream plan contains an extent, cursor observations, values, guards, and any
causal machines. JTE records relational facts about event domains, density, and
seekability. Equal extents do not establish event alignment. `zip_checked`
introduces a guarded positional domain rather than equating source provenance.
`scan` preserves domain and density but loses random-access capability.

Pure bindings form a demand graph: unused pure work is not an implicit effect.
State transitions impose scheduling boundaries when traversed. Transformations
must preserve floating-point order, guard obligations, and empty-stream behavior.
Functions used by folds and zips must behave identically whether written as a
curried chain or through the legacy multi-parameter surface.

## Binary and authority boundaries

`src/wasm.mjs` emits scalar locals, loops, bounds checks, and ASABI 1 metadata.
`src/abi-schema.mjs` describes the supported wire shapes, and `src/abi.mjs` lowers
and lifts host values with explicit memory lifetime. There is no guest heap
allocator, but compilation and JS adapters allocate normally.

Canonical arrow chains at exported declarations are flattened only for the wire
calling convention: JS supplies an argument array and Wasm receives its slots.
This does not export a closure or change existing ASABI 1 schemas. Positional
products can reuse closed record layouts instead of introducing a new binary
kind; their exact field convention is specified in SYNTAX.md.

Host declarations are capabilities, never ordinary pure closures. `perform`
requires a direct, fully applied declared host call in an exported effect body.
Partial application must not hide, duplicate, or defer a host effect. Inference
and staging retain this explicit boundary independently of call punctuation.

## Resource bounds and evidence

Tokenization is bounded by the source-size limit; parsing by node and nesting
limits; inference by finite types and acyclic definitions; staging by its expansion
budget; ABI schemas by depth and field budgets. No parser optimization may turn
malformed input into an unbounded scan, native stack crash, or accepted prefix.

Correctness evidence should include parser shape and error tests, inferred types,
Wasm execution, ABI compatibility, effects, JTE certificates, source composition,
and default/optimized equivalence. Timing measurements must separate parsing from
inference and emission, disclose the workload, and avoid timing-based CI gates.
