# All expression operators are source-defined

## Design recorded before implementation

Base: main `7583876ae99b48917fffde9a21924df05cec393e`, tree
`a3ca1637f36681304863543a75ffb2292fc9cc99`. Integrate the previously prepared
lexical-operator patch, then remove its exclusions for Boolean connectives,
pipelines and unary operators. Publish a real PR through the GitHub connector.

## Scope and semantics

Every existing **expression operator** has a definition in `lib/expression-operators.ass`:
`+ - * / == != < <= > >= && || |>`, unary `-` and unary `!`. Local infix bindings
and prefix bindings may replace them with ordinary source functions. Application,
field selection, arrows, binding punctuation and type annotations remain syntax;
this does not claim that the parser or floating-point instructions are source code.

The compiler must retain irreducible scalar instructions with exact f64 behavior.
Supply them as a hygienic, compiler-internal record of ordinary core-AST function
values to the source factories. Numeric operator factories select the appropriate
scalar function. Boolean conjunction/disjunction/negation use typed source
conditionals; pipe application uses `f value`. Do not define arithmetic circularly
in terms of the operator being defined, add global type-directed instance search,
or expose host authority through this bootstrap record.

Parse the shipped file with the same parser as user source. Package only its text
in a checked generated module, not hand-maintained duplicate ASTs. Each use lowers
to ordinary applications of a lexically bound function. Load only the default
operators used by a definition, with fresh hidden names. Inject those bindings at
the enclosing definition, including before an exported effect block's statements.
User rebindings do not alter already constructed functions or prelude definitions.
No global mutable operator/scheme cache may leak across compilations.

Default library bindings are part of expression elaboration, including core-only
compilation; `prelude:false` still disables the four derived prelude names, not
basic expression notation. The separate scalar AST instructions remain the real
core. Explicit source factories are reusable with source-supplied dictionaries.

## Grammar and ergonomic constraints

`infixl`, `infixr`, and `infix` retain lexical relative precedence from the prepared
patch. Built-in symbols retain their original precedence and associativity when
rebound, but are no longer protected by operator meaning. `prefix (-) = negate;`
and `prefix (!) = invert;` bind unary functions at the fixed unary precedence.
A binary `(-)` value stays subtraction; `(prefix (-))` captures negation, and
`(!)` captures the current unary not. Prefix and binary meanings are independent.
Custom prefix symbols use the bounded existing symbolic token vocabulary.

Keep the data-first pipe grammar: `x |> f a` is `(pipe x f) a`, while
`x |> (f a)` is `pipe x (f a)`. The parsing convention is not the pipe's source
implementation. Rebinding `|>` is explicit and keeps the same placement rule;
`(|>)` is a first-class staged function. Other infix operands follow the existing
precedence graph. No automatic reassociation or unspecified ordering is allowed.

The declaration initializer sees the preceding binding. Inner scopes restore
both prefix and infix environments. Hidden default names cannot capture source
names, and generated nodes count toward the existing 50,000-node limit. Retain
256 declaration, 64 active-binding, and nesting bounds. Malformed definitions
and incorrect operator arities must fail even when unused. Host `perform` must
still directly name a declared capability operation.

## Demand and correctness obligations

An operator application is a curried source call, not a macro. Operands remain
type-checked/staged; runtime demand follows the chosen source function. The
standard `&&` and `||` preserve short-circuit demand through `if`, but a deliberate
rebinding may choose other semantics. Tests must compare failure and effect
behavior, not only total values. Unary negation must preserve signed zeros,
nonfinite numeric values, and derivative behavior without rewriting to `0-x`.

Substitution and ordinary let instantiation establish local scope/polymorphism.
A finite source factory applied to the scalar bootstrap elaborates by the existing
stager to its scalar nodes; source aliases must not need a new JTE/AD/Wasm case.
Source Boolean conditionals may yield different graph/byte structure than the
previous dedicated connectives. Record that compatibility/cost change rather
than assert universal byte identity. Front-end work and tiny expansion limits
can change; no default resource allowance will be raised.

## Validation plan

Run the prepared lexical tests, new all-operator tests, full Node suite, docs,
required example runners and available Chromium. Check all 15 default forms,
first-class captures, arithmetic/Bool/pipe/prefix rebinding, nested restoration,
legacy behavior, higher-order typing, effects, short-circuit and invalid operands,
f64 boundaries and derivatives. Compare the existing corpus with actual main
for values, ABI and certificates and measure byte differences honestly. Execute
source-level examples and compare renamed factories/direct code. Recheck main
before publishing, create theory-first commits, verify the published tree, open
one PR without modifying main, and report fresh remote CI separately.

## Initial integration findings

The repository already uses `lib/operators.ass` for matrix-free linear operators.
Preserve that library unchanged; the new file is `lib/expression-operators.ass`.
Source-backed defaults must not repeatedly rebuild their closed scalar dictionaries
when a generated helper is called thousands of times. Cache only parser-issued,
closed factory bindings inside one staging invocation, never caller operands or
runtime results. Validate that factories contain no free source identifiers and
no circular default-operator syntax. Existing maximum-graph tests must pass under
the original expansion allowance; no resource limit is raised to mask overhead.

The maximum-equation fixture still exposed repeated staging of identical scalar
operator applications. Memoize fully applied, parameter-only scalar lambda bodies
(numbers/Booleans, unary/binary nodes and conditionals) by AST identity and exact
scalar argument IDs. These bodies introduce no event domains, effects, reductions,
or other fresh state. The scalar graph constructor already hash-conses their
results, so this avoids redundant construction without changing graph identity.
Reject every call, projection, block, free capture or non-scalar argument from
this cache. In particular, never cache a pipe application that constructs a scan.
Cache entries are compilation-local and bounded by the unchanged expansion cap.
