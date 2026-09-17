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

## Source prelude

`lib/prelude.ass` defines sum, grad, jvp and vjp in ordinary Asslang. A deterministic
checked-in text snapshot lets the same synchronous compiler run in Node and a
browser without reading files. Default inference loads those definitions only
when needed; `prelude:false` disables them and permits explicit source linkage.
There are no staging handlers for these four names. See [the core audit](CORE-AND-PRELUDE.md)
for namespace, source-location, resource and compatibility rules.

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

Static [record symbols](RECORD-SYMBOLS.md) resolve to a compiler-only field
namespace in the shared record/field AST and row types. Keys, protocol dictionaries,
and function fields require no guest property table. `src/record-keys.mjs` defines
this namespace and diagnostic display; `schemaOfType` rejects symbol-keyed fields
at every ABI record boundary. The frontend checks declarations per compilation,
without a global registry or runtime key generation.

## Binary and authority boundaries

`src/wasm.mjs` emits scalar locals, loops, bounds checks, and ASABI 1 metadata.
`src/simd.mjs` conservatively plans optional f64x2 lane operations for dense maps
and ordered additive reductions; no vector ABI or intermediate buffer is added.
Reduction cohorts are enabled by default, with an explicit opt-out. Dense
co-demanded causal output arrays and direct folds can also share a traversal;
`src/output-fusion.mjs` checks schedules and demand before the writer reserves
their final ABI slices. See [output fusion](OUTPUT-FUSION.md) for exact limits. See
[EXAMPLES-SIMD.md](EXAMPLES-SIMD.md) for eligibility and compatibility.
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

## Indexed array views

`src/array-views.mjs` stages `split_at` and `concat` as checked index maps, not
runtime buffers. Balanced segment dispatch reads only the selected indexed
source. Prefix boundaries are scalar guard work outside a consumer loop. JTE
cut-cover rules can restore the original domain when complementary halves are
reassembled after maps. Reversal, independent cuts and positional zips do not
forge that cover. Dense/seekable requirements exclude implicit causal replay.
See [array views](ARRAY-VIEWS.md) for bounds, demand, output ownership and proofs.

`lib/windows.ass` remains ordinary explicitly linked source over those checked
views. `window_map_indexed` threads the existing outer window ordinal and source
start into a staged `{index,start,window}` callback record; `window_map` is its
translation-invariant specialization. No position stream, runtime zip guard, or
window descriptor buffer is added. See [window origins](WINDOW-ORIGINS.md).

## Arithmetic chunk families

`src/chunk-views.mjs` represents fixed-width chunks by one symbolic outer cursor,
one inner cursor and checked arithmetic, not per-chunk data/descriptor buffers.
Block callbacks use existing scalar/record reductions and causal schedules.
Cover-preserving `flatten` substitutes quotient/remainder coordinates and restores
source event alignment. Independent block selection issues a fresh domain.
Structural block guards use a metered preflight; costly per-item reductions are
rejected rather than silently replayed. Complete local scans can flatten with
boundary-reset scalar state; see [scan integration](CHUNK-SCAN-INTEGRATION.md). The existing
value ABI still rejects nested arrays. See [chunk views](CHUNK-VIEWS.md).

## Native finite ordering

`sort_by` introduces a strict finite materialization boundary and a fresh dense,
seekable JTE domain. Invocation-closed order nodes cache scalar-record payloads
and finite numeric keys; `src/order-wasm.mjs` emits stable iterative merges into
two bounded scratch buffers. Downstream reads share a completed order. Runtime
nested sort construction is rejected until scoped scratch lifetimes exist.

Modules requiring scratch explicitly use ASABI 2, appending pointer/capacity slots
only on affected exports. The managed adapter owns that separate region. Existing
non-sorting modules remain ASABI 1, with unchanged bytes and value layouts.
Runtime-sized intermediate storage is reported, not counted as zero. See
[native ordering](NATIVE-ORDERING.md) for strict demand, memory and work contracts.

## Optional runtime loop budgets

`maxLoopIterations` adds one private i32 local per exported invocation and a
checked debit after each emitted loop's exit test. Nested loops share the local;
SIMD pairs debit two scalar iterations. The counter resets on each normal,
prepared, or raw call, with no imported budget service or ASABI argument.
`asslang.limits` describes the optional policy without changing `asslang.abi`.
See [LOOP-BUDGETS.md](LOOP-BUDGETS.md) for optimization-dependent cost, traps,
host-effect ordering, and the distinction from CPU-time or instruction limits.

## Resource bounds and evidence

Tokenization is bounded by the source-size limit; parsing by node and nesting
limits; inference by finite types and acyclic definitions; staging by its expansion
budget; ABI schemas by depth and field budgets. No parser optimization may turn
malformed input into an unbounded scan, native stack crash, or accepted prefix.

Correctness evidence should include parser shape and error tests, inferred types,
Wasm execution, ABI compatibility, effects, JTE certificates, source composition,
and default/optimized equivalence. Timing measurements must separate parsing from
inference and emission, disclose the workload, and avoid timing-based CI gates.

## Numeric shape programs

`src/products.mjs` elaborates bounded `product_map`, `product_zip` and
`product_fold` operations over numeric records. Inference propagates their shape
restriction through generic helpers; staging checks the actual shape again and
invokes ordinary source callbacks. A fold can construct staged functions or
array plans without a new runtime type or opcode. See [the contract](TYPE-PROGRAMMING.md)
for traversal order, demand, limits and the difference between static shape and
dynamic numeric/array work.

## Shape-preserving record updates

Canonical `{base with field:value}` adds one static `record_update` expression,
not a callable builtin or guest object operation. Inference requires each label
on the base's row with the replacement's type and returns the same complete row.
Staging evaluates the base once, shallow-copies its field map and replaces only
the specified entries. It retains untouched graph/closure/stream references and
charges every copied field to `maxExpansion`. No emitter, JTE, ABI or guest
allocation rule is added. See [the contract](RECORD-UPDATES.md) and
[executed validation](RECORD-UPDATES-VALIDATION.md). The callable inventory stays
at 33 primitives and four source-prelude functions; its additional expression
entry and audit make the trusted syntax/typing/staging boundary explicit.
