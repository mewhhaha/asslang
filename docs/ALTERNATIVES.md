# Source-defined kernel-local alternatives

[Documentation](README.md) · [Syntax](SYNTAX.md) · [Implementation](IMPLEMENTATION.md)

## Problem

Existing `lib/patterns.ass` Option/Result examples use a Boolean plus payload fields.
That concrete record encoding is useful at ABI/storage boundaries, but a local
`None` must carry a dummy success payload and a local error must carry fields for
the success branch. The placeholder is not data and becomes especially awkward
when the two branches have unrelated shapes or staged functions.

Before:

```ass
let choice = if present then option_some x else option_none 0;
option_default (-1) (option_map (value -> value*value) choice)
```

After explicit linkage of `lib/alternatives.ass`:

```ass
let choice = if present then maybe_some x else maybe_none ();
maybe_default (-1) (maybe_map (value -> value*value) choice)
```

The bounded goal is kernel-local choice without dummy payloads. It is not a new
storable algebraic-data representation.

## Semantics

The library uses an eliminator encoding:

```text
left a   = onLeft -> onRight -> onLeft a
right b  = onLeft -> onRight -> onRight b
match l r choice = choice l r
```

`either_left`, `either_right`, `either_match`, left/right maps and `either_bimap`
are ordinary source functions. `Maybe A` is the convention `Either () A`, exposed
through `maybe_some`, `maybe_none`, `maybe_match`, `maybe_map` and `maybe_default`.
No Boolean is treated as proof or authority.

For a *particular elimination*, the familiar Church-sum shape is
`(A -> R) -> (B -> R) -> R`. Asslang currently has rank-1 Hindley–Milner inference,
not higher-rank universal values. Therefore the encoded value is not a genuine
first-class `Either A B` whose hidden result type can be instantiated independently
at every elimination. A dynamic `if` choosing left or right unifies the callable
shapes and ties both handler results to one `R`. A statically known constructor may
erase the unused handler's result constraint after staging. Tests record both facts.

This limitation is deliberate and visible. The library is useful when a choice is
constructed and eliminated inside one compiled kernel. It is not a substitute for
a future native tagged-sum type needed by arrays, persistent storage or the ABI.

## Invariants

For total pure handlers, ordinary beta reduction gives:

```text
match l r (left a)  = l a
match l r (right b) = r b
```

The mapping helpers follow by the same two constructor cases. These equations are
structural arguments, not a mechanized proof; emitted-Wasm tests provide finite
regression evidence.

Lexical scope and hygiene are those of ordinary closures. Dynamic alternatives
still type-check both handlers. Runtime demand is separate: only the selected
handler result is demanded, so an unselected `require`, scan seed, causal state or
host effect remains unperformed according to the existing language rules. The
library cannot create JTE alignment, capability authority or causal access.

The abstraction does not change floating-point ordering, signed-zero/NaN rules,
AD activity checks, scan/fold stopping, prepared-call disposal, scratch ownership
or post-trap recovery. It has no compiler hook by which to do so.

## Representation and lowering

`lib/alternatives.ass` is canonical Asslang source only. Constructors stage to
ordinary closures. A runtime conditional between constructors reuses the existing
conditional callable plan; elimination specializes the chosen callable before the
concrete emitter. There is no runtime tag byte, closure object, payload registry,
host-language interpreter, guest allocation, parser form or callable primitive.

Functions cannot cross ASABI, so an exported encoded alternative is rejected with
`E_ABI`; a stream element that remains callable is likewise not representable.
Arrays returned *after* elimination still use normal output memory and loops. The
compiler charges parsing, inference and staged expansion to existing limits. No
limit is raised.

## Alternatives considered

**Keep Boolean-plus-placeholder records.** Retained for concrete ABI/storage uses;
it does not solve the local dummy-payload problem.

**Add native tagged variants now.** Rejected for this pass. A real sum requires
sum inference, exhaustive elimination, a concrete tag/payload layout, nested ABI
rules, arrays of variants, AD/demand rules and explicit ownership. Those obligations
should be justified by concrete storage or stream use cases rather than hidden in
this small library feature.

**Use `{tag,left,right}`.** Rejected because it preserves both placeholders and can
invite treating a scalar tag as authority.

**Use host JavaScript values.** Rejected; values and handlers must compile to the
existing WebAssembly path.

## Prior art and project-specific integration

Böhm and Berarducci, *Automatic Synthesis of Typed Lambda-Programs on Term
Algebras*, Theoretical Computer Science 39 (1985), 135–154,
DOI `10.1016/0304-3975(85)90135-5`, is established prior art for representing
algebraic data by typed lambda eliminators. The University of Pisa publication
record was checked on 2026-09-18. No novelty claim is made.

The project-specific result is narrower: Asslang's existing staged closures and
conditional callable lowering are sufficient to remove dummy payloads for one
kernel-local class of choices without widening the compiler core, while rank-1
inference sharply identifies where that encoding stops.

## Validation obligations

Publication requires:

- direct emitted-Wasm cases for unrelated payload types, `Maybe`, maps and bimap
  in all eight SIMD × reduction-fusion × memoization configurations;
- seeded independent value oracles and constructor/mapping law checks;
- rejection of invalid dynamic handler combinations, unused-definition errors and
  ABI escapes with source locations;
- trapping guards proving selected-branch demand and post-trap reuse;
- byte/ABI/JTE comparison against explicit eliminator expansions and a renamed
  library to demonstrate absence of name-sensitive compiler hooks;
- an array-producing handler with exact output capacity and loop budgets;
- two registered examples and an executable driver;
- full Node, host/reducer/case-study, documentation, core/prelude/operator and
  browser-engine checks, with HTTP loading reported separately.

See [the executed validation](ALTERNATIVES-VALIDATION.md).
