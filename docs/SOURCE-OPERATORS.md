# Composable matrix-free operators in source

[Core boundary](CORE-AND-PRELUDE.md) · [Documentation](README.md)

## Implemented: compose actions, not matrices

Link `lib/operators.ass` and `lib/krylov.ass` explicitly. This program combines two
independent operators, constructs their normal operator and solves its system:

<!-- operator-example: product_solve -->
```ass
// Independent two-coordinate systems compose as a product, with no dense matrix.
export fn product_solve = (rhs:{left:Num,right:Num}) -> do {
  let scalar = scalar_vector ();
  let vector = vector_product scalar scalar;
  let twice = {apply:x -> 2*x, adjoint:x -> 2*x};
  let three = {apply:x -> 3*x, adjoint:x -> 3*x};
  let normal = operator_product twice three |> operator_normal;
  cg_solve normal.apply vector rhs vector.zero {tolerance:1e-10,maxSteps:16}
};
```

For rhs `{left:4,right:18}`, the solution is approximately `{left:1,right:2}`.
The default fixture takes two iterations. This source needs no matrix type,
Jacobian array, solver opcode or runtime operator object. Source protocols are
ordinary records, and their mathematical laws are not compiler-issued evidence.

The same action can be placed inside a block scan, then zipped with its source:

<!-- operator-example: operator_blocks -->
```ass
// Captured source operators work inside local scans without changing their clocks.
export fn operator_blocks = (samples:[Num]) -> (width:Num) -> do {
  let twice = {apply:x -> 2*x, adjoint:x -> 2*x};
  let normal = operator_normal twice;
  let local = samples |> chunks width
    |> map (block -> scan block 0 (total -> x -> total + normal.apply x))
    |> flatten;
  let history = zip samples local (sample -> total -> {local:total,correction:total-sample});
  {local:map history (row -> row.local), correction:map history (row -> row.correction)}
};
```

For `[1,2,3,4,5,6,7]` and width 3, local is `[4,12,24,16,36,60,28]` and correction
is `[3,10,21,12,31,54,21]`. Default output fusion uses seven loop units and one
loop site, with 112 final-array bytes and no intermediate buffer. Turning fusion
off retains two traversals and fourteen units. Both output arrays own their data.

Differentiation can supply the operator instead of writing its actions manually:

```text
let {value,linear} = operator_at predict point |> operator_chain residual;
let system = operator_normal linear |> operator_shift vector damping;
let rhs = vector.scale (-1) (linear.adjoint value);
cg_solve system.apply vector rhs vector.zero {tolerance:1e-10,maxSteps:16}
```

The complete [calibration source](../examples/case-studies/operators/calibration-kernel.mjs)
uses three read-only samples and solves a regularized linearized correction. The
[driver](../examples/interop/source-operators.mjs) links the libraries, runs all
three cases with exact loop/storage capacities, and checks one-less failures.
The AD case is a named fragment because the corpus interpreter does not implement
AD; separate derivative and browser tests execute it.

```sh
npm run example:source-operators
npm run test:source-operators
printf '[[1,2,3,4,5,6,7],3]' | node examples/case-studies/app.mjs operator-blocks
npm run audit:core
```

All these libraries also work with `prelude:false`: the compiler primitive
inventory stays at 30, with the same four standard source-prelude functions.
The implementation includes two narrow core repairs exposed by this composition:
identical-arm demand lowering and preservation of supplied derivative seed graphs.
It is not a claim that the compiler was unchanged.

## Design before implementation

Base: merged main `12754f5b69e297d9422205bd1205ff08b8ed142a`, tree
`de77cb80d30ada9751252a785e6b255dce6576ed`. The provided source archive reproduces
that exact tree. The previous core audit asks what new algorithms its mechanisms
can express, not how many new builtin names can be introduced.

A derivative need not be a matrix: expose its action on a direction and the
adjoint action on an output weight. Ordinary source dictionaries can compose those
actions, transpose them, form products and normal operators, and feed a bounded
iterative solver. This tests the source/core boundary: no new parser, type rule,
graph transform, compiler registry entry, loop opcode or ABI is planned. No
special recognition of an operator or solver body is permitted.

Put the algebra in `lib/operators.ass` and conjugate gradients in `lib/krylov.ass`.
Use existing linearize/pullback and iterate mechanisms. Add a calibration
correction using generated derivatives, a captured operator used inside a chunk
scan, and a non-AD solver example for the independent reference evaluator.

## Protocols and composition

A linear operator is `{apply, adjoint}`. For real finite numeric products A and B,
apply has type A -> B and adjoint has type B -> A. The mathematical contract is
linearity and the Euclidean pairing law

    <apply(v), w> = <v, adjoint(w)>.

HM checks shapes used by a program; it does NOT prove either law for arbitrary
user dictionaries. Input/output shapes can differ (rectangular operators).
Functions stay staging-only and cannot escape the ABI. No runtime dictionary,
closure, matrix or tape is allocated by this protocol. Emitted scalar locals,
graph size and host compilation still cost memory; matrix-free is not constant
space in arbitrary problem dimension.

`operator_at f point` builds `{value, linear:{apply,adjoint}}` with one reusable
forward plan and one reusable reverse plan. Each transform stages the objective;
it is not magically staged once in total. Applying their saved actions does not
restage the objective. Core rules determine runtime primal sharing. Construction
does not assert differentiability, finite values or positive definiteness.
Unsupported derivatives are checked when the saved action is applied, as with the
underlying plans. An unused reverse action is not an implicit runtime validation.

`operator_then a b` applies a then b; its adjoint applies b.adjoint then a.adjoint.
`operator_transpose` exchanges actions; identity and left/right product operators
use ordinary functions/records. `operator_normal a` is a followed by its transpose.
`operator_shift a vector lambda` adds lambda*I using explicit vector arithmetic,
checking finite lambda when an action is demanded. Lambda need not be positive
for shifting; a solver needing positive definiteness must establish it separately.

`operator_chain plan next` linearizes next at plan.value and composes the actions.
This avoids linearizing a nonlinear second stage at an unrelated input. Shape
compatibility alone does not establish that independently created plans use the
correct point. Explicit changes of stage boundaries can change f64 accumulation,
rounding and guard demand; no optimizer reassociates these source expressions.

## Exact-real laws, with hypotheses

For finite-dimensional real inner-product spaces and valid linear/adjoint pairs:

1. Identity/associativity follow from function composition. Transpose is involutive
   and reverses composition. For b after a, the pairing proof is
   <b(a(v)),w> = <a(v),b*(w)> = <v,a*(b*(w))>.
2. Products use the sum pairing. Applying both component pairing laws proves the
   product's adjoint property. No dense off-diagonal zeros need to be constructed.
3. N=a* a is self-adjoint and positive semidefinite since
   <u,N(v)>=<a(u),a(v)> and <v,N(v)>=||a(v)||^2>=0. If lambda>0,
   <v,(N+lambda I)v>=||a(v)||^2+lambda||v||^2>0 for v!=0.
4. For differentiable f,g at the relevant points, the chain rule gives
   D(g o f)(p)=Dg(f(p)) o Df(p). operator_chain uses precisely that point/order.
   Core conventions at nonsmooth branches do not prove a classical derivative.

F64 actions approximate real linear maps; they are not exactly linear. Overflow,
underflow, NaN, infinity, accumulation order and conditioning limit these laws.
Check finite instances against independent dense references and finite differences,
using tolerances. Do not turn real laws into silent f64 compiler rewrites or claim
universal verification from finite tests.

## Source vector algebra and bounded solver

A vector dictionary supplies zero, add, sub, scale, dot and finite for a fixed
scalar/nested-numeric-product representation. `scalar_vector` and `vector_product`
construct such dictionaries in source. Domain-named versions can be written
explicitly. This is not automatic shape traversal or compiler-verified arithmetic
instances; laws of supplied operations remain caller contracts.

`cg_solve action vector rhs initial controls` performs at most controls.maxSteps
iterations (integer 0..256). The explicit controls also give an absolute Euclidean
residual tolerance, finite and positive with a positive finite square. The source
iteration cap and emitted-loop allowance are separate; operator/producer loops
share the latter. No increased compiler allowance is required.

Use standard unpreconditioned conjugate-gradient recurrences, one action on each
search direction. Stop on recurrence residual tolerance, nonpositive/nonfinite
curvature, or nonfinite candidate state. Preserve the last finite state on numerical
breakdown and report it. Bad inputs/controls or a trapping action still trap;
this library is not an exception handler. An already solved initial state executes
zero iterations. Validate maxSteps even on that path.

Recompute rhs-action(solution) at the end. Report converged only when that checked
residual meets tolerance, with recurrenceResidualSquared reported separately.
Recursive residuals can drift: a recurrence stop followed by a failed final check
is not convergence. No automatic restart is attempted. Also report iterations and
breakdown. A small residual is not a solution-error bound without conditioning.
No convergence within a finite budget or monotone residual decrease is promised.

With exact arithmetic and SPD A, standard CG generates conjugate directions and
minimizes the quadratic over successive Krylov spaces, reaching the solution in
at most the space dimension absent breakdown. This is a conditional established
result, not a status shortcut for f64 or untrusted source dictionaries. Normal
equations square condition numbers; damping does not guarantee numerical accuracy.
No preconditioner, differentiation through iterate, nonlinear convergence theorem
or production numerical certification is added.

## Concrete uses and storage expectations

A three-reading affine calibration correction solves
(J*J+lambda I) delta = -J*r without forming J or J*J. At x=[0,1,2], y=[1,3,5],
zero initial gain/bias and lambda=1, the independent dense system is
[[6,3],[3,4]] delta = [13,9], with exact solution gain=5/3, bias=1.
This is one regularized linearized correction, not the existing Huber optimizer
or a whole nonlinear fit. For nonzero initial parameters the penalty applies to
the correction, not the final coefficients. Input arrays remain read-only.

Applying a captured operator inside a block scan should preserve resets, alignment,
output fusion and no intermediate guest buffers. Fixed numeric products are the
AD domain: differentiation through general array reductions/scans remains rejected.
Ordinary loops can contain supported scalar derivatives without differentiating
the loop itself. Callbacks may still be expensive.

The solver carries fixed scalar-record state in locals and a bounded iteration
loop, not a trajectory array, per-iteration Jacobian or guest heap. Measure actual
loop sites, exact budgets, output requirements and graph/local sizes. Do not claim
less memory than equivalent handwritten source: it should be equivalent.

## Validation plan

Run the unchanged baseline. Keep the core inventory unchanged. Test core-
only compilation with explicit prelude linkage. Compare source combinators with
handwritten actions, independent dense Jacobians, finite differences, adjoint
pairings, transpose/associativity/product laws, normal positivity on bounded finite
cases and independently solved linear systems.

Exercise all eight lowering configurations, nested products, rectangular maps,
nonlinear stage points, captures, partial applications, linked-source errors,
invalid shapes, host authority, unsupported derivatives, primal demand, empty/lazy
paths, raw/prepared calls, ownership, exact loop allowances and post-trap reuse.
Test zero RHS, iteration limits, numerical breakdown, invalid controls and honest
final residuals. Test larger fixed product shapes without implying arbitrary
runtime-dimensional solver state.

Register non-AD .ass examples in the corpus. AD examples are named source strings
with analytic/browser checks, not skipped reference tests. Execute documentation,
full Node, required host/reducer runners, core audits and available browser paths.
Record only completed checks in a new report; preserve historical reports and the
short README. Add docs navigation and publish theory before implementation.

## Prior work

Matrix-free operators and Krylov methods are established. SciPy LinearOperator
documents lazy operator composition and adjoints; Netlib Templates explains CG,
SPD requirements and stopping; Elliott develops compositional AD categorically.
These are context, not dependencies or evidence that this code is correct:

- https://docs.scipy.org/doc/scipy-1.15.3/reference/generated/scipy.sparse.linalg.LinearOperator.html
- https://www.netlib.org/templates/templates.html
- https://arxiv.org/abs/1804.00746

Sources checked September 14, 2026. The contribution is source-level composition
on Asslang's existing core, not a new solver/category theorem, proof of minimality,
proof-assistant verification or independent audit.

## Implementation finding: preserve demand without duplicating identical branches

Before publication, the source experiment exposed a core composition issue. AD
retains primal demand with nodes shaped as `if condition then value else value`.
The original emitter expanded both arms even when they were the EXACT same graph
node. Nested forward/reverse compositions multiplied those identical subgraphs.
A 526-node staged calibration/CG graph emitted about 43 MB in a local probe.
This is emitted-code expansion, not a need for a dense Jacobian.

Before changing the emitter, specify the narrow repair: when the two arms have
identical scalar-node identity, evaluate the condition in its original order,
discard that Boolean, then evaluate the one shared arm. Never drop the condition,
even for a constant result; it may demand a guard, a memory read, a causal reduction
or a performed result. Do not infer equivalence from values, source spelling or
floating-point identities. Distinct arms keep the original lowering.

The proof is case analysis on the Boolean: either branch runs exactly that same
arm after condition evaluation, so sequencing, returned bits and traps match.
The optimizer may now share unconditional work with later consumers and therefore
change code size, local counts and optimization-dependent loop-budget thresholds.
Do not claim universal byte identity for the new emitter; record actual baseline
comparisons, run all existing exact-budget tests and add focused condition-demand
checks. This is a small existing-IR lowering rule, not another source primitive.

## Implementation finding: direction graphs must remain shared values

A second isolated probe binds one three-step iterate and uses its state as a
saved derivative direction/weight while returning its step count. The original
AD substitution clones the direction's iterate group even though it contains no
private perturbation of that plan. That causes two traversals, and a three-unit
invocation budget fails. Scalar values agree, but composition silently replays
caller work. The calibration solver likewise reruns its iteration when computing
the independent final residual through an operator action.

Specify the narrow repair before implementation: supplied scalar seed leaves are
external to a plan's private perturbation scope. Add identity substitutions for
those leaves when eliminating that plan's private perturbations. The source
cannot access the private roots; returned primal values already substitute them
out. Therefore these seed subgraphs cannot require that substitution, and treating
them atomically preserves both their values and original group identities.
Later outer AD transforms can still traverse the ordinary seed graphs; this does
not tag them stop-gradient or erase nested differentiation. Apply this in forward
and reverse plan application. Do not change global substitution, chunk binder
rewrites, effect nodes or source loop semantics. Tests must cover nested AD,
effect identity, reduction/iteration seeds, exact allowances and nontrivial seeds.

## Source demand phases in the solver

Pure local bindings share a graph but are not eager sequencing statements. The
solver uses explicit nested guards to validate inputs, compute the initial squared
residual, finish the iteration, and compute the checked final squared residual in
that order. Checking each norm before its component-wise finite predicate makes
the action's scalar results available before short-circuiting over them. A test
with a three-step reduction inside the action checks exactly ten total loop units:
three initial-action steps, one iterate step, three search-direction steps and
three final-action steps. There is no unmetered callback allowance.

A nonfinite initial or recomputed final residual traps. A nonfinite trial or
nonpositive curvature returns breakdown with the previous finite solution.
`converged:false,breakdown:false` may mean a reached iteration limit or a stopped
recurrence whose recomputed residual misses tolerance; inspect both residual fields.
No undocumented restart or tolerance relaxation occurs.

[Executed validation](SOURCE-OPERATORS-VALIDATION.md) records the exact comparisons,
AD binary changes, browser results, work/storage counts and numerical limitations.
