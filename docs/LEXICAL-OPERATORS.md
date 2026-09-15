# Local notation, source-defined meaning

**Scope update:** [all source expression operators](ALL-SOURCE-OPERATORS.md) extends
this original lexical design. Boolean connectives, pipes and unary operators are
now source-backed and rebindable. The exclusions below document the original
proposal and are superseded by that contract; the examples and relative-infix
rules remain valid.

[Syntax](SYNTAX.md) · [Core boundary](CORE-AND-PRELUDE.md) · [Documentation](README.md)

## Use local notation in real programs

```sh
npm run example:lexical-operators
npm run test:lexical-operators
printf '[[2,3,5],2]' | node examples/case-studies/app.mjs notation-polynomial
```

The polynomial example uses the SAME Horner source body with two arithmetic
records. One is scalar arithmetic; one is dual-number arithmetic returning a value
and derivative. The algorithm binds `+` and `*` to that record locally. There is
no global type-class lookup or dynamic dispatch. Coefficients [2,3,5] and x=2 give
value 19 and derivative 11. The derivative is computed by the source dual algebra,
not a new compiler differentiation rule for folds. No finite-value policy or
arbitrary numerical-accuracy guarantee is added by notation.

See [the generic algorithm and arithmetic definitions](../lib/polynomials.ass).
Its core is simply:

```ass
fn polynomial_with = algebra -> coefficients -> x -> do {
  infixl (+) = algebra.add;
  infixl (*) = algebra.multiply;
  coefficients |> fold algebra.zero
    (total -> coefficient -> total*x + algebra.constant coefficient)
};
```

### A shared pipeline, not duplicated stages

This complete kernel explicitly binds serial and product composition. Product
binds more tightly, so the smoother is shared by the total and peak observers.
The libraries are linked explicitly by the registered example driver.

<!-- notation-example: machine_report -->
```ass
fn notation_smooth = alpha -> {
  initial:0,
  step:state -> value -> state+alpha*(value-state),
  finish:state -> state,
};
fn notation_peak = () -> {
  initial:0,
  step:state -> value -> max state (abs value),
  finish:state -> state,
};

// Composition is sequential; product is tighter and shares the smoothing stage.
export fn notation_report = (samples:[Num]) -> (alpha:Num) -> do {
  infixl (>>>) below (+) = machine_then;
  infixl (***) above (>>>) below (+) = reducer_product;
  let machine =
    notation_smooth alpha
    >>> sum_reducer () *** notation_peak ();
  let history = samples |> machine_states machine;
  {
    totals: history |> map (state -> (machine.finish state).left),
    peaks: history |> map (state -> (machine.finish state).right),
    summary: machine.finish (history |> fold machine.initial (previous -> next -> next)),
  }
};
```

For samples [0,8,8,0] and alpha 0.5 the totals are [0,4,10,13], peaks are
[0,4,6,6], and summary is {left:13,right:6}. The source declarations affect only
this block, not the implementation of either imported library.

### Joining retains the existing structural proof

<!-- notation-example: section_scan -->
```ass
// The source alias preserves concat's checked cover and the following zip.
export fn section_scan = (samples:[Num]) -> (cut:Num) -> do {
  infixl (<>) like (+) = concat;
  let {left,right} = samples |> split_at cut;
  let adjusted =
    (left |> map (x -> 2*x))
    <> (right |> map (x -> 3*x));
  zip samples adjusted (original -> changed -> changed-original)
  |> scan 0 (total -> difference -> total+difference)
};
```

For [1,2,3,4] and cut 2 the result is [1,3,9,17]. Parentheses around each pipe
make the join's operands explicit. This is not a reinterpretation of pipeline
insertion order. The source alias preserves concat's cover evidence, so the zip
retains its original alignment without a new runtime length check.

All three programs are compared with explicit named-call forms in eight lowering
configurations. No compilation-time or user-readability gain is inferred merely
from reducing punctuation. [Validation](LEXICAL-OPERATORS-VALIDATION.md) records
actual results, front-end overhead and limits.

## Design before implementation

Base: merged main `7583876ae99b48917fffde9a21924df05cec393e`, tree
`a3ca1637f36681304863543a75ffb2292fc9cc99`. Its 1,686 Node tests pass unchanged.
The existing `lib/operators.ass` defines matrix-free mathematical operators, not
user-defined infix syntax. This change gives ordinary binary source functions
local notation without adding a semantic primitive or a global overload registry.

A good operator system must compose libraries without letting one silently change
another's grammar. It must preserve scopes and demand, describe grouping rather
than guess it, and stage the same operations as explicitly named calls.

## Surface and scope

Inside canonical `do` and exported `effect` blocks, bind an infix operator:

```text
infixl (>>>) below (+) = machine_then;
infixl (***) above (>>>) below (+) = reducer_product;
infixl (<+>) like (+) = vector.add;
infixr (<|>) like (||) = left -> right -> if left.valid then left else right;
infix (<~>) like (<) = left -> right -> abs (left-right) < tolerance;
```

`infixl`, `infixr` and `infix` declare left, right and non-associative *parsing*.
They are contextual declaration words, not globally reserved identifiers. A
binding's right-hand side uses the preceding environment; the new operator is
available only after the semicolon. It can capture a dictionary, a parameter,
a previously bound function, or an operator value. Operators in inner blocks can
shadow outer ones. Duplicate symbols in a single block are rejected.

Every declaration binds one fresh internal ordinary function value. Infix use
`a <+> b` means the curried application `add a b` of that captured binding, NOT
`add (a,b)`. `( <+> )` retrieves the function. `( <+> ) first` is ordinary leading-
argument partial application, and the function can be stored in a record, passed
to a helper, or returned to another staging scope. Its meaning stays captured
when another scope reuses the same spelling. No runtime function ABI is added.

Libraries expose named functions or dictionaries, not operator declarations.
Callers explicitly choose notation in local scope. Top-level fixities, implicit
operator imports, macro expansion, type-directed instance search and dynamic
operator dispatch are deliberately absent. File linking still uses its existing
named-function namespace; file order does not establish an operator environment.

The ordinary binary arithmetic/comparison operators may be rebound locally:

```text
infixl (+) = vector.add;
infixl (*) = vector.multiply;
```

These inherit their fixed existing precedence and left associativity. Their
fixity cannot be changed. Existing compiled/library functions are not dynamically
reinterpreted under the caller's notation. Unary `-x` remains numeric negation;
rebinding binary subtraction does not create a unary overload. `&&`, `||`, `|>`,
arrows, assignment and delimiters remain protected syntax. The original numeric
binary functions can be captured with `(+)`, `(*)`, etc. before shadowing.

No sections or placeholder grammar are added: write `(op) argument` for leading
partial application, and a grouped lambda for the other argument. `f (x)` remains
application; `f(x)` remains invalid in canonical source. A tuple is still one
argument. There is no automatic associativity rewrite of a function's semantics.

## Precedence as a bounded partial order

`like (op)` joins an existing precedence group. Alternatively, `above (op)` and
`below (op)` add strict edges to a new group; several relations may be combined.
Anchors must already be visible. All custom infix groups are above `|>` and below
unary/application/field selection. With no explicit relation, these two bounds
are the only defaults. Parentheses always delimit a subexpression.

This is a transitive acyclic partial order, not a numeric rank or a nontransitive
pairwise policy. If adjacent competing operators have no known ordering, reject
with E_FIXITY and ask for parentheses or a relation. Operators of equal precedence
must agree on left/right associativity; a non-associative operator cannot form
an unparenthesized equal-precedence chain. Legacy builtins keep their historical
fixities, including comparison chains which may subsequently fail type checking.
Contradictory edges are errors at the declaration, even when unused.

Relations are lexical and immutable once parsed. A new group may add explicit
local relationships; it cannot rewrite an already parsed expression. A `like`
alias shares a group by identity, not by looking up a symbol again later. Nested
changes are discarded on leaving the block. There is no whole-program fixity
prepass or declaration-order dependence across separately linked functions.

Pipelines keep their existing special rule: `x |> f a` is `f x a`, not `(f a) x`.
The stage callee and arguments are atoms; grouped functions can be used explicitly.
A new ordinary operator cannot redefine that syntax. Callback arguments remain
grouped. Vertical rearrangement, comments and CRLF do not alter grouping.

## Lexical stability

New symbolic names use the ASCII alphabet `~^%?&|<>=+*/`, at most 16 characters.
A one-character new name must use a previously unsupported character. Multi-
character names use maximal runs of this alphabet, excluding reserved builtins,
`=>`, and runs containing `//`. Minus and exclamation are intentionally NOT in
new names: old valid strings `x*-y`, `x--y`, `x<=-y` and `true&&!!false` must not
turn into new operator tokens. Comments still win over `//`; no Unicode
confusables, whitespace-sensitive fixity or declaration-dependent lexer is added.

Top-level and legacy source do not gain infix declarations. Previously valid
programs must retain token offsets, ASTs and emitted behavior. New tokens in an
otherwise invalid old program may improve or change its parse diagnostic; that
is not a compatibility promise for invalid syntax.

## Lowering, types and demand

A declaration elaborates to an ordinary hidden `let`. An annotated identity
checks its function shape `a -> b -> c`, including for unused declarations,
without enclosing the continuation in a lambda. Ordinary let generalization is
therefore retained; free variables of the existing environment stay monomorphic.
The initializer appears exactly once in the AST and is outside the new binding's
scope. Each use elaborates to two ordinary unary call nodes. Operator references
select the captured internal binding. Builtin references use ordinary lambdas and
the existing scalar binary node. No new inference, JTE, AD, ABI or emitter case
is required. All generated nodes count against existing limits.

Substitution proves value equivalence with the corresponding named source
program. Fresh names cannot capture source identifiers, and lexical binding
prevents a later notation change from changing a previously constructed closure.
Structural induction on the precedence-directed parse establishes the explicit
parenthesization; partial-order ambiguity is rejected rather than guessed.

Pure source functions retain demand-driven graph semantics. A lazy fallback can
be defined with an `if` in source; an operator does not evaluate both operands
just because it is infix. Likewise it is not a macro: both operands are still
parsed, inferred and staged, so an unused ill-typed/unsupported operand is not
hidden. Capturing a direct host function as an operator is rejected, and using an
operator alias with `perform` cannot masquerade as a declared host. Existing
performed bindings remain forced in order. Stream alignment, block-reset clocks,
early stopping, guards and all guest work/storage policies stay unchanged.

## Resource and compatibility contract

Bound names to 16 characters, at most 64 simultaneously active operator bindings
and 256 declarations per compilation. Precedence closure uses a bounded bitset
relation over those groups and fixed builtin groups; detect cycles before parsing
use sites. Keep parser nesting 256, syntax nodes 50,000 and source size 1,000,000.
Long right-associative syntax is bounded, not unlimited recursion. No compiler
option or budget is raised. Compilation does more work for declarations; equal
emitted programs do not imply zero front-end cost or wall-clock speedups.

## Validation plan

Run the unchanged baseline first. Compare actual old corpus tokens, ASTs, Wasm,
ABI and certificates in all eight modes. Check explicit named expansions and
alpha-renamed operators. Exercise lexical captures, dictionary parameters,
function-valued operators, let-polymorphism, monomorphic captures, nested shadowing,
nonrecursive initializers, builtin rebinding, protected punctuation, and imports
in different orders. Test all relative precedence directions, cycles, transitive
relations, incomparability, mixed associativity, explicit parentheses, comments,
CRLF and long vertical chains against an independent parenthesization oracle.

Use real source machine pipelines, array split/map/rejoin/scan composition and
numeric-product arithmetic/AD. Check exact Wasm loop/output bounds and no added
intermediate storage. Add negative type, effect, source-location and bound tests.
Register complete `.ass` examples, execute documentation, run full/focused Node,
core/prelude audits, required host/reducer examples and Chromium where available.
Record actual results separately and preserve historical reports and the README.

## Prior art and claim boundary

Haskell has local fixity declarations and first-class operator functions; Swift
supports relative precedence groups and rejects unrelated unparenthesized uses.
Rhombus demonstrates lexical operator bindings and relational precedence, but
its nontransitive relation is deliberately different from the partial order here.
These sources were checked September 14, 2026:

- https://www.haskell.org/onlinereport/decls.html#fixity
- https://docs.swift.org/swift-book/documentation/the-swift-programming-language/declarations/
- https://docs.racket-lang.org/enforest/Operator_Precedence_and_Associativity.html
- https://docs.racket-lang.org/rhombus-meta-tutorial/enforest.html

This combines established language ideas with Asslang's source/core boundary.
It is not a claim of worldwide novelty, arbitrary macros, implicit type classes,
formal proof-assistant verification or an empirical readability study.

The initial lexer probe also accepted `@`, changing an existing lexical diagnostic.
Keep `@` reserved; removing it from the proposed alphabet preserves those checks
without changing any existing tests. The selected alphabet still supports `>>>`,
`***`, `<+>`, `<>`, `%%`, and `<?>`.

A compatibility review found another lexical boundary to preserve: a comment may
start immediately after punctuation (`x+// comment` followed by the next operand).
Maximal operator runs must stop BEFORE `//`, not swallow a comment marker inside
an invalid larger operator. Both native and new operator/comment boundaries are
covered explicitly; no whitespace requirement is added there.

Notation-generated names use a separate fresh-name supply from existing pattern
binders. Otherwise adding local notation to a helper could renumber a later
export's compiler-generated parameter name in ABI metadata. Source hygiene alone
would not catch that avoidable interference. The linked-source regression uses
an existing unit binder and compares both source orders byte for byte. This does
not promise file-order-identical metadata for all existing pattern-heavy programs.
