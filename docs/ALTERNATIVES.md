# Source-defined alternatives without placeholder payloads

[Documentation](README.md) · [Syntax](SYNTAX.md) · [Implementation](IMPLEMENTATION.md)

## Problem and acceptance criteria

The existing `lib/patterns.ass` Option/Result examples use a Boolean tag plus a
payload slot. That representation is useful at the concrete ABI, but it makes a
kernel-local `None` or error carry a dummy value of the success type:

```ass
let choice = if present then option_some x else option_none 0;
option_default (-1) (option_map (value -> value*value) choice)
```

The `0` is not data; it exists only so both records have one structural type. The
same pressure makes errors carry placeholder success values and successes carry
placeholder error fields. This becomes especially awkward when the two branches
have unrelated shapes or one branch contains a staged callable.

This pass should provide one ordinary-source alternative abstraction with these
acceptance criteria:

1. left and right payloads may have different Asslang types and neither constructor
   requires a payload for the other branch;
2. elimination is explicit and exhaustive at each use site: callers provide one
   handler for each branch, and both handlers are statically checked even when the
   runtime condition selects only one;
3. unselected handler *runtime* work is not demanded, including guards, stream
   seeds, causal state and host effects already protected by the language's normal
   demand/effect rules;
4. mapping either side and a `Maybe` specialization are derived in source, with no
   parser form, compiler builtin, runtime tag table, guest allocation or ABI change;
5. the abstraction remains honest about its boundary: encoded alternatives are
   staged callables and must be eliminated before a concrete ABI or stream element
   boundary. This is not a first-class stored tagged-union representation.

Readable source after the change should be:

```ass
let choice = if present then maybe_some x else maybe_none ();
maybe_default (-1) (maybe_map (value -> value*value) choice)
```

For two meaningful payloads, `either_left error` and `either_right value` should
compose with `either_match onError onValue` without inventing a common record.

## Semantics

Use an eliminator encoding. A left value is a staged function that accepts both
handlers and invokes the left one; a right value invokes the right one:

```text
left a   = onLeft -> onRight -> onLeft a
right b  = onLeft -> onRight -> onRight b
match l r choice = choice l r
```

In type notation, an individual use has the shape
`Either A B ~ (A -> R) -> (B -> R) -> R`. Asslang's ordinary Hindley–Milner
inference supplies the type variables; the library adds no explicit universal
syntax. A let-bound constructor result can generalize result variables under the
existing value/environment rules. Handler result types must unify, exactly as the
result arms of an ordinary conditional must unify.

`either_map_left`, `either_map_right` and `either_bimap` reconstruct the same
eliminator after transforming the selected payload. `Maybe A` is the convention
`Either () A`: `maybe_none ()` is the left branch and `maybe_some value` is the
right branch. `maybe_match`, `maybe_map` and `maybe_default` are ordinary source
specializations.

No Boolean is treated as proof or authority. A runtime `if` that chooses between
encoded alternatives is still an ordinary conditional. During staging, callable
choice is represented by the compiler's existing conditional callable plan. When
it is later applied to handlers, the normal staged call path checks both handler
bodies and carries the runtime condition into the selected result. The library
cannot forge JTE alignment, capabilities, effect permission or causal access.

## Invariants and proof obligations

For pure handlers `l` and `r`, beta-reduction gives the constructor laws:

```text
match l r (left a)  = l a
match l r (right b) = r b
```

The three mapping helpers should satisfy those two cases by the same reductions;
finite tests are regression evidence, not a mechanized proof. Nested alternatives
must not collapse their payload types or require a runtime registry.

Lexical scope and hygiene are inherited from ordinary closures. Both handlers are
type-checked because they are source expressions passed to the eliminator; a bad
handler in an unused definition must still be rejected by ordinary inference.
Runtime demand is separate: only the selected result of a dynamic callable choice
may be demanded. Tests must include a trapping guard in each branch to distinguish
static checking from runtime branch demand.

The abstraction must not change floating-point operators, signed-zero/NaN rules,
AD activity checks, JTE provenance, scan seeds, stopping folds, effect sequencing,
prepared-call ownership, scratch lifetime or output ownership. It has no mechanism
to do so: all payload computations remain existing staged values and all execution
uses existing Wasm lowering.

## Representation, lowering and resources

`lib/alternatives.ass` will contain only ordinary canonical source. Constructors
produce compiler-staged closures; dynamic selection uses the existing
`callable_choice` representation already needed for conditionals between
callables. Elimination specializes those closures before the concrete emitter.
There is no guest tag byte, payload buffer, closure object, descriptor table or
host-language substitute for the emitted computation.

Compile-time work is the normal parsing, inference and staging of the helper
source and its instantiated function bodies, charged to the existing syntax,
type and `maxExpansion` limits. Runtime work is precisely the selected payload and
handler work after ordinary optimization; a scalar example can therefore have no
loop or guest memory, but this document makes no general constant-work claim.
Arrays returned by a selected handler still require normal output storage and
loops; sorting still owns explicit scratch; effects remain direct `perform` calls.
No limit is raised.

Because functions cannot cross ASABI, an exported encoded alternative must remain
an `E_ABI` error. Likewise a stream of encoded alternatives is outside the current
concrete stream ABI. Adding a storable tagged representation would be a distinct
language/ABI design with layout, ownership, demand and nested-value obligations.
This pass intentionally does not smuggle such a representation through records.

## Alternatives considered

**Keep Boolean-plus-placeholder records.** They remain useful when a value must
cross today's concrete ABI, and existing examples stay compatible. They do not
solve the kernel-local dummy-payload problem, so they remain a separate structural
encoding rather than being silently reinterpreted.

**Add native `variant` syntax and a tagged ABI now.** This would give first-class
storage, but it immediately requires row/sum inference, exhaustiveness,
representation tags, nested ABI layouts, arrays of variants, AD rules and demand
semantics. That is too large for the reproduced authoring problem. The source
encoding earns experience with elimination before extending the trusted core.

**Use `{tag, left, right}` with two placeholders.** This only doubles the original
problem and risks confusing an ordinary Boolean/number with authority or proof.

**Use host JavaScript objects/functions.** Rejected. The language must execute its
payload and handlers through the existing compiler and emitted WebAssembly, not a
host interpreter advertised as a native language feature.

## Prior art and integration claim

Böhm and Berarducci's 1985 work shows that typed lambda calculus can represent
term-algebra elements and iterative functions through typed lambda programs; it is
established prior art for representing data by eliminators rather than by a new
runtime data constructor. The paper is *Automatic Synthesis of Typed
Lambda-Programs on Term Algebras*, Theoretical Computer Science 39, 135–154,
DOI 10.1016/0304-3975(85)90135-5. This pass claims no novelty for encoded sums.

Asslang's proposed integration is narrower: exploit its already-staged closures,
conditionals and let-polymorphism so a source library can remove dummy branch
payloads while retaining the current no-closure ABI. The useful project-specific
observation is conditional: if the existing callable-choice lowering preserves
static checking and selected-branch demand for these eliminators, no new compiler
primitive is justified for this kernel-local use case.

Primary source checked September 18, 2026:

- Corrado Böhm and Alessandro Berarducci, 1985, DOI
  `10.1016/0304-3975(85)90135-5`; the University of Pisa publication record gives
  the abstract, bibliographic data and journal DOI.

## Validation plan

Before publication:

- run direct Wasm examples for unrelated left/right payload shapes, `Maybe`, maps,
  nested alternatives and polymorphic let-bound values in all eight SIMD ×
  reduction-fusion × memoization configurations;
- compare values with an independent JavaScript oracle over a seeded family and
  check the two constructor laws plus mapping cases structurally;
- reject mismatched handler result types, invalid branch payload uses in unused
  definitions and encoded alternatives at ABI boundaries, with stable source
  locations;
- place trapping `require` work in opposite handlers to prove selected runtime
  demand while retaining static checking of both;
- compare representative helper calls with explicit source expansions, including
  emitted Wasm/ABI/JTE artifacts where the existing compiler makes equality a
  meaningful compatibility claim;
- register at least two materially different `.ass` examples, execute their
  documented snippets and add browser-engine coverage;
- measure emitted Wasm, loops, output/intermediate storage and compiler staging
  work for the runnable examples without making timing or asymptotic claims;
- run `npm test`, `npm run example:host`, `npm run example:reducers`, documentation,
  core/prelude/operator audits and the supported browser suite. HTTP loading is a
  separate check and must remain reported separately if policy-blocked.

If these checks expose eager unselected branch work, lost lexical constraints or
an ABI escape, keep the experiment out of main rather than weakening those
invariants.
