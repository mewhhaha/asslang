# Reusable linearization: executed validation

## Scope and provenance

Executed locally on 2026-09-08 using Node v22.16.0, Linux x86-64, and Chromium
144.0.7559.96 (HeadlessChrome 144.0.0.0). The baseline is main commit
`18d577bae12e790d2c70add28c7adedf41ed1560`, after the product-gradient PR, with tree
`8505774e9cfb3b58ab65a00db391da77cfaed532`.

The source snapshot came from that commit's retained GitHub Actions validation
artifact. Its complete local Git tree matched the upstream tree before edits.
The design in [LINEARIZE.md](LINEARIZE.md) was committed before implementation.
This is new evidence; earlier gradient, differential, and benchmark reports
remain historical and unchanged.

## Implemented behavior

`linearize f point` returns a numeric primal value and a statically staged unary
pushforward. Preparation shares the existing forward-AD implementation; applying
the pushforward walks the saved graph with a fresh direction and derivative
cache, without staging the objective again. Ordinary callable choices, guards,
helpers, partial applications, and internal records can carry the pushforward.
No callable can escape through ASABI 1. The browser's fixed test bundler exposes
the same implementation.

The numeric shapes and derivative rules match JVP. Deferred derivative failures
report the pushforward application site. Value-only uses validate numeric
representations without constructing derivatives; this permits a numeric
reduction objective's value but does not add reduction differentiation.
`linearize` becomes a reserved intrinsic name. No dependency, syntax, ABI layout,
backend instruction, optimization default, or event-domain rule changed.

## Executed checks

| Command | Actual result |
| --- | --- |
| Unchanged baseline `npm test` | 546 passed, zero failures or skips |
| Final `npm test` | 604 passed, zero failures or skips |
| `npm run test:linearize` | 136 passed, zero failures or skips |
| `npm run example:host` | Passed; explicit capability exhausted as expected |
| `npm run example:reducers` | Passed |
| `npm run example:case-studies` | All 12 scalar/SIMD executions passed |
| `npm run build:example` | Passed |
| `npm run test:browser -- --output /mnt/data/asslang-linearize-browser.json` | PASS: 1,096 core checks plus 100 experimental checks |
| `git diff --check` | Passed |

There are 58 new Node tests: 38 dedicated linearization tests and 20 shared engine
cases. The shared cases run with all three optimization switches off and all
three on in both engines, adding 40 Chromium checks. The deeper Node suite
exercises all eight SIMD/reduction-fusion/reduction-memoization combinations.
The browser report is retained in
[linearize-browser-tests.json](linearize-browser-tests.json).

## Independent numeric and semantic evidence

The product-output test evaluates 800 seeded inputs across the eight
configurations, each with three directions and four numeric output leaves.
It compares primal outputs and tangents with independent hand-derived JavaScript,
including 9,600 scalar central finite-difference comparisons. Another 800 input
points each supply two analytic Hessian-vector comparisons, for 1,600 vectors.
These are correctness checks, not throughput benchmarks.

A preparation-count regression uses a dead range inside the objective as an
observation-ledger witness: three applications of one saved pushforward create
one source proof step, while three independent JVPs create three. Both return
the same analytic result. This checks compiler staging reuse, not an exactly-once
runtime evaluation guarantee. Pure examples also assert no imported guest
function/table, and the existing allocation/intermediate-buffer statistics stay
zero.

Coverage includes aliased coordinates, nested records, tuples beyond index nine,
empty input/output products, legacy unit application, polymorphic helpers,
selected objectives and selected complete linearization records, guarded
pushforwards, nested AD in both directions, and derivatives with respect to the
direction itself. Stream callbacks, nested traversals, and causal transitions
retain their lexical captures and observation constraints.

Demand regressions distinguish constant/zero derivatives from unused output
fields; inactive branches and empty streams from demanded traps; and value-only
objectives from applied derivatives. They cover independent memory bounds checks,
active-address rejection, stop-gradient, source-local errors, reserved names,
ABI escapes, forbidden host functions, compiler-session snapshot isolation,
65-leaf single directions, and low scalar/work expansion budgets. In particular,
repeated identical pushforward applications still consume staging work even when
their generated nodes intern.

Exceptional f64 results (including NaNs, infinities, and signed zeros) are compared
to explicit JVPs with `Object.is`. This checks compatibility with declared
pathwise rules, not an independent real-arithmetic oracle. Twenty-four effect
executions, using three programs in all eight configurations, each invoke a host
exactly once and exhaust exactly one capability allowance despite derivative
reuse, nesting, captures, and stop-gradient.

The feature document's sensitivity example is extracted and executed directly
in all eight configurations. No `.ass` example file was added, and the independent
corpus reference evaluator was not changed.

## Limitations

These are local results, not a claim that the published PR's remote CI passed.
GitHub Actions must be inspected separately for the published commit. HTTP module
loading and playground worker loading were not exercised. Other browser engines
and throughput benchmarks were not run.

This remains a finite compiler-side forward transform, not an escaping runtime
closure, reverse-mode AD, full Jacobian representation, or stream/reduction AD.
The saved graph is reused during compilation; pure runtime work remains subject
to existing demand and emission rules. No numerical-stability, differentiability,
exactly-once runtime evaluation, or speedup claim is made.
