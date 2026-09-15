# Lexical source operators: executed validation

This is the historical prepared-package report for tree
`ec786f5d912e12dae705c341d6965320466ef2dc`, not validation of the broader combined
implementation. See [fresh all-operator validation](ALL-SOURCE-OPERATORS-VALIDATION.md).

[Design and examples](LEXICAL-OPERATORS.md) · [Validation index](EVIDENCE.md)

## Revision and scope

Based on merged main `7583876ae99b48917fffde9a21924df05cec393e`, tree
`a3ca1637f36681304863543a75ffb2292fc9cc99`. The supplied source archive reproduces
that exact tree. The unmodified baseline passed all 1,686 Node tests. A design-only
commit precedes implementation. Publication status is recorded outside this report.

This is implemented parser support for lexical infix bindings, relative fixity,
first-class operator references and opt-in local arithmetic rebinding. It is not
an extension of the matrix-free-operator protocol from the earlier source library.
The new `src/infix.mjs` handles bounded syntax metadata. `src/frontend.mjs` changes
only tokenization; `src/unary.mjs` lowers the surface to existing AST nodes.
Inference, staging, differentiation, Wasm emission, ABI, runtime adapters, effects,
primitive registry and resource defaults are unchanged. The core still has 30
callable primitives and four source-prelude names. The root README is unchanged.

## Completed local runs

September 14, 2026; Node v22.16.0, Linux x64, Chromium 144.0.7559.96.
These are local runs, not a remote CI result or a proof-assistant check.

| Command or comparison | Result |
| --- | --- |
| Unmodified baseline `npm test` | 1,686 passed, no failures/skips |
| Final `npm test` | 1,729 passed, no failures/skips |
| `npm run test:lexical-operators` | 37 passed |
| `npm run test:docs` | 26 passed |
| `npm run test:browser` | 2,346 core + 276 experiment checks passed |
| Actual old-corpus compatibility | 122 token streams and ASTs; 976 binaries, ABI objects and certificates identical |
| New examples versus explicit forms in the actual old compiler | 24 byte/ABI/certificate-identical builds |
| `audit:core`, `check:prelude` | Passed |
| Required host/reducer, case-study and new operator examples | Passed |
| Example build, changed-JS syntax and `git diff --check` | Passed |
| `npm run test:browser:http` | Attempted; `net::ERR_BLOCKED_BY_ADMINISTRATOR` |

Both browser harnesses register the new module. The engine bundle completed;
HTTP module/worker loading was policy-blocked and was not bypassed. There are
33 dedicated browser assertions and twelve additional checks through the three
new corpus entries. Existing 138 experiment cases remain. No other browser engine,
human readability experiment or wall-clock performance claim is implied.

## What is tested independently

Fourteen shared examples run through all eight SIMD/fusion/memoization modes in
Node, using fixed expected outputs and the reference evaluator. The evaluator
shares the parser; it is therefore not independent evidence of new parsing rules.
For that, a separate test enumerates binary parenthesizations for 243 five-value
operator chains under a partial order and three associativity policies. It uses
neither the production precedence graph nor the Pratt parser. Exactly 34 programs
have a unique admissible tree and execute with its expected value; the remaining
209 reject with E_FIXITY. Symbol renaming produces identical bytes and certificates.

Tests cover left/right/non-associative parsing, transitive above/below relations,
equal groups, contradictory cycles, unrelated groups, explicit parentheses and
numeric precedence interactions. A lower-precedence operator can separate two
unrelated higher-precedence operators without requiring a false comparison.
Contextual declaration words remain usable as ordinary identifiers. Native binary
fixities cannot be changed; pipeline, Boolean-short-circuit syntax, arrows and
assignment cannot be rebound.

The full old-corpus comparison imports the ACTUAL baseline compiler alongside
the new one. All 122 old sources retain exact token objects/offsets and ASTs, plus
976 exact emitted modules, ABI objects and JTE certificates. The three new task
examples are also expanded into old-style named calls and compiled using that
actual baseline; all 24 module comparisons agree. These are finite compatibility
checks, not an all-program equivalence theorem or a promise of unchanged errors
for every previously invalid punctuation string.

## Source algebra and guest costs

All three documented tasks match their explicit named-call forms in every tested
lowering configuration. The native execution is not a host operator callback.
Measured values below use default fusion and the stated invocation allowance:

| Task | Result | Loop sites / units | Array bytes | Descriptor bytes | Wasm bytes |
| --- | --- | --- | ---: | ---: | ---: |
| Polynomial at x=2, coefficients [2,3,5] | value 19, derivative 11 | 1 / 3 | 0 | 16 | 1,364 |
| Smoother into total/peak observers | totals [0,4,10,13], peaks [0,4,6,6] | 1 / 4 | 64 | 32 | 2,147 |
| Rejoined section correction scan | [1,3,9,17] | 1 / 4 | 32 | 8 | 1,316 |

Each has zero intermediate data buffers. One fewer loop unit traps; one fewer
output byte traps for the array results. Ordinary inputs, result descriptors,
other locals and host copies are additional memory. The polynomial example uses
ordinary scalar and dual dictionaries, not a newly supported AD-over-fold operation.
Several coefficient shapes and evaluation points agree with an independent
coefficient/power derivative formula on exactly representable small values.
Source algebra laws, finite-value policies and numerical accuracy remain caller
responsibilities. Operator notation adds no such proofs automatically.

The front-end cost is real. Compared with explicit named forms, the polynomial
has 120 rather than 116 syntax nodes, 196 rather than 176 inference constraints,
and 173 rather than 159 staging steps. The machine example has 510 versus 502
syntax nodes, 611 versus 595 constraints, and 258 versus 248 staging steps. The
section example has 64 versus 60 nodes, 124 versus 116 constraints, and 83 versus
78 staging steps. Wasm bytes are identical, not faster by assertion. These counts
include the explicitly linked source libraries and do not measure parsing time.

## Scope, types, demand and authority

An AST traversal checks that an operator factory initializer occurs exactly once.
Only existing definition/lambda/call/name/number/binary/block/record nodes occur
in that test. Operators are ordinary generalized function bindings, including
first-class values, partial applications and functions returning another function.
Free monomorphic captures remain monomorphic; unused non-callable operators and
infinite types still fail. Source dictionaries can specialize the same arithmetic
body to scalar or record shapes without a global type-class/instance mechanism.
A source conditional can select a function and lower to ordinary branches; the
claim is no runtime function object or operator dispatch table, not no branching.

Inner shadowing never changes a previously constructed function or an escaped
operator value. Initializers see the preceding binding, not themselves. A named
function defined outside local arithmetic rebinding still uses its original
numeric operations. Library notation does not enter another linked function's
scope. A linked-source test with an existing unit binder emits identical bytes
in either order. Operator-generated names use a separate supply so they do not
renumber the old parser's generated pattern parameters.

A source-defined fallback uses ordinary conditional demand: an unused trapping
second operand is not run. Ill-typed or unsupported source still gets checked;
an operator is not a macro that can erase syntax before inference. Capturing a
host declaration as an operator or invoking an operator alias with `perform` fails.
Previously performed scalar results can be captured, with direct host calls still
executing once in order under their capability. Unsupported loop-containing
operator objectives remain unsupported for AD. Supported numerical operator
objectives match explicitly named derivative programs byte for byte.

The concat alias retains cut-cover alignment. An aligned zip needs no new dynamic
check; reversing the pieces still fails E_DOMAIN. A stopping consumer keeps its
prefix behavior. Cached artifacts retain copy isolation, prepared calls preserve
snapshotted inputs, and leases expire normally. No JTE claim is manufactured by
an operator declaration or by a Boolean supplied as its implementation.

## Bounds and development findings

Tests accept 64 active bindings and reject a 65th, reject a 257th declaration,
accept a 16-character name and reject 17, and report controlled E_LIMIT for a long
right-associated expression or tiny existing expansion allowance. Precedence
relations are capped at 64 per declaration. There is no raised syntax, nesting,
source-size, staging or guest-work default.

The first broad test run caught an unintended change to the existing lexical
error for `@`. It remains reserved; no existing test was changed to accept that
regression. A later lexical review caught comment swallowing by maximal runs:
`x+// comment` followed by the next operand must stay valid. Runs now stop before
`//`, and regressions cover native/custom punctuation and arrows without spaces.

One new test initially used a locally overridden `+` in the initializer of a
subtraction alias while expecting original addition. The fixture now deliberately
uses its captured original `add`; the implementation retains the preceding-
environment rule. Another test exposed generated-name interference with a linked
unit binder. A separate notation-name supply repairs that issue, and the test
retains the unit binder and exact link-order byte comparison rather than weakening
it to values only. Missing early test-module exports were fixed before validation.

Operator syntax and relative precedence have substantial prior art. This is a
scoped source-language integration, not a novel minimal core, arbitrary macro
system, implicit overload inference, formal compiler proof or universal ergonomic
claim. Custom prefix/postfix forms, operator sections, Unicode spellings, global
notation exports and automatic algorithm reassociation are intentionally absent.
