# Familiar concepts through this language's current model

The examples below are actual corpus programs, not future syntax presented as
implemented functionality. There are three distinct layers: inferred value types,
JTE relational observations, and explicit ABI/effect boundaries.

## Traits / type classes: explicit staged dictionaries

`examples/concepts/traits.ass`:

```text
fn combine_all(xs, monoid) = fold(xs, monoid.identity, monoid.combine);
fn addition() = { identity: 0, combine: (a, b) => a + b };
fn multiplication() = { identity: 1, combine: (a, b) => a * b };

export fn aggregates(xs: [Num]) = {
  sum: combine_all(xs, addition()),
  product: combine_all(xs, multiplication())
};
```

The helper infers the fields and function relationships it requires. The
implementation uses open record-row inference, not a name-based duck-typing
check during execution. Dictionaries and closures are staged away. Two choices
can coexist without global instance search, overlap rules, or ambiguity.

This encodes trait-style behavior, not a complete trait system: there are no
associated types, coherence checker, implicit instance resolution or automatic
algebraic-law proofs. A user-provided monoid can violate its advertised laws;
`fold` still uses its exact left-to-right implementation.

## Type programming: inferred structural transformations

`examples/concepts/type_shapes.ass`:

```text
fn pair(a, b) = { first: a, second: b };
fn project(value) = value.first;
fn compose(f, g) = x => f(g(x));
```

The inferred shapes include:

```text
pair    : ('a, 'b) -> { first: 'a, second: 'b }
project : { first: 'a, ..r } -> 'a
```

An ordinary value-level combinator also transforms an inferred type shape. Static
higher-order composition then specializes that computation into the kernel. This
is useful for representation-generic helper code and dictionary construction,
without a separate template language.

However, **types are not first-class source values in this prototype**. There is
no arbitrary dependent computation, type-level recursion, conditional type family,
GADT matcher, higher-rank checker, `typeof` program, or associated-type projection.
Calling `pair` a proof of those features would be misleading. The compiler API
exposes inferred signatures and an ABI schema to JS tooling, but that is a tooling
interface, not a source-language dependent type system.

## Refinements: distinguish a runtime contract from a static relationship

`examples/concepts/refinements.ass` has both:

```text
fn positive(x) = require(x > 0, x);
export fn safe_ratio(numerator, denominator) =
  require(numerator >= 0, numerator) / positive(denominator);
```

`require` checks when the guarded result is demanded. It traps rather than returning
an unchecked value. It does not create a static Positive type or ask an SMT solver
to prove positivity at call sites. Dead values and unchosen branches are not forced.

JTE domains, by contrast, are a **static relational refinement**:

```text
let valid = xs |> filter(x => x >= 0);
zip(map(valid, sqrt), map(valid, x => x + 1), (a, b) => a + b)
```

Both branches preserve the same ordered events, so composition is statically
accepted and a runtime zip-length check is unnecessary. Independent filters are
rejected even when their emitted counts happen to match. These facts live in an
observation derivation, not in a vector's element/length type arguments.

## State machines / loops: immutable record folds

`examples/algorithms/fibonacci.ass` uses `{previous, current}` as a fold state.
`welford.ass` tracks count, mean and second moment; `linear_regression.ass` tracks
centered bivariate statistics. Record states lower to scalar locals, and all
next-state fields are evaluated before any accumulator is changed. No runtime
record is allocated on each iteration.

This is an idiomatic alternative to recursion for finite kernels. It does not
supply general recursion, arbitrary heap state, or a full tail-call optimizer.

## Ownership / borrowing

Inputs are borrowed spans inside the compiled ABI; outputs are written into a
caller-provided region. The recommended JS adapter copies both boundaries and
resets the private region after lifting. This establishes a useful call lifetime
without pretending that a general ownership/borrow checker already exists.

Text and byte results may alias input storage inside that call. JS never receives
a raw view into an arena that will be reset. General escaping closures, retained
host resources, regions spanning multiple calls and generation-checked leases are
future work.

## Effects / IO sequencing

`examples/interop/host_effects.ass` uses a strict effect block around a pure graph.
The hidden linear invocation state and broker grants are described in EFFECTS.md.
This is intentionally smaller than algebraic effects or a general IO monad:
currently the effect trace is finite and statically known, while ordinary
computation may contain data-dependent loops.

## What JTE contributes, and what it does not claim

The executable project now connects observation identity to iteration schedules,
lexical cursor scoping, demand-preserving memoization, and versioned boundary
contracts. The same source corpus tests both inferred relationships and execution.

Record rows, staged dictionaries, destination buffers, capabilities and fusion have
extensive precedent. This implementation is not a claim of worldwide priority for
any of them. The research direction remains whether observation and resource-support
summaries can become a modular, compositional interface that is stronger than
ordinary value types without making compilation globally dependent on callee bodies.
Per-definition caching, sealed modular observation summaries, and general resource
support inference are still not implemented.
