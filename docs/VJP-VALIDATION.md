# Reverse-mode VJP: executed validation

## Scope and provenance

Executed locally on 2026-09-08 with Node v22.16.0, Linux x86-64, and Chromium
144.0.7559.96 (HeadlessChrome 144.0.0.0). The baseline is main commit
`fada114a239d84d59e971eb4a85911f36f301956`, after PR #10, with tree
`de9143b0c6763ed6d1b9092e1b0da92a5fc8ceb2`.

The source was recovered from that commit's retained GitHub Actions validation
artifact. Its complete local Git tree matched the upstream tree before edits.
The design in [VJP.md](VJP.md) precedes implementation in the PR history and was
refined after the wide-input experiment described below. Earlier differential,
gradient, linearization, and benchmark reports are unchanged historical evidence.

## Implemented behavior

`vjp f point weights` returns `{value, cotangent}` for finite numeric products.
It prepares the tagged objective once, validates its derivative graph, and
accumulates adjoints in one reverse topological sweep. This is reverse-mode AD,
not repeated forward coordinate derivatives. The shared preparation extraction
does not change JVP, `grad`, or saved forward-pushforward rules.

Reverse edges have explicit activity conditions. The entire local coefficient
expression is gated, so an inactive branch cannot introduce a guard failure or
singular coefficient into another branch. Every demanded input cotangent retains
all numeric primal-output demand, even at zero weights. Value fields remain
independently demandable and do not require evaluating weights at runtime.
Captures, independent input perturbations, and atomic performed results retain
the existing staging boundaries.

`vjp` becomes a reserved intrinsic name. There is no new dependency, grammar,
JTE rule, Wasm instruction, guest tape/closure/array, ASABI layout, or optimization
default. The existing input-coordinate cap on `grad` is unchanged and does not
apply to VJP; existing graph, staging, type, source, and ABI bounds still apply.

## Executed checks

| Command | Actual result |
| --- | --- |
| Unchanged baseline `npm test` | 604 passed, zero failures or skips |
| Final `npm test` | 673 passed, zero failures or skips |
| `npm run test:vjp` | 205 passed, zero failures or skips |
| `npm run example:host` | Passed; one-call allowance exhausted as expected |
| `npm run example:reducers` | Passed |
| `npm run example:case-studies` | All 12 scalar/SIMD executions passed |
| `npm run build:example` | Passed |
| `npm run test:browser -- --output /mnt/data/asslang-vjp-browser.json` | PASS: 1,096 core plus 148 experimental checks |
| `git diff --check` | Passed |

There are 69 new Node tests: 45 dedicated tests and 24 shared engine cases.
The shared cases execute with all three optimization switches off and all three
on in both Node and Chromium, adding 48 Chromium checks. Dedicated numerical and
semantic tests exercise all eight SIMD/fusion/memoization configurations. The
retained browser report is [vjp-browser-tests.json](vjp-browser-tests.json).

## Independent numerical and semantic evidence

Across all eight configurations, 800 seeded three-input/four-output polynomial
cases compare primal values and cotangents to independent JavaScript formulas.
They include 2,400 central finite-difference comparisons and 800 checks of the
JVP/VJP dot-product identity. The identity is cross-transform consistency evidence;
the analytic and finite-difference expectations do not use compiler derivatives.

Another 800 cases exercise overlapping branch activities on shared intermediates,
checking independent analytic derivatives and 1,600 additional central finite
differences. There are 4,000 scalar finite-difference comparisons in total.
Another 640 rational/square-root points compare both input derivatives to analytic
formulas. At 800 points, forward-over-reverse and reverse-over-forward each match
an analytic Hessian-vector product, yielding 1,600 checked vectors.

Coverage includes repeated output nodes, diamond graphs, aliased input fields,
lexical tuple ordering beyond index nine, empty products, higher derivatives,
weight sensitivity, partial applications, selected objectives, legacy helpers,
stream callbacks, causal captures, and nested traversals. Reachable temporary
perturbation tags are checked to be erased before emission.

Demand regressions cover inactive singular coefficients, shared guarded nodes,
nested guarded branch predicates, constant derivatives, ignored input/weight
fields, zero weights, value-only projections, and empty streams. A NaN output is
explicitly checked not to skip a later primal guard. Tests distinguish supported
numeric local stream callbacks from unsupported reduction/causal-graph AD, and
cover independent memory bounds and active-address rejection.

Explicit JavaScript operation-order expectations cover reverse f64 results,
including signed zero, NaNs, infinities, and active zero weights at singularities.
A regression deliberately verifies that an input-independent infinite expression
can yield a finite reverse cotangent where existing forward arithmetic yields
NaN. This is the documented structural-path/arithmetic-schedule difference, not
bitwise equivalence between modes or a numerical-stability claim.

Twenty-four new effect executions (three programs in eight configurations) each
invoke the host exactly once and consume exactly one allowance, including nested
reverse sweeps, captured performed results, product weights, and stop-gradient.
Diagnostics tests assert source-local locations and matching check/compile errors;
ABI escape, pure host calls, reserved names, and incompatible shapes are rejected.
Compiler-session snapshots remain isolated. The documentation example is extracted
and executed directly in every configuration. The independent corpus reference
evaluator and existing `.ass` corpus were not modified.

## Resource experiment and refinement

An initial wide-input test process was terminated with SIGKILL while reverse
edges still introduced redundant unconditional activity selections. Canonicalizing
unconditional and identical compiler activity removed those redundant branches.
The final wide-input tests and the full suite were rerun successfully. Numeric
zero seeds are not simplified by this refinement.

For a sum-of-squares objective over independent input coordinates, the final
measured staged scalar graph sizes are:

| Input leaves | Scalar nodes | Objective source-proof witnesses |
| --- | --- | --- |
| 16 | 127 | 1 |
| 32 | 239 | 1 |
| 64 | 463 | 1 |
| 96 | 687 | 1 |

The witness is a dead range inside the objective, which leaves one observation
step per preparation but no demanded runtime work. These assertions check graph
reuse/growth, not execution speed. Tests also cover 65-input programs in every
configuration, dynamically selected shared nonlinear chains up to 16 levels,
and failures under low expansion budgets. A separate local probe successfully
compiled and executed product outputs with 16, 32, 64, and 96 weighted leaves.
No throughput benchmark or general complexity theorem for the entire compiler
is claimed.

## Limitations

These are local results, not a claim that the published PR's remote CI passed.
GitHub Actions status must be inspected separately. HTTP module loading,
playground worker loading, other browser engines, and throughput benchmarks
were not exercised.

This is finite static reverse-mode scalar/product AD, not a runtime tape,
reusable reverse-pullback API, full Jacobian representation, or differentiation
through stream/reduction graphs. Its arithmetic schedule differs from forward
AD; rounding and exceptional f64 results can differ. No audited-sandbox,
numerical-stability, differentiability-at-discontinuities, or speedup claim is made.
