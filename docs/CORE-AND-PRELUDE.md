# A strong core, with policy in source

[Documentation](README.md) · [Architecture](IMPLEMENTATION.md) · [Syntax](SYNTAX.md)

## Implemented: library definitions, not special handlers

Four existing operations now live in ordinary source. Existing calls keep working;
there is no new syntax and no guest closure or buffer for the prelude. The exact
editable file is [lib/prelude.ass](../lib/prelude.ass):

<!-- core-prelude-source -->
```ass
// Compiler-shipped source, using the same language as user libraries.
// Available by default; link explicitly only with prelude:false / --no-prelude.
fn sum = xs -> fold xs 0 (total -> value -> total+value);
fn grad = f -> point -> (value_and_grad f point).gradient;
fn jvp = f -> point -> direction -> do {
  let plan = linearize f point;
  {value:plan.value, tangent:plan.pushforward direction}
};
fn vjp = f -> point -> weights -> do {
  let plan = pullback f point;
  {value:plan.value, cotangent:plan.pullback weights}
};
```

`sum` specializes the same ordered fold. `grad` projects the same forward gradient.
`jvp` and `vjp` apply the corresponding reusable plan once. These are not body-pattern
recognition rules: rename any of the functions and it compiles through the same
mechanisms. Their former bespoke inference/staging handlers and one-shot AD
implementations have been removed.

### Use the core without an implicit prelude

```sh
npm run audit:core
npm run check:prelude
npm run example:core-prelude
node src/cli.mjs examples/case-studies/core/block_energy.ass --no-prelude --lib lib/prelude.ass --run block_energy --args '[[1,2,3,4,5,6,7],3]'
```

The last command returns `[14,77,49]`. Without the explicit `--lib`, `sum` is unknown
in core-only mode. Default compilation still provides it. The JS equivalent is
`compileSources(files, {prelude:false})` with the prelude and application supplied
as ordinary named source fragments. The session cache distinguishes the modes.
Primitive names stay reserved; these four names may be defined by user source
only when the implicit prelude is disabled. Local shadowing remains unchanged.

The [inventory](core-inventory.json) covers **34 public callable names: 30 compiler
primitives and four source functions**. It deliberately does not hide expression
syntax, effects, ABI validation or budget accounting in that count. Normal tests
fail if a new builtin lacks a decision. The core is an audited practical basis,
not a claim of mathematical minimality.

### Compose the source layer with array and AD mechanisms

The complete [example driver](../examples/interop/core-prelude.mjs) compiles the
following program both with the implicit prelude and with explicitly linked
source in core-only mode. It asserts identical Wasm, ABI and JTE certificates:

<!-- core-example -->
```ass
// Derived source functions compose with block views and compiler graph transforms.
export fn source_basis = (samples:[Num]) -> (width:Num) -> (point:{x:Num,y:Num}) -> do {
  let energy = block -> block |> map (x -> x*x) |> sum;
  let objective = p -> p.x*p.x+p.y*p.y;
  let outputs = p -> {square:p.x*p.x, total:p.x+p.y};
  {
    blocks: samples |> chunks width |> map energy,
    gradient: grad objective point,
    along_x: (jvp objective point {x:1,y:0}).tangent,
    weighted: (vjp outputs point {square:1,total:2}).cotangent,
  }
};
```

On samples `[1,2,3,4,5,6,7]`, width 3 and point `{x:3,y:4}`, it returns block
energies `[14,77,49]`, gradient `{x:6,y:8}`, directional derivative 6, and weighted
reverse derivative `{x:8,y:2}`. Exactly ten loop units cover seven sample visits
and three block dispatches; the three energy outputs need 24 bytes. There are
two loop sites and no intermediate data buffers. Array descriptors, host input
snapshots and result copies still occupy storage. The emitted module is 3,220
bytes with the demonstrated loop allowance, in both the old and new compiler.

The AD source is a named JS-held source fragment, following the existing AD case
studies, since the corpus reference interpreter does not implement differentiation.
A separate array-only [block-energy kernel](../examples/case-studies/core/block_energy.ass)
is registered in the normal corpus. The guide snippets are checked against their
exact executable sources, not maintained as independent pseudo-code.

### Front-end work is not free

Shipped source is parsed once per inference run when needed (56 AST nodes), and
only referenced functions are inferred. This parsing is included in the inference
phase timing. `stats.syntaxNodes` still describes the user's input;
`stats.sourcePrelude` reports enabled mode, inferred helper names and additional
nodes. Both sets count toward the existing 50,000-node bound. Internal relocated
helper bodies are normal staged work charged to `maxExpansion`.

In the combined example, inference constraints rise 140 to 220 and staging work
102 to 158, while scalar graph nodes remain 107 and Wasm remains 3,220 bytes. A
previously sufficient very small expansion allowance may need adjustment; there
is no hidden exemption or raised default. This is less duplicated implementation
and a source-library foundation, not a claim of lower compile time or a smaller
compiler by line count. Packaging/inventory infrastructure adds code of its own.

[Executed validation](CORE-AND-PRELUDE-VALIDATION.md) records baseline comparisons,
core-boundary counterexamples, actual test results and the limits of these claims.

## Design before implementation

Base: merged main `00c22376ca58c4134e704b08c15939d7affe17d5`, tree
`3769fe5476ca935557f26919802ad449086b8f82`. The source archive reproduces that tree.
The question is not how few functions make the language computationally universal.
It is which operations must retain compiler knowledge to preserve types, demand,
event identity, numerical order, bounded work and storage ownership. A tiny
interpreter hidden inside one primitive would not be a smaller trusted core.

Separate three layers: (1) lambda/product/conditional syntax and scalar operations;
(2) compiler-owned stream, evidence, state, storage and differentiation mechanisms;
(3) ordinary source policies and derived operations. Host planning APIs such as
reconstruction/evidence synthesis are a fourth, explicit tooling layer: moving
JavaScript graph algorithms to a source string does not implement those algorithms
inside Asslang. Count public names separately from semantic mechanisms and code.

This change moves **sum, grad, jvp and vjp** from bespoke inference/staging
handlers to a compiler-shipped, ordinary Asslang prelude. Audit every remaining
builtin, record why it remains, and add executable counterexamples to overly
aggressive reductions. This is a first extraction, not a claim that 30 remaining
compiler entry points are a mathematically minimal or already tiny core.

## Source definitions and preservation targets

The definitions above use no privileged function bodies. In compact form:

```text
fn sum = xs -> fold xs 0 (total -> value -> total+value);
fn grad = f -> point -> (value_and_grad f point).gradient;
fn jvp = f -> point -> direction -> do {
  let plan = linearize f point;
  {value:plan.value, tangent:plan.pushforward direction}
};
fn vjp = f -> point -> weights -> do {
  let plan = pullback f point;
  {value:plan.value, cotangent:plan.pullback weights}
};
```

Sum is the identical ordered recurrence, starting at +0, not a reassociated real
sum. Preserve empty-input guards, sparse masks, causal transitions, loop accounting
and existing SIMD/fusion eligibility. A scalar additive fold already has the
backend representation needed by sums; do not keep a hidden special sum opcode.

Grad projects the existing forward-coordinate gradient. Do not replace it with
reverse accumulation merely because both differentiate the same real function:
floating-point accumulation order and the 64-input-leaf policy are part of the
existing contract. JVP/VJP construct the reusable plan and apply it once. Source
staging visits the complete result record, including an unselected derivative
field; the derivative is still checked at compilation even for value-only uses.
Runtime component demand and captured effect-result identity must remain intact.

Induction on accepted source events proves the sum recurrence. Projection proves
the grad equation. The existing reusable forward/reverse plan's application is
exactly the one-shot operation, with fresh derivative state per application and a
shared primal. Check emitted artifacts against the actual old compiler as well as
analytic execution. Reject the extraction or explicitly narrow its claim if an
edge case changes demand, diagnostics, bit behavior or repeated work.

## Source loading, namespaces and diagnostics

`lib/prelude.ass` is the editable source of truth. A deterministic checked-in JS
snapshot supplies that text synchronously to browsers and Node, without filesystem
or network reads while compiling. Its generator/check mode and normal tests must
detect drift. This is packaging, not JavaScript reimplementation of the functions.
The prelude uses the same parser, inference, let polymorphism and staging as users.
No string matching on its function bodies, runtime plugin registry or authority.

Default compilation keeps the existing public spellings and reserved names. Parse
and infer the source prelude lazily when an unshadowed derived name is used. Keep
user parsed ASTs, source offsets, explicit source-file manifests and public
signatures separate from the shipped source. Internal helper failures should be
localized to the invoking source expression, not a misleading offset into the
prelude. User objectives keep their own locations. Partial applications, aliases,
local shadowing and mixed canonical/legacy callers must remain valid.

Add explicit `prelude:false` to compile/check/session APIs, and `--no-prelude` to
the CLI. This mode has only compiler primitives; a bare sum/grad/jvp/vjp is unknown,
while linking the exact prelude as ordinary source restores the functions. Users
may define these four names themselves in that mode, without replacing compiler
primitives. Default mode does not permit a global override. Include the option in
cache identity so a default-mode hit cannot bypass core-only checking.

Count parsed prelude nodes against the existing syntax budget and charge its
invocations/body staging to the existing expansion budget. Report prelude use and
front-end cost separately; do not promise the same inference/staging counts or
success under the smallest expansion allowance. No increase to source, nesting,
ABI, runtime-loop or memory bounds. The checked-in snapshot is immutable text;
parsed ASTs and inferred schemes must not leak between compilation sessions.

## Complete boundary audit

The current surface has 34 callable builtin names. The extraction leaves 30
compiler names and four source-prelude names; syntax operators and host authority
are additional mechanisms, not omitted from the accounting. An inventory checked
against the actual arity tables will prevent unclassified new builtins.

| Compiler family | Names retained | Reason and next boundary |
| --- | --- | --- |
| Numeric instructions | sqrt, abs, min, max, floor | Exact f64 operations, signed zero/NaN behavior and AD rules. Source arithmetic algorithms or conditional min/max are not interchangeable. |
| Borrowed bytes | utf8, byte_length, byte_values | Representation-aware, bounded borrowed access. Text algorithms remain source. |
| Indexed structure | range, at, split_at, concat, chunks, flatten | Checked extents/index maps; cover witnesses restore alignment; symbolic families need no descriptors. Generic gather/segmented descriptors would need explicit proof and storage contracts. |
| Mapping and pairing | map, zip, zip_checked | Preserve event identities and checked positional pairing. A range plus at cannot replace map on causal/sparse sources or retain its domain. |
| Clock and state | filter, scan, transduce | Acceptance clocks, simultaneous state updates, lazy seeds, scan reset schedules. Encoding scan as emit-always transduce currently loses its domain/density. |
| Observation and reduction | count, fold, fold_until | Count distinguishes structural from value demand. Folds preserve ordered recurrence; stopping folds must not visit a suffix. A generic stop-aware sink is a future IR factoring, not a transparent source replacement yet. |
| Bounded iteration | iterate | A metered non-stream loop with explicit progress budget; no unrestricted source recursion. |
| Strict materialization | sort_by | Finite strict keys/rows, new event domain and disjoint caller-owned scratch. Ordering policy and tuple subkeys are source; the barrier is not. |
| Guard | require | Demand-aware guard placement on values, streams and callables. Ordinary eager assertions do not express it. |
| Graph transforms | linearize, pullback, value_and_grad, stop_gradient | Compiler graph/shape access, perturbation identity, activity and unsupported-operation checks. A general numeric-product traversal could eventually express coordinate gradients, but needs separate type/demand/limit design. |

Already-source functionality includes reducer dictionaries and their products and
adaptors (`lib/reducers.ass`), read-only neighborhood maps (`lib/windows.ass`),
functional and result/option patterns (`lib/patterns.ass`), tuple-key policies,
block algorithms and calibration policies. No compiler builtin is needed for
means, dot products, variance conventions, stencils, any/all, threshold reports,
reducer products or application-specific sorting priorities.

Type equality, lexical binding, record projections, conditional demand and exact
scalar arithmetic stay in the expression core. JTE certificates are checked
compiler evidence, not user Booleans asserting alignment. Host declarations and
`effect`/`perform`, ASABI validation and the budget meter are separate trusted
boundaries; none can move to unprivileged source by renaming them as functions.

## Counterexamples to a cosmetically smaller core

1. `count (map (range n) (x -> require false x))` can use structural extent without
   visiting elements. A counting fold needs n loop units even if it ignores its
   element. On causal input, count must advance the state machine instead.
2. Replacing map by `range (count xs) |> map (i -> f (at xs i))` creates a fresh
   domain. Zipping with xs is not proved aligned, and causal/random access fails.
3. An emit-always transduce is not currently a domain-preserving scan. Its values
   may agree, but its provenance/density certificate and composability do not.
4. A full fold cannot implement early stopping by merely freezing its accumulator;
   upstream state transitions would still visit an invalid suffix.
5. `if a <= b then a else b` is not f64 min on signed zero or NaN. Real-number laws
   do not authorize changing numeric boundary behavior.
6. `require (count a == count b) (zip a b f)` cannot manufacture equal event origins.
   Only the checked-pairing primitive issues the new positional domain.

Executable tests should cover these distinctions. They prevent later refactors
from mistaking value-only equations for full type/demand/resource equivalence.

## Future additions must earn a place

Keep proof-producing array structure, state scheduling, bounded sinks and explicit
storage as the basis. Before adding a primitive, try a normal source definition;
show the precise missing capability when it fails. Consider a core addition only
for information source code cannot express soundly, or a demonstrated execution
boundary that cannot be lowered through existing mechanisms.

Potential future work: a generic checked stream-machine/sink IR; a numeric-product
traversal for AD shape programs; finite materialization with scoped scratch;
segmented/gather maps with nonforgeable cover evidence; and size-decreasing
recursive skeletons. These are not granted by this PR, nor justification for an
untyped escape hatch. Preserve useful high-level semantic distinctions until a
smaller representation carries the same proofs, demand and cost information.

The acceptance test is contextual, not just mathematical: source definition plus
existing primitives must preserve values/bit-sensitive conventions, accepted
types, source diagnostics, demand/traps, event proofs, effects and guest resource
behavior. A future migration may deliberately change one axis, but must name it
rather than label everything an equivalent abbreviation.

## Validation plan and related work

Run the unchanged baseline, then every Node test and required host/reducer runner.
Compare all baseline corpus sources across eight lowering configurations; include
AD-specific programs not in that corpus. Compare implicit prelude, explicitly
linked source in core-only mode, renamed source helpers and the actual old binary.
Test polymorphism, aliases, shadowing, empty/sparse/causal/chunk/window/sorted input,
secondary derivative validation, signed zeros/NaN, effects, source locations,
limits, options, cache isolation and CLI. Run the available Chromium harness and
record unavailable paths. Add a source-composition example, measured front-end
costs, inventory coverage and deterministic-snapshot checks. Preserve historical
reports and the short README.

Established context (checked September 14, 2026): Futhark separates its source
prelude from compiler-recognized second-order array combinators, and its
scan/scatter fusion work illustrates how a better internal mechanism can remove
special cases rather than merely add operations. GHC distinguishes a small typed
Core IR from the much larger source library surface. These motivate the audit,
not proofs about Asslang or claims of historical novelty.

- https://futhark-lang.org/docs/prelude/doc/prelude/prelude.html
- https://futhark-lang.org/docs/prelude/doc/prelude/soacs.html
- https://futhark-lang.org/blog/2026-03-24-scan-scatter-fusion.html
- https://downloads.haskell.org/~ghc/9.4.1-alpha2/docs/libraries/ghc/GHC-Core.html

No proof assistant, independent compiler audit, user-readability study or universal
minimal-core theorem is claimed. Record executed results in a new companion report.
