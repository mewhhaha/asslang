# Reverse-mode vector-Jacobian products

## Problem and public contract

Forward `jvp` propagates one input direction to the outputs. `grad` repeats a
forward walk for each input coordinate, and `linearize` reuses a prepared forward
graph. Add `vjp f point weights` to propagate output weights back to the inputs
with one compiler-side reverse sweep, without constructing a coordinate basis:

```text
vjp : (a -> b) -> a -> b -> {value: b, cotangent: a}
```

The point and objective result must be `Num` or finite nested numeric products;
weights have exactly the output shape. The cotangent has exactly the input shape,
including unused fields and nested empty products. Empty input/output products
are permitted, as in JVP. With no numeric outputs, input cotangents are zero.
For smooth real arithmetic the result is the Jacobian transpose times the output
weights, not a full Jacobian. For a scalar objective, unit weight yields its
gradient. Existing `grad`, JVP, and linearization keep their current algorithms.

## Example: a weighted multi-output response

```ass
fn response = p -> {energy: p.x*p.x + 3*p.x*p.y, balance: p.x-p.y};
export fn weighted_sensitivity = (point:{x:Num,y:Num}) ->
  vjp response point {energy:2,balance:5};
```

At `{x:2,y:4}`, the value is `{energy:28,balance:-2}` and the cotangent is
`{x:37,y:7}`. The weights select a linear combination of output sensitivities.
This is not a numerical optimizer or a convergence guarantee.

Ordinary partial application and finite selected objectives are supported.
Numeric results may compose with JVP, `grad`, further VJPs, and saved forward
pushforwards, including differentiation with respect to the weights. Captures
are constant only relative to this transform. Aliased point fields receive
independent tagged roots. Existing tags survive nested substitutions, and an
already-performed host result remains an atomic binding, never a replayable call.

## Demand and pathwise rules

A demanded cotangent leaf retains primal demand for **every numeric output leaf**,
even when that input is unused or a weight is numerically zero. A contraction
combines all outputs; it does not use a zero weight as an output-demand mask.
Primal output fields themselves remain independently demandable through `.value`.
A value-only runtime projection does not evaluate weights or adjoints, although
VJP still constructs and validates the reverse transform during compilation.

Inactive objective branches, wholly unused VJP bindings, and empty stream
callbacks stay inactive. In particular, a zero adjoint alone is not an activity
mask: multiplying it by a coefficient from an inactive branch could demand a
false guard or create a NaN. Each reverse edge therefore has an explicit Boolean
activity condition, and its entire local arithmetic is selected inside that
condition. Conditions are combined with short-circuit Boolean operations.
Shared nodes merge both gated contributions and their activity conditions.
Unconditional activity is represented canonically: it does not add a selection
on every reverse edge. Identical activity conditions also need not be duplicated.
These compiler-control identities do not simplify numeric zeros or source
arithmetic. They avoid unnecessary branch nesting in otherwise straight-line
reverse graphs; a wide-input stress test must guard this representation choice.

Branch predicates are not differentiated. `if` follows the primal branch;
min/max ties select the left operand, abs has zero derivative at zero (and on
its unordered/NaN comparison path), floor has zero derivative, and
`stop_gradient` blocks propagation at every differentiation level. A stopped
or otherwise input-independent output need not demand its weight, but its primal
value is still demanded by a cotangent. Runtime-zero weights on active paths are
not simplified away. Input fields and weight expressions unused by the generated
numeric graph remain lazy.

## Reverse representation and arithmetic order

Factor tagged objective preparation out of the forward module without changing
its derivative rules. The reverse module validates the numeric derivative graph,
builds a dependency-first order with an explicit stack, and processes it in
reverse. Each node accumulates incoming adjoints once before propagating to its
numeric children. Local transpose rules for upstream adjoint `u` are:

| Node | Contributions |
| --- | --- |
| `a+b`, `a-b` | `(u,u)`, `(u,-u)` |
| `a*b` | `(u*b,u*a)` |
| `a/b` | `(u/b,-(u*a)/(b*b))` |
| `-a`, `sqrt a` | `-u`, `u/(2*sqrt a)` |
| `if c then a else b`, min/max | Selected-edge `u`, inactive-edge zero |
| abs | Positive-edge `u`, negative-edge `-u`, otherwise zero |
| `require c a` | Guarded contribution to `a` |
| floor, stop-gradient, independent scalar terminals | No contribution |

Only paths that reach this transform's input roots need adjoint construction.
Graph validation still rejects unsupported derivative operations, even on a
statically staged branch that will not run. The validation traversal stops at
explicit stop-gradient/floor boundaries, just as the existing forward rules do.
Independent memory reads are constants; active addresses/extents and active host
calls are rejected. Reductions and causal-machine graph derivatives remain
unsupported. Numeric local VJPs inside existing stream callbacks/transitions do
not differentiate the stream or recurrence itself.

Output seeding uses lexical product-field order. Contributions accumulate in a
deterministic reverse graph order; a first contribution is not added to an
artificial zero. Temporary roots are substituted before emission. The shared
primal-demand fence uses comparisons and selections, not arithmetic on the
objective values, so NaNs do not suppress required primal demand.

This is a new reverse arithmetic schedule, **not bitwise equivalence to forward
AD**. Rounding, overflow, signed zero, and NaNs can differ from `grad`, from JVP,
or from differentiating an explicitly weighted scalar expression. Structurally
absent derivative paths contribute zero without multiplying irrelevant primal
values. Active numerical zeros still follow the stated f64 rules. No
real-differentiability, numerical-stability, or throughput claim is made.

## Bounds, alternatives, and compatibility

One preparation and one reverse sweep replace coordinate-basis expansion.
Compiler maps/order lists are bounded by the existing staged graph; each edge
has a bounded number of generated scalar operations. Existing source, parser,
type, scalar-expansion, staging-work and ABI limits still apply. There is no
64-input gradient cap because VJP does not enumerate input directions. This is
not permission to bypass `maxExpansion` or the ASABI field/depth bounds.

No guest tape, closure, dual object, function table, new Wasm instruction,
intermediate array, dependency, event-domain rule, or ASABI 1 layout is added.
Compiler-side maps and the normal returned host values still occupy memory.
`vjp` becomes a reserved intrinsic name; declarations using it must be renamed.
No other source compatibility change or optimization-default change is intended.

Repeated forward directions could implement the same real-arithmetic operation,
but would retain coordinate scaling and forward arithmetic behavior. A runtime
tape would require new storage and lifetime rules. This change chooses a static
reverse graph for the existing finite scalar kernel language. A reusable reverse
pullback and differentiation through stream/reduction graphs are separate work.

## Validation plan

Run the unchanged suite first. Test analytic scalar and product derivatives,
seeded central finite differences, and JVP/VJP dot-product duality away from
singularities across all eight SIMD/fusion/memoization configurations. Cover
nested derivatives in both directions, aliased fields, captures, repeated output
nodes, empty products, tuples past index nine, partial applications, selected
objectives, legacy helpers, scalar stream callbacks, and causal captures.

Adversarial branch tests must include shared nodes, inactive guards, inactive
singular coefficients, and nested branch predicates with guards. Test all-output
primal demand, ignored input/weight fields, value-only uses, zero weights,
stop-gradient, nonsmooth conventions, and explicit f64 schedule expectations.
Use one-call capabilities to detect duplicated performed results. Check structured
source-local errors, ABI/authority rejection, compiler sessions, graph-work
bounds, and input shapes wider than 64 numeric leaves. Check graph reuse and
scaling without timing assertions or performance claims.

Add shared Node/Chromium cases, extract the example above into an executable
test, and leave the independent source reference evaluator unchanged. Run
`npm test`, all three example drivers, `npm run build:example`, the Chromium
engine suite, and `git diff --check`. Record actual outcomes and limitations in
a new validation report; do not rewrite earlier evidence.
