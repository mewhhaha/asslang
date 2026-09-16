# Structured optimization over numeric products

[Documentation](README.md) · [Numeric shape programming](TYPE-PROGRAMMING.md) · [Gradients](GRADIENTS.md)

## Design status

This document is the theory-first contract for a source-library change based on
main `8e40a8fdee0b4a9eed0ea1c129d5e09b08fb1e22`. It does **not** claim the API is
implemented or validated until an executed-evidence section is added after the
candidate tree has passed its checks.

## Problem and motivating program

Asslang can already differentiate a scalar objective over a nested numeric record,
and `lib/products.ass` can map, zip, fold, scale, dot and AXPY such records. A
caller that wants an optimizer still has to spell the product update at each call
site, or hand-project every field:

```ass
let gradient = grad loss point;
{
  gain: point.gain-rate*gradient.gain,
  model: {
    bias: point.model.bias-rate*gradient.model.bias,
    slope: point.model.slope-rate*gradient.model.slope,
  },
}
```

The fieldwise form is not reusable when the parameter record changes. The direct
`product_axpy` form is better, but it still couples an optimization algorithm to
the concrete numeric-product mechanism instead of letting an ordinary source
dictionary provide the vector operations.

The intended source is:

```ass
let next = product_gradient_step loss point rate;
```

and, when an algorithm should be abstract over its update algebra:

```ass
let vector = numeric_vector point;
let next = gradient_step_with vector loss point rate;
```

The goal is not a compiler optimizer primitive. It is to demonstrate that bounded
shape programming and source-defined dictionaries are sufficient to express a
useful transformation over scalar and nested-record parameters while keeping the
trusted compiler boundary unchanged.

## Proposed source API

`lib/optimization.ass` defines ordinary Asslang functions:

```text
numeric_vector witness
  -> { zero, add, scale, dot, axpy }

gradient_step_with vector objective point rate
  -> point'

product_gradient_step objective point rate
  -> point'

momentum_step_with vector objective state rate momentum
  -> {point, velocity}

product_momentum_step objective state rate momentum
  -> {point, velocity}
```

`numeric_vector witness` derives its operations with the existing
`product_map`, `product_zip`, `product_fold`, `product_scale`, `product_dot`, and
`product_axpy` source helpers. The witness contributes only its statically checked
numeric-product shape. Its numeric contents are not metadata and are not required
to be finite.

`gradient_step_with` has the mathematical update

    g  = grad objective point
    p' = axpy point g (-rate)

For the derived numeric vector, this is exactly `point - rate * g` at every leaf,
with the existing floating-point operation order chosen by `product_axpy`.

`momentum_step_with` uses one explicit state record:

    g  = grad objective state.point
    v' = add (scale state.velocity momentum) g
    p' = axpy state.point v' (-rate)

and returns `{point:p', velocity:v'}`. This is a source-level convention, not a
new state machine or hidden mutable optimizer object.

## Types, shape and dictionary constraints

The library adds no source constraint syntax. Existing Hindley–Milner inference,
record rows and numeric-product restrictions establish the usable shapes.
`gradient_step_with` only requires the `axpy` field it selects from its dictionary;
therefore a caller can provide a smaller custom update dictionary. The numeric
convenience functions derive a full dictionary from `point` and use the existing
product checks to require velocity/direction values to have exactly the same
recursive field shape.

Shape mismatch is a compile-time error even if the bad optimizer call is in an
unused definition. Boolean, stream, function and symbol-keyed leaves remain
invalid numeric products. Scalar `Num`, empty products and nested named/positional
products retain the numeric-product rules in `TYPE-PROGRAMMING.md`.

No optimizer function or dictionary value may escape through the concrete ABI.
Only the resulting numeric product or explicit `{point,velocity}` data crosses an
export boundary.

## Demand, effects and differentiation

All new definitions are pure source. Selecting an unused dictionary field must
not demand its value. The derived `zero` product may therefore remain unexecuted
when an algorithm only uses `axpy`. `grad` keeps its existing activity and graph
restrictions; this library does not make an unsupported objective differentiable.

Host effects are not made differentiable or hidden behind an optimizer. Existing
`perform` and capability checks still apply. The library does not reorder stream
events, introduce causal access, or manufacture alignment evidence.

A source callback may ignore values under the existing lazy demand semantics.
Nothing in this design changes NaN, infinity, signed-zero, guard or
short-circuiting behavior.

## Lowering and representation

There is no new parser form, builtin, scalar opcode, JTE node, Wasm instruction,
ABI layout, guest allocation or runtime reflection table. `numeric_vector`
constructs a compiler-staged record of ordinary source functions. Its pointwise
operations elaborate through the existing bounded numeric-product traversal and
then through the existing scalar graph and AD pipeline.

For a finite scalar or record objective whose gradient is already representable as
a scalar graph, the optimizer update itself should require no guest loop and no
intermediate array. This is a validation target, not a universal performance
claim: an objective or future vector implementation may carry its own loops,
materialization or scratch requirements.

Renaming the library functions must not change generated Wasm. A direct source
expansion of the same `grad` plus `product_axpy` update should emit equivalent
Wasm under the same compiler options. These checks demonstrate absence of a
name-recognition shortcut; they do not prove all compiler transformations correct.

## Resource bounds

The existing numeric-product limits remain unchanged: at most 128 numeric leaves,
16 record levels and 4,096 shape nodes per product traversal. Every staged
application still consumes the normal expansion allowance. The library adds no
exemption and must not raise a default limit.

A gradient step performs one existing differentiation staging operation and one
shape-directed AXPY. Momentum additionally stages one scale and one add. Compiler
front-end and staging work therefore grow with the finite product shape even when
the emitted runtime update has no loop. No compile-time or runtime complexity
claim is made beyond the inherited bounds.

## Compatibility and core boundary

The functions live in an explicitly linked source library rather than the default
prelude. Existing programs that do not link `lib/optimization.ass` are unchanged.
No callable compiler primitive or default-prelude function is added, so the audited
core counts must stay unchanged. The core inventory should list the new file only
as a source library.

Keeping optimization separate from `numeric_algebra` avoids widening an existing
source dictionary merely to support this experiment. A compiler `gradient_step`
intrinsic was rejected because it would duplicate ordinary `grad` and product
operations while enlarging the trusted name/staging surface. Runtime reflection
was rejected because the shape is already known statically and the project avoids
field tables and guest closure allocation for these abstractions.

## Related work

JAX documents *pytrees* as recursively nested containers whose leaves can be
mapped/reduced and whose structure is reused by transformations such as `grad`;
its `tree.map` also requires matching structure for multi-tree mapping:
https://docs.jax.dev/en/latest/pytrees.html (checked September 17, 2026).

That is relevant prior art, not a claim of equivalence or novelty. Asslang's
numeric products are deliberately narrower: only statically known numeric
record/tuple shapes participate, there is no extensible runtime container registry,
and the source optimizer lowers through the existing Wasm compiler rather than a
Python tracing API.

## Validation plan

Before publishing implementation to main:

1. Test scalar and nested-record gradient steps under the relevant optimization
   configurations, with independent expected values.
2. Test the dictionary-generic path with a custom clipped AXPY implementation so
   the compiler cannot satisfy the test by recognizing library names.
3. Test two momentum steps with explicit expected point/velocity state.
4. Reject exact-shape mismatches and invalid numeric leaves, including an unused
   bad caller; retain the client source name in diagnostics.
5. Compare generated Wasm with a direct source expansion and with a renamed
   optimizer library where semantics are identical.
6. Assert zero loops and zero intermediate buffers for the finite pointwise example,
   while avoiding claims about arbitrary objectives.
7. Run `npm test`, `npm run example:host`, `npm run example:reducers`, the new
   example driver, `npm run audit:core`, `npm run check:prelude`,
   `npm run check:operators`, and the browser suite on the exact candidate tree.
8. Reconcile this document and `docs/automation-progress.md` with the executed
   revision, commands, results and limitations before the final main update.
