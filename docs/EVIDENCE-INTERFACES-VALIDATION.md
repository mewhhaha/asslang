# Principal interface validation

[Theory and API](EVIDENCE-INTERFACES.md) · [Validation index](EVIDENCE.md)

## Revision and source integrity

Based on main `7e2c2e27458933ef4acc6976987d2c4314d364a5`, source tree
`69ce38490ef7e451c9c9ecf8b25d144aad2b1544`. The supplied previous research archive
reconstructed that exact tree, checked against the connected repository. The
unchanged baseline passed all 1,051 Node tests. The theory document, including
an early-elimination design, was committed before implementation and test changes.

This change adds `.abstract` to `createEvidenceAlgebra`, an internal ephemeral
BDD workspace, a runnable example, mathematical/integration tests and browser
registration. It does not change the old source emitter, existing public contract
operations, parser, HM inference, JTE, Wasm emission, ABI, effects, loop accounting,
dependencies or workflow permissions. The root README stays unchanged. New theory
and validation are linked from the docs index and category guide. Historical
validation reports are not rewritten.

## Executed local checks

Validation date: September 11, 2026. Environment: Node v22.16.0, Linux x64,
Chromium 144.0.7559.96. These results are local execution, separate from remote CI.

| Command/check | Result |
| --- | --- |
| Unchanged baseline `npm test` | 1,051 passed; zero failures/skips |
| Final `npm test` | 1,079 passed; zero failures/skips |
| `npm run test:evidence-interfaces` | 28 passed |
| `npm run example:evidence-interface` | Passed; necessary/sufficient gap, exact refinement and current-input guard |
| `npm run example:host` | Passed |
| `npm run example:reducers` | Passed |
| `npm run example:evidence-algebra` | Passed |
| `npm run build:example` | Passed |
| `npm run test:browser` (engine bundle) | 1,298 core + 276 experiment checks passed (138 experiment cases) |
| `npm run test:browser:http` | Attempted; blocked by `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| Syntax checks for changed/new modules; `git diff --check` | Passed |

The new browser tests are registered in both the native HTTP harness and engine
bundle. Only the engine path executed successfully here. No browser policy was
changed or bypassed; HTTP module/worker loading and other browser engines remain
unverified. Throughput benchmarking, proof-assistant checking and independent
mathematical review were not performed.

## Independent mathematical verification

All 20 monotone functions over three private atoms are used as private targets
and as each of two public summaries. This exhausts 8,000 combinations. Direct
quantification over eight private assignments and four public assignments agrees
with both computed bounds: 64,000 bound valuations. The implementation's BDD
transfer and quantifier-elimination code are not used by this truth-table oracle.

Testing each combination against all six two-atom monotone public contracts
checks 96,000 adjunction equivalences. Exact representability is independently
decided by enumerating those six possible contracts: 1,670 combinations are
exact, and the other 6,330 return checked separating pairs. Every pair satisfies
the private target on one assignment, fails it on the other, and has the promised
inclusion of public views. One explicit example requires distinct ordered views,
not equal views, illustrating the monotonicity-specific information loss.

Both adjoint composition laws pass all 7,776 combinations of two-atom interface
maps and targets. The right-adjoint/residual law passes all 1,296 two-atom cases.
Projection examples agree with independent hidden-variable cofactor expectations.
Tests explicitly include unreachable public views, so exactness is not incorrectly
identified with equality of the two public handles. A public atom with private
meaning false demonstrates why a forged public flag is not an admission proof.

A separate test compiles 216 ordinary Asslang programs: all 36 two-summary maps
of two private atoms and six private targets. Across 864 actual Wasm evaluations,
each computed sufficient contract implies the private target, the target implies
the necessary contract, and exact cases agree in both directions. These programs
compute the public summaries from current private Boolean inputs rather than
passing unrelated flags.

These families are exhaustive only within their stated sizes, not across all
vocabularies or arbitrary programs. The general guarantees have written proofs
in the theory document. Neither the tests nor citations establish worldwide
originality, a proof-assistant check, or verified refinement-type inference.

## Runtime integration and semantic boundaries

The worked component requires both leftValid and rightValid. The coarse public
interface exposes their disjunction and the conjunction of both with reviewed.
The strongest necessary contract is the disjunction summary; the weakest
sufficient contract is the reviewed-pair summary. The returned counterexample
explains why this interface cannot express the target exactly. Exposing the
pair-validity predicate gives an exact refinement.

The example computes current private facts from two numeric inputs and an explicit
review Boolean, substitutes the inferred sufficient contract, and requires it
before returning the sum. Tests show all three behaviors: necessary-only admission
can accept an invalid pair, sufficient coarse admission conservatively rejects an
unreviewed valid pair, and the refined interface accepts precisely the target in
this example. No summary flag is an authenticated token or cache permission.

All eight SIMD/fusion/memoization configurations test guarded values against
valid, invalid and conservatively rejected inputs, plus post-trap reuse. The
selected instantiated guard emits byte-identical Wasm to its handwritten
conjunction at zero loop allowance in those modes. This is a specific compatibility
result, not a general runtime or compilation-performance improvement.

Fact predicates using range(3) and range(4) share one invocation budget: seven
units succeeds, six traps, including direct Wasm calls. A smaller call after the
trap receives a fresh allowance. Unused guards remain undemanded; projection of a
required result cannot bypass its guard. Tests preserve source-local diagnostics,
Boolean field typing, host-effect rejection, function ABI rejection, compiler
cache snapshot independence, causal stream restrictions and event-domain separation.

The predicates retain the previous algebra's semantics for pure total facts and
canonical decision order. Any intended connection to data validation, equality,
authentication or local coherence must be established by the caller's actual
mapping. Existing NaN/signed-zero/partial-predicate caveats are not relaxed.

## Symbolic scale, ownership and resource limits

A 96-private-atom conjunction of 48 independent either/or pairs has 2^48 minimal
supports. Mapping one public summary to each pair yields an exact 48-atom public
conjunction with 48 reachable decision nodes. It is obtained under default budgets,
without enumerating the private assignments or supports, and its generated predicate
compiles and executes. Early existential elimination discards private variables
that cannot affect future summary constraints. The separate private session's
retained node count does not change.

A 128-private/128-public-atom reversed-order conjunction also abstracts exactly
under explicitly configured maximum node/work budgets. These structured cases do
not show polynomial worst-case cost or guarantee every bounded input compiles.
The workspace and receiving session have separate caps of the configured node
limit; all copying, symbolic operations, projections, concretizations and witnesses
share the receiving operation's work limit. Output `.source` still uses its old
512-reachable-node limit and all normal compiler/ABI limits.

Tests exhaust work budgets and both workspace and receiving-node capacities.
Failures roll back public allocations, preserve previous handles, and do not
consume capacity in a separate private session. When source and receiver coincide,
the receiving session's normal successful output allocation is allowed. Constants,
empty vocabularies, unused private atoms, repeated meanings, renaming and self-session
substitution are tested. Bindings require every public atom exactly once and values
owned by the private target's session. Forged, missing, mixed-session and sparse
inputs are rejected. Frozen results are detached from mutable binding arrays;
binding properties that change on a second read are captured once. This is not
a sandbox for hostile JavaScript proxies.

An initial resource-test expectation incorrectly allotted three workspace nodes
to a variable and its complement plus two terminals; it was corrected to four.
No production bound was raised. An initial full run detected the new theory as
not yet linked from the docs index; the finished navigation fixes that omission.
The focused and full suites were then rerun successfully. All old source-generator
checks, including prior byte-equivalence tests, remain in the full regression suite.

The new Chromium module contributes 33 assertions across four SIMD/fusion modes,
covering the two adjoints, read-only private state, counterexamples, refinement,
current-data guards, allocation counters, exact allowances and post-trap recovery.
Published source identifiers and remote CI status are recorded separately in the PR.
