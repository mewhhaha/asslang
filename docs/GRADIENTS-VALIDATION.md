# Finite product gradients: executed validation

## Scope and provenance

Executed locally on 2026-09-08 using Node v22.16.0, Linux x86-64, and Chromium
144.0.7559.96 (HeadlessChrome 144.0.0.0). The baseline is main commit
`cb980f88a1b4eeae89363d89c9a050ae2ff7a563`, tree
`40353a9c599e8ac142f710608c157f306959e2c0`.

The baseline source was recovered from that commit's retained GitHub Actions
validation artifact. Its complete local Git tree matched the upstream tree
before any edits. The design in [GRADIENTS.md](GRADIENTS.md) precedes implementation
in the PR history. This report is new evidence, not a rewrite of earlier AD or
benchmark reports.

## Implemented behavior

`grad` and `value_and_grad` infer scalar objectives, preserve numeric argument
product shapes, and share one staged objective graph across unit-basis derivative
walks. The existing JVP uses the same preparation and pushforward implementation;
its derivative rules and atomic performed-result substitution are retained.
Inputs are limited to 1-64 numeric leaves, independently of `maxExpansion`.
No guest representation, ABI layout, optimization default, or dependency changed.
Both new intrinsic names are reserved, as documented in the migration contract.

The fixed Chromium test bundler exposes the shared implementation. Twenty new
engine cases run in Node and Chromium with all three optimization switches off
and all three on. The deeper Node suite independently exercises every one of the
eight SIMD/reduction-fusion/reduction-memoization combinations.

## Executed checks

| Command | Actual result |
| --- | --- |
| Unchanged baseline `npm test` | 496 passed, zero failures or skips |
| Final `npm test` | 546 passed, zero failures or skips |
| `npm run test:gradients` | 78 passed, zero failures or skips |
| `npm run example:host` | Passed; explicit capability exhausted as expected |
| `npm run example:reducers` | Passed |
| `npm run example:case-studies` | All 12 scalar/SIMD executions passed |
| `npm run build:example` | Passed; both example exports compiled |
| `npm run test:browser -- --output /mnt/data/asslang-gradients-browser.json` | PASS: 1,096 core checks plus 60 experimental checks |
| `git diff --check` | Passed |

The 50 new Node tests comprise 30 dedicated tests and 20 shared engine cases.
The browser's 60 experimental checks comprise the 10 existing JVP cases and 20
new gradient cases, each in two modes; thus 40 browser checks are new. The browser
report is retained in [gradients-browser-tests.json](gradients-browser-tests.json).

## Independent numeric and safety evidence

The dedicated polynomial test evaluates 800 seeded inputs across all eight
optimization combinations. It compares objective values and all three gradient
coordinates to hand-derived JavaScript expressions, plus 2,400 central
finite-difference comparisons. Another 400 cases compare Hessian-vector products
to independent analytic expressions. These are numeric correctness tests, not
throughput benchmarks.

Regression coverage includes nested second/third derivatives, JVP/gradient
composition in both directions, aliased record fields, captures, nested records
and tuples (including `_10` versus `_2` ordering), partial intrinsics, polymorphic
helpers, legacy linked functions, finite callable choices, scalar use inside
causal transitions, and empty-stream demand.

Primal contracts remain demanded for constant gradients and ignored coordinates.
Inactive branches, unused bindings, and unused input fields remain lazy. Tests
cover independent memory loads and their bounds checks, active-address rejection,
stop-gradient, declared nonsmooth conventions, source-local structured errors,
compiler-session snapshot isolation, the 64/65-leaf boundary, and low expansion
budgets. Exceptional f64 results are compared to explicit unit-basis JVPs using
`Object.is`, including NaNs and signed zeros; this is compatibility evidence
rather than an independent real-arithmetic derivative oracle.

Twenty-four new effect executions (three programs in eight configurations) use
one-call capabilities. Each returns its analytic result, invokes the host exactly
once, and consumes exactly one allowance, including captured performed values,
multiple gradient coordinates, nested differentiation, and stop-gradient.

The quadratic update shown in the feature document is extracted and compiled by
the test suite, checked against an independent expected result in all eight
configurations, and checked for rejection of a negative step size. No `.ass`
example was added, and the independent corpus reference evaluator was not
weakened or made dependent on compiler output.

## Limitations

These results are local validation, not a claim that the PR's remote CI passed.
GitHub Actions status must be inspected separately for the published commit.
HTTP module loading and playground worker loading were not exercised. Other
browser engines and throughput benchmarks were not run.

This remains bounded forward-mode AD, not reverse-mode gradients or full
Jacobians. Differentiating stream/reduction/causal-machine graphs or active memory
addresses remains unsupported. Pathwise f64 rules do not guarantee numerical
stability or differentiability at discontinuities; in particular, a zero basis
coefficient does not algebraically eliminate NaNs or infinities.
