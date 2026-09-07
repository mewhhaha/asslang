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
bounds. Seeded polynomial checks in all optimization modes; selected finite
finite-difference comparisons away from discontinuities. Full Node tests, all
example drivers, and Chromium engine tests. Record executed outcomes separately.
