# Vertical composition and local patterns

[Language syntax](SYNTAX.md) · [Practical workflows](CASE-STUDIES.md)

## Design before implementation

The language already has a useful visual vocabulary: `->` introduces a function,
`|>` advances a value, `=` binds it, `:` labels a field or annotates a parenthesized
binder, `{...}` is a product, and `do {...}` gives local scope. Newlines are whitespace;
commas and semicolons make grouping explicit. Do not add another operator merely
to make a short demo terse, or silently switch existing data-first pipes to a
last-argument convention.

The concrete asymmetry is that function parameters accept patterns but a local
`let` accepts only an identifier. The calibration fold repeatedly names a result
and projects `result.value` and `result.gradient.gain`. A stopping pipeline needs
another layer of projections to return a useful report. Extend canonical local
bindings to `let pattern = expression;` in `do` and exported `effect` blocks.
Reuse record/tuple/typed binder syntax and existing tokens. Add runnable vertical
examples, then simplify the actual calibration kernel without changing its work.

Baseline main `fb0467b59ce6c5365466d8806bbdce0f4bf17527` has tree
`4010694595195ce1dd78c4a9f7bbf61909c1af56`. The supplied source reconstructs that
exact tree; all 1,245 unchanged Node tests passed before edits.

## Syntax contract

Examples of the proposed local bindings:

```text
let {value: loss, gradient: {gain: dg, bias: db}} = calculation;
let (first, second) = pair;
let {model, status} = report;
let (weight: Num) = expression;
```

Records select named fields from potentially wider records. Tuples are exact
positional products, not JS arrays or argument lists; singleton tuples need a
comma and `()` is the empty product. Nested patterns, renaming, static-symbol
keys and trailing commas reuse the existing binder grammar. An annotation is an
additional type constraint, not permission to erase the pattern's product shape.
There are no literals, alternatives, array patterns, rest patterns or runtime
pattern-match failures. `_` is still an ordinary identifier, NOT a new wildcard.

All names introduced by one pattern are distinct. A later binding in the same
block cannot rebind any of them. Outer names may be shadowed, and the right-hand
side uses the preceding environment: the new names are not recursive or in scope
inside their own initializer. Inner blocks retain lexical scope. Preserve the
unchanged fast path and AST for the old `let name = expression;` spelling.

Inside `effect`, `let pattern = perform host ...;` must still contain a direct,
saturated declared host call. Keep the performed binding separate from the pure
pattern unpacking. Current host results are Num/Bool, so a product pattern on a
host result is a type error; an annotated scalar binder is useful. Never wrap the
host call in an ordinary function or infer authority from a product pattern.

## Lowering and proof obligations

Lower a patterned binding to one fresh, compiler-only binding and ordinary
projections. A typed lambda acts as the shape checker: it takes the existing
pattern's single parameter, projects its names, and returns those names in a
compiler-side record. Its application contains the source initializer exactly
once. Each user name then projects from that shared result. Preserve any nested
annotation constraints instead of allowing an outer annotation to discard them.
The compiler-only lambda/record must not escape to the guest ABI.

For a well-typed product v, each bound name receives exactly the projection at
its pattern path. Structural induction over the pattern proves this: a name is
the identity, a record extends the path by its field, and a tuple extends it by
its positional field. Fresh names cannot capture user names. The initializer is
outside the lambda binder's scope. Subsequent aliases use normal let
instantiation/generalization; free variables of the preceding environment remain
monomorphic. Do NOT translate the entire continuation to a lambda over the new
names: that would make locally polymorphic function fields monomorphic.

The initializer is staged once into the same pure graph as a named binding.
This is not a promise of one runtime traversal: demand, reduction memoization and
fusion decide actual execution. Unused bindings/fields stay undemanded at runtime,
while every initializer is still type-checked. In particular, binding `valid` does
not assert it. Use `require valid value` for mandatory validation. Destructuring a
required record must retain its guard; destructuring a stopping result must not
force its unvisited suffix. For effects, one performed node remains forced exactly
once in the original order even if the bound result is unused.

The parser constructs only existing AST kinds. The existing inference, staging,
reference evaluator, JTE, emitter, ABI and cache formats need no new semantic case.
Charge generated lambdas, constraint checks and field projections to the existing
syntax-node limit. Keep 256-level parsing/depth bounds and source limits; nesting
and pattern width are bounded, not an unbounded code generator.

## Syntax review: decisions and trade-offs

| Concern | Decision |
| --- | --- |
| Reading a long pipeline | Put one `|>` stage on each line. The operator marks continuation; indentation is not semantic. |
| Many results from one stage | Bind a named record pattern, then construct the output record. Use labels instead of positional tuples at large public boundaries. |
| Large callbacks | Use `(state -> sample -> do {...})`, or extract a named function. Parentheses make the callback boundary explicit. |
| Distinguishing data from local scope | Keep `{field: value}` versus `do {let ...; result}`; do not revive ambiguous bare-brace blocks in canonical code. |
| Argument order | Keep `x |> f a` equal to `f x a`. Grouping `x |> (f a)` deliberately means `(f a) x`. Document this real difference. |
| Partial application | It binds leading arguments. Data-first pipeline stages and configuration-first factories are both useful, but are not interchangeable spellings. |
| Local annotations | Keep `let (x: Num) = ...`; `let {x: alias} = ...` renames a field. Use `{x: (alias: Num)}` when both are needed. |
| Adding punctuation | No new lexical token, keyword, precedence tier, implicit placeholder or indentation rule. |

An ordinary grouped lambda already routes a pipeline into any argument position
or a result-building block. A new `then`/`into`/placeholder operator would duplicate
that capability. Removing callback parentheses would blur arrow-body scope.
Automatic semicolon insertion would make vertical rearrangement change programs.
Flipping pipe insertion order would silently break current pipelines. A mandatory
formatter, algebraic variants, record update/rest patterns and general pattern
matching are separate design problems, not smuggled into this change.

This is a design assessment, not an empirical readability study. New syntax can
reduce repetitive projections without making a deeply nested algorithm readable
by itself. Prefer named stages, short records, explicit units and domain names;
a one-line character-count reduction is not the sole objective.

## Examples and validation plan

Add three small tasks using real supported behavior: prefix consumption that
stops before invalid suffix data; a single causal history branching into arrays
and final state; and a paired-input error summary with a named report. Register
all `.ass` files in the corpus, run their full input/output examples, and show
byte equality to equivalent explicit-projection code. Refactor per-sample
calibration unpacking and test its bytes against the actual baseline in all eight
SIMD/fusion/memoization modes, with and without an invocation loop allowance.

Test nested record/tuple patterns, annotations, missing/extra fields, empty shapes,
polymorphic function fields, monomorphic captures, duplicate names, lexical
shadowing, static symbols, performed-call sequencing and authority rejection.
Compare vertically formatted versus compact programs (including comments and
CRLF), parser shapes, right-hand-side occurrence counts, strict field/type checks,
lazy guards, shared machine identity, stopping behavior and exact loop budgets.
Add positive/negative linked-source diagnostics, cache/lease checks, bounded
parser failures and browser registration. Run all Node tests, required examples
and available browser paths. Preserve historical reports, record actual results,
and keep the README short.

## Prior art and limits of the claim

Pattern bindings are established language design, not a novel type-inference
result. OCaml documents local `let pattern = expression` bindings [1]. F# documents
value-to-function pipelines [2]; Elixir documents first-argument pipe insertion
[3]. Asslang retains its own published first-argument rule rather than treating
those conventions as equivalent. Their runtime pattern/effect rules are not
imported by this patch.

[1] OCaml manual, expressions / local definitions:
https://ocaml.org/manual/5.3/expr.html
[2] Microsoft, F# language reference, functions / pipelines:
https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/functions/
[3] Elixir, Kernel, pipe operator and `then`:
https://hexdocs.pm/elixir/1.15.7/Kernel.html

Sources checked September 12, 2026. The written lowering argument and finite
regressions are not a proof-assistant check, independent review, throughput result
or a user study establishing universal elegance.
