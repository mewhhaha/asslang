# Unary syntax and deterministic parsing

## Design contract

New Asslang source uses one function abstraction and one application rule:

```text
fn add = x -> y -> x + y;
fn add_pair = (x, y) -> x + y;
fn add_fields = { z, y } -> z + y;
export fn answer = (x: Num) -> add x 2;
```

Arrows associate right: `x -> y -> body` is `x -> (y -> body)`.
Application associates left: `f x y` is `(f x) y`. Parentheses group a value; they
are not call punctuation. `f (x, y)` passes one tuple, `f { z, y }` passes one
record, and `f x` passes one ordinary value. All three use the same call rule.
Partial application is supported for user functions and pure builtins. Function
values remain statically staged and cannot escape through the ABI.

This is a language-design simplification, not a claim to have invented currying,
products, or whitespace application. The additional improvements are explicit
block syntax, uniform pattern binders, predictable precedence, and bounded
lookahead. Performance must be measured rather than inferred from fewer symbols.

## Products, patterns, and types

`(x)` groups one value. `()` is unit (the empty product). `(x,)` is a singleton
tuple. `(x, y)` is a pair; trailing commas are permitted. Tuples lower to closed
positional records with fields `_0`, `_1`, and so on. This is deliberate structural
sugar: `(x, y)` and `{ _0: x, _1: y }` have the same representation and type.
There is no separate nominal tuple type or allocation. Pattern arity is exact.

Record puns include singletons: `{ x }` means `{ x: x }`. Record patterns can
select fields from a wider record; tuple patterns require their exact positional
shape. Nested patterns and record renaming are permitted, such as
`({ point: (x, y) }, scale) -> (x + y) * scale`. Duplicate bound names are errors.

An annotation attaches to a parenthesized binder: `(x: Num) -> body` or
`(pair: (Num, Num)) -> body`. Product annotations use the same positional-record
lowering. Record annotations retain named fields; `[Num]` remains a stream.
Function annotations use right-associated arrows, for example
`(f: Num -> Num) -> (x: Num) -> f x`.

At the JS ABI, a positional product is an ASABI record, not a JS array. A pair is
passed as `{ _0: 3, _1: 4 }` and unit as `{}`. JS arrays still represent streams.
An export with two leading arrow binders has two host arguments; an export with
one pair binder has one record argument. This keeps ASABI 1 unchanged.

## Explicit blocks and effects

Braces in canonical expressions always construct a record. Use `do` for local
bindings, making `{ x }` unambiguous:

```text
export fn energy = (xs: [Num]) -> do {
  let square = x -> x * x;
  let values = map xs square;
  sum values
};
```

`effect { ... }` remains an explicit authority boundary. Canonical host signatures
are arrow chains: `host fn audit: Num -> Bool;`. `perform audit value` must directly
and fully call that declaration; it cannot return a host closure. Ordinary
functions, including pure callbacks, cannot invoke hosts without `perform`.

## Precedence and delimiters

From weakest to strongest: arrow bodies; pipes; `||`; `&&`; equality; comparisons;
addition/subtraction; multiplication/division; unary `-`/`!`; application; field
selection. A lambda used as a call argument must be grouped: `map xs (x -> x*x)`.
Negative arguments are grouped too: `f (-x)`; `f x - y` means `(f x) - y`.

Calls require a whitespace or comment gap. `f(x)` is rejected in a canonical body;
write `f (x)`. Newlines are whitespace, not statement separators. Definitions and
`let` bindings end with `;`. There is no indentation-sensitive grammar.

Pipes retain the existing stream-first convention: `xs |> map f |> sum` lowers to
`sum (map xs f)`. A pipe inserts its input as the first application, followed by
any written arguments. Qualified members and grouped functions are ordinary
callees. This is syntax sugar, not a distinct runtime operation.

## Parsing and lowering

Tokenize `->` as one token and retain offsets and token boundaries. Build a
balanced-delimiter index once, with a nesting budget, lazily when the first
canonical declaration is encountered. Legacy-only files do not pay for this index. A possible arrow binder is
then recognized by an identifier followed by `->`, or a matched parenthesized /
record pattern followed by `->`. No speculative parse or repeated scan through a
large binder is needed. Precedence climbing consumes each application iteratively.

Lower tuple values to record nodes. Lower each pattern to a single internal
parameter, a structural constraint, and lexical projections. Generated parameter
names cannot collide with source identifiers. Lower calls to ordinary call nodes
with one argument. Keep vector parameters as a compact internal representation;
function unification and staging must consume them incrementally and support
curried callbacks, stored partial applications, and lexical capture.

Collect a declaration's leading arrow binders for its concrete export convention.
Reject a canonical definition that does not start with an arrow: constants use
`() -> value`. Bound nesting, syntax-node creation, and generated projections.
Malformed arrows, missing arguments, duplicate fields/binders, mismatched tuple
arity, infinite types, and incomplete host calls must carry stable diagnostics.

## Migration

`fn name = ...` selects the canonical grammar for that declaration. The legacy
`fn name(args) = ...`, `=>`, old brace blocks, and parenthesized argument lists
remain accepted **inside legacy declarations** so the existing corpus, ABI
fixtures, and linked libraries remain usable. This is intentional compatibility,
not another recommended syntax for new source. Legacy zero-argument functions
correspond to unit-taking functions when used from the canonical surface.

Do not mechanically replace `f(x,y)` with `f (x,y)`: the latter passes a pair.
Translate it to `f x y`, or explicitly redesign the function to take a tuple.
Translate `fn f(x,y)=...` to `fn f = x -> y -> ...`, `(x,y)=>...` to
`x -> y -> ...`, and a block `{let x=...; result}` to `do {let x=...; result}`.
Preserve intentionally tuple-taking functions as `(x,y) -> ...`.

## Validation

Cover left/right associativity, grouped functions, argument gaps, precedence,
scalar/tuple/record/unit binders, nested patterns, singleton puns, annotations,
polymorphic partials, higher-order builtins, linked legacy libraries, effects,
JTE invariants, and malformed/oversized inputs. Execute representative programs
with default and optional fusion lowering. Retain the existing full Node and
browser suites; add parser microbenchmarks without wall-clock pass thresholds.
See [the executed checks and limitations](SYNTAX-VALIDATION.md).
