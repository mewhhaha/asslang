# Differential staging I: perturbation-scoped forward linearization

## Problem and semantics

The corpus's dual-number example requires users to rewrite arithmetic manually.
The new `jvp f point direction` stages `f` once on fresh symbolic inputs, builds
its directional derivative, and returns `{value, tangent}`. Inputs, seeds, and
outputs must be Num or finite nested records/tuples of Num; ordinary inference
checks shape equality and staging checks the numeric representation. This is
compiler automatic differentiation, not numerical finite differences.

Each application creates distinct seed identities, including aliased product
fields. Captures are constants with respect to the current seed, even when a
capture and an argument have the same primal graph. Nested linearizations keep
separate identities; after each transform all temporary seed nodes are replaced
by their primal expressions. This prevents perturbation capture without runtime
dual objects or an execution tape. `stop_gradient value` preserves the value
and deliberately blocks every differentiation level through that expression.

Arithmetic rules cover +, -, *, /, negation and sqrt. Conditionals and callable
choices use the selected primal path. Abs has tangent zero at zero, min/max
choose the left argument at ties, and floor has tangent zero. These are declared
pathwise conventions, not differentiability claims at discontinuities. IEEE
NaNs, infinities, signed zero and overflow follow generated f64 expressions;
this transform is not a proof about real arithmetic or a stable numerical
algorithm. Branch predicates are not differentiated.

Differentiating a demanded output retains its primal checks, even when only the
tangent is projected and its formula is constant zero. Inactive branches remain
inactive. Guards are preserved. Independent memory loads may be treated as
constants; differentiating a load address or extent is rejected. Initially,
reductions and causal machine graphs in differentiated outputs are rejected
with `E_DIFF_UNSUPPORTED`, rather than silently returning zero. Stream-valued
linearization and host effects are outside this first experiment.

## Lowering, alternatives, and bounds

The transform operates on the existing scalar DAG after higher-order staging.
Fresh unique identity guards mark symbolic inputs and are erased by substitution.
A memoized derivative walk constructs only existing scalar operations. A final
primal-dependent selection forces the required primal computation before its
tangent without constraining independent, undemanded output fields. Each newly
constructed node is charged to the scalar graph expansion limit.

Operator-overloaded runtime dual numbers would change representation; source
rewriting would duplicate name resolution and lexical substitution. Reverse-mode
requires a different adjoint schedule. This experiment uses bounded, compiler-side
forward graph transformation. It makes no speedup or worldwide novelty claim.
The public ABI and all existing programs remain unchanged, except that `jvp` and
`stop_gradient` become reserved intrinsic names.

## Intrinsic integration and test discovery

A small internal intrinsic registry supplies arities, inference schemas and
staging handlers. It receives the existing checked staging constructors, never
host authority. The registry is compiler code, not a source-level plugin loader.
Keeping transforms outside JTE avoids mixing arithmetic experiments with event
proof rules. The fixed browser test bundler will also load explicitly located
`test/experiments/*.mjs` data modules, running the same cases as Node. This does
not add runtime source imports or filesystem access to compiled kernels.

## Validation plan

Analytic polynomial/rational derivatives, record seeds, lexical aliases, nested
second/third derivatives, pathwise conventions, inactive traps, tangent-only
preconditions, stop-gradient, invalid shapes, source coordinates and resource
bounds. Seeded polynomial checks in all optimization modes; selected finite-difference comparisons away from discontinuities. Full Node tests, all
example drivers, and Chromium engine tests. Record executed outcomes separately.


## Executed validation and representation refinement

Executed 2026-09-07 with Node v22.16.0 and Chromium 144.0.7559.96:
The initial `npm test` run passed all 495 tests. Host, reducer and case-study drivers all passed.
The Chromium engine report passed its existing 1,096 checks and 20 additional
experimental checks (10 cases in two modes). HTTP modules and playground worker
loading were not tested. Analytic and finite-difference checks covered 800
seeded polynomial inputs across eight SIMD/fusion/memoization configurations.
Separate assertions check signed zero of the actual generated expression; an
algebraically factored real derivative need not have the same zero sign.

A nested-capture test initially found an incorrect second derivative: generic
substitution cloned an enclosing seed node, losing identity. Seeds now carry a
stable `differentialSeed` tag. Derivative lookup and seed erasure recognize this
tag after cloning. The regression, nested third derivatives, capture aliases,
stop-gradient, and tangent-only demand cases pass. These temporary tags use the
existing identity-guard representation and do not add a guest ABI field.

At the original handoff, publication was separate from validation: the GitHub
connector refused the theory-tree write twice with an indeterminate safety-status
error. That handoff was locally validated but had no differential PR or merge.
The subsequent publication retry is recorded below; historical local results must
not be read as GitHub CI evidence.

### Performed-result boundary refinement (theory before repair)

A performed scalar value is an already-issued effect result, not a pure expression
that substitution may clone. Treat `host_call` nodes as atomic in substitution;
their original ordered effect binding must be reused exactly once. Differentiation
may regard such an independent captured result as a constant, but never creates,
differentiates, or replays a host invocation. Reject an active host invocation if
one is ever presented to the transform. A one-call capability regression must
exercise both differentiated input values and captured performed results,
including stop-gradient, in every optimization configuration. The audit that
motivated this refinement observed `E_EFFECT_TOKEN` from a cloned node; the broker
correctly prevented the replay, but the compiler must not generate it.


### Executed performed-result regression

After the atomic-result repair, the complete suite was rerun on 2026-09-07:
`npm test` passed **496 tests**, zero failures and zero skips. All three example
drivers passed again, and the Chromium engine suite passed its existing 1,096
checks plus 20 experimental checks. The new regression makes 24 invocations
(three programs in eight optimization configurations), each with a one-call
capability. Each returns the analytic derivative, calls the host exactly once,
and exhausts exactly one capability allowance. The source and validation logs
are retained in the original unpublished patch handoff. These are local results,
not GitHub validation for this differential extension.


## Publication retry and fresh validation

On 2026-09-07, the unchanged initial theory document was accepted through the
same GitHub `create_tree` connector action, producing tree
`c5667b77ef0539343e82199574b00e2847849360`. The retry made no permission, workflow,
or sandbox changes. The earlier safety-status failure did not expose a detailed
reason in its message; successful publication does not establish its root cause.

The handoff checksums and original final tree
`847120c4258c4ed1519336bc1495904637518ba2` were verified. Reversing and replaying
all four patches reproduced the exact base and final trees. For publication,
the initial design and the atomic-effect boundary refinement precede the combined
implementation. The implementation, tests, and tooling are unchanged from that
verified final tree; only this document updates the publication history.

Fresh checks with Node v22.16.0 and Chromium 144.0.7559.96 on 2026-09-07:
`npm test` passed all 496 tests, zero failures or skips. `npm run example:host`,
`npm run example:reducers`, and `npm run example:case-studies` all passed.
`npm run test:browser -- --output <report>` passed 1,096 existing checks plus
20 experimental checks. HTTP module loading and playground worker loading were
not exercised. These fresh results are local; the PR's GitHub Actions checks
are separate evidence and must be inspected independently.
