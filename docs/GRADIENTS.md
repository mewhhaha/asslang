# Differential staging II: finite product gradients

## Problem and public semantics

`jvp f point direction` computes one directional derivative. A scalar objective
with several parameters currently needs manually written basis directions and
repeated calls. Add two compiler intrinsics:

- `grad f point` returns a gradient with exactly the numeric product shape of
  `point`.
- `value_and_grad f point` returns `{value, gradient}`, where `value` is the scalar
  objective and `gradient` is the same result as `grad f point`.

The objective takes one argument and returns `Num`. Its argument is either `Num`
or a finite nested record/tuple with numeric leaves. Tuple fields keep their
existing `_0`, `_1`, ... representation. Gradient field names and nesting match
the argument, including fields unused by the objective. There must be at least
one and at most 64 numeric leaves; empty products alone are rejected. Nested
empty products are preserved when another field provides a numeric leaf.

For example, the gradient of `p -> p.x*p.x + 3*p.x*p.y` at `{x:2,y:4}` is
`{x:16,y:6}`, and its value is 28. Independent product fields receive distinct
perturbation identities even when they share a primal expression. Captures remain
constant relative to this differentiation, not relative to an enclosing
transform. Both intrinsics support ordinary partial application and finite
selected callables. A result of `grad` may be differentiated again, for example
with `jvp` to obtain a Hessian-vector product.

These are **forward-mode coordinate derivatives**, not reverse-mode AD. Each
coordinate is the existing JVP rule with a unit basis seed. All pathwise and f64
conventions in [DIFFERENTIAL-STAGING.md](DIFFERENTIAL-STAGING.md) apply, including
zero tangents for floor, stop-gradient, and abs at zero, and left selection for
min/max ties. Expressions are not algebraically simplified: zero multiplications
can propagate NaNs or infinities just as they do in an explicit JVP. No numerical
stability, differentiability at discontinuities, or performance claim is made.

## Example: a bounded quadratic update

```ass
fn objective = p -> (p.x-3)*(p.x-3) + 2*(p.y+1)*(p.y+1);
export fn step = (point:{x:Num,y:Num}) -> (rate:Num) -> do {
  let result = value_and_grad objective point;
  require (rate >= 0) {
    value: result.value,
    gradient: result.gradient,
    next: {x: point.x-rate*result.gradient.x,
           y: point.y-rate*result.gradient.y}
  }
};
```

Calling `step` with `[{x:5,y:2},0.25]` through `createRuntime` returns value 22,
gradient `{x:4,y:12}`, and next point `{x:4,y:-1}`. This is one explicit update,
not an optimizer or a convergence guarantee for arbitrary step sizes.

## Demand, authority, and compatibility invariants

Demanding any gradient leaf must retain the scalar objective's primal demand,
even for a constant derivative or an input ignored by the objective. A demanded
false `require` must trap. An inactive objective branch or an entirely unused
gradient binding must not introduce a runtime trap. Gradient fields remain
independently demandable; constructing the product is not an eager evaluation
of every derivative coordinate. A value-only projection need not evaluate seeds
or derivative expressions at runtime.

`stop_gradient` blocks differentiation without suppressing primal demand.
Already-performed host results remain atomic captured values: no transform may
clone or replay a host invocation, hide authority, or gain a capability. Event
provenance, causal access, and stream guards are unchanged. Gradients can appear
inside existing scalar stream callbacks and causal transitions, but this change
does not differentiate a reduction or a causal machine graph itself.

`grad` and `value_and_grad` become reserved intrinsic names; programs using either
as a declaration must rename it. There is no syntax, source loader, dependency,
ASABI 1 layout, optimization-default, or guest allocation change. Stream-valued
inputs, nonnumeric products, nonscalar objectives, active memory addressing,
reductions in differentiated outputs, and host differentiation remain outside
this feature. Rejected uses must carry compiler diagnostics, not native errors.

## Representation and alternatives

Extract the existing forward transform into a shared preparation and
pushforward operation. Preparation assigns fresh tagged symbolic roots, stages
one objective graph, validates its output, and records primal substitutions.
Each pushforward walks that graph with its own seed map and memoized derivative
cache. `jvp` supplies the user direction; gradients supply one unit basis per
numeric input leaf. Substitution removes all temporary roots while preserving
outer perturbation tags and atomic performed results. Each tangent retains the
existing primal-dependent selection that enforces demand for NaNs as well as
ordinary numbers.

Reuse existing scalar constructors and interning; do not add runtime dual values,
a tape, closures, intermediate buffers, or new Wasm instructions. Runtime node
sharing remains subject to existing emission and demand rules; staging once does
not claim that every pure expression executes exactly once across branches.

A source-library implementation could call JVP repeatedly but would restage the
objective for every coordinate. Reverse-mode would be attractive for wide inputs
but requires a separate adjoint schedule and demand proof. A full Jacobian would
also need a product-output representation contract. This bounded forward-mode
extension intentionally does neither.

## Resource limits

Reject more than 64 input leaves with `E_LIMIT` at the intrinsic call before
staging the objective or constructing derivatives. Reject an input with no
numeric leaves with `E_DIFF_TYPE`. The fixed dimension bound limits the number
of derivative walks even when scalar interning reuses every generated node.
Each walk memoizes visited graph nodes; every new scalar uses the existing
`maxExpansion` budget. Existing parser, type, source, ABI depth/field, and staging
limits still apply. No option raises or bypasses those bounds.

## Validation plan

First run the unchanged full suite. Then compare scalar, record, nested tuple,
and aliased-input gradients against independent analytic derivatives and central
finite differences in all eight SIMD/fusion/memoization combinations. Cover
nested AD in both directions, Hessian-vector products, captures, callable
choices, partial applications, nonsmooth conventions, exceptional f64 values,
unused bindings/fields, primal guards, empty inputs, memory addressing, and
one-call capabilities. Check source-local diagnostics, compiler sessions,
64/65-leaf boundaries, and `maxExpansion` failures.

Add shared Node/Chromium cases and a runnable documentation example, checked
directly against analytic results. The source reference evaluator does not model
AD, so do not weaken its corpus assertions or use the compiler as its own oracle.
No new `.ass` files are needed under `examples/`. Run `npm test`, all three
example drivers, `npm run test:browser`, and `git diff --check`.
Record actual outcomes and unavailable checks in a new validation report; do not
rewrite earlier differential or benchmark evidence.
