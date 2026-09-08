# Reusable reverse pullbacks: executed validation

## Scope and provenance

Executed locally on 2026-09-08 using Node v22.16.0, Linux x86-64, and Chromium
144.0.7559.96 (HeadlessChrome 144.0.0.0). The baseline is merged main commit
`9296f45c9a95a96c2f714ff168b554e125b89874`, after PR #11, with tree
`63398f894e25313a227f6378cbec72f1e3e00d9c`.

The source snapshot was recovered from that commit's retained GitHub Actions
validation artifact. Its complete local Git tree matched the upstream tree before
edits. [PULLBACK.md](PULLBACK.md) and its index entry were committed before
implementation and tests. Earlier validation and benchmark reports are unchanged.

## Implemented behavior

`pullback f point` returns a numeric primal value and a compiler-only unary
pullback. Objective staging and numeric validation happen during preparation.
The first staged application validates and caches the reverse graph's order and
root-reachability facts. Each application supplies fresh output weights and owns
its adjoint map. Later applications reuse analysis but still perform a reverse
sweep; there is no cached symbolic-weight derivative graph or runtime tape.

The existing VJP uses the extracted analysis/accumulation functions and retains
eager reverse validation. New value-only pullback uses do not run that analysis;
unsupported derivative errors are attached to the first application site.
The ordinary `linearized_callable` already supports this unary operation, so no
new staging kind or JTE invocation rule was needed. Selection, guarding, helpers,
and mixed forward/reverse callables use the existing dispatch.

`pullback` is now a reserved intrinsic name. No new dependency, grammar, ASABI
layout, guest allocation mechanism, backend instruction, or optimization default
was added. Numeric derivative rules, activity gates, primal demand, and atomic
performed-result boundaries reuse the existing reverse implementation.

## Executed checks

| Command | Actual result |
| --- | --- |
| Unchanged baseline `npm test` | 673 passed, zero failures or skips |
| Refactored existing `node --test test/vjp.test.mjs` | 45 passed |
| Final `npm test` | 736 passed, zero failures or skips |
| `npm run test:pullback` | 268 passed, zero failures or skips |
| `npm run example:host` | Passed; one-call capability exhausted as expected |
| `npm run example:reducers` | Passed |
| `npm run example:case-studies` | All 12 scalar/SIMD executions passed |
| `npm run build:example` | Passed |
| `npm run test:browser -- --output /mnt/data/asslang-pullback-browser.json` | PASS: 1,096 core plus 196 experimental checks |
| `git diff --check` | Passed |

This adds 63 Node tests: 39 dedicated pullback tests and 24 shared engine cases.
The shared cases run in Node and Chromium with all three optimization switches
off and all three on, adding 48 Chromium checks. The deeper Node tests exercise
all eight SIMD/reduction-fusion/reduction-memoization combinations. The retained
browser report is [pullback-browser-tests.json](pullback-browser-tests.json).

## Independent numerical and reuse evidence

The polynomial test checks 800 seeded input points, each with two independent
weight sets over a three-input/two-output response. Both cotangents are compared
to hand-derived JavaScript and central finite differences: 4,800 scalar
finite-difference comparisons. Reapplying the first weight set checks that a
second application cannot contaminate its result.

Another 640 points compare reverse-over-forward and forward-over-reverse
Hessian-vector products with analytic formulas, for 1,280 vectors. Reused
pullbacks also match analytic branch-dependent derivatives in 480 executions.
The tests are correctness evidence, not throughput benchmarks.

An observation-ledger witness checks one objective preparation for three saved
applications versus three preparations for separate VJPs. Both return the same
analytic result. A separate staging-API double observes reads of an independent
terminal: none before application, reads during first reverse analysis, and no
new analysis reads on later applications. This isolates plan reuse from runtime
numeric equality. The real compiler execution tests independently cover fresh
adjoints, nested differentiation before later ordinary applications, and removal
of temporary perturbation tags before emission.

A local compatibility probe compared all 74 pre-existing shared AD cases in two
modes against an untouched baseline extraction. It found 116 byte-identical Wasm
binaries and identical certificates, plus 32 matching rejection codes and source
offsets. This is evidence for that existing corpus, not proof that every possible
program or resource-limit failure is unchanged.

## Demand, authority, and integration coverage

Tests cover nested/empty products, aliased coordinates, tuple indices beyond nine,
partial applications, polymorphic helpers, returned callables, complete record
choices, guarded pullbacks, mixed pushforward/pullback selection, legacy units,
weight sensitivity, nested traversals, stream callbacks, and causal captures.

Demand regressions check all-output primal guards at zero weights, unused input
fields and structurally irrelevant weights, independent value projections,
inactive guards and singular coefficients, wholly unused applications, and empty
streams. Value-only reduction objectives are accepted through the new API, while
applied derivatives and existing VJP value-only uses still reject unsupported
reverse graphs. Source-local tests cover type/shape errors, active memory
addressing, reserved names, ABI escapes, and forbidden implicit host calls.

Exceptional-f64 comparisons use `Object.is` against explicit VJPs, including
repeated applications, NaNs, infinities, and signed zero. Independent expectations
also check identity with a negative-zero weight, a singular active zero weight,
abs at zero, and left-biased max ties. Compatibility with VJP is not an independent
real-arithmetic derivative oracle or a numerical-stability guarantee.

Twenty-four new effect executions (three programs across eight configurations)
each invoke the host exactly once and consume exactly one capability allowance.
They cover reuse, nested differentiation, product weights, and stopped captures.
The new API still uses compiler-only callables; escaping them is rejected.
Pure numeric fixtures have no imported functions/tables and zero reported guest
allocation sites or intermediate-buffer bytes.

Resource tests cover 65-leaf inputs in every configuration, low graph budgets,
and repeated identical applications whose generated nodes intern but still
consume staging work. Compiler-session snapshots remain isolated. The feature
document's example is extracted and executed in all eight configurations. No
`.ass` corpus file or independent reference-evaluator behavior was changed.

## Limitations

These are local results, not a claim that this PR's remote GitHub Actions passed.
Remote checks must be inspected separately for the published commit. HTTP module
loading, playground worker loading, other browser engines, and throughput
benchmarks were not exercised.

Preparation/analysis reuse is a compiler property, not an exactly-once runtime
evaluation guarantee. This remains finite scalar/product reverse-mode AD, not a
full Jacobian API, escaping closure, runtime tape, or differentiation through
stream/reduction/causal graphs. All existing reverse f64 qualifications apply.
