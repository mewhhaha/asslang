# Reusable forward linearization

## Problem and public contract

`jvp f point direction` stages an objective and applies one direction. Repeating
that expression stages the objective again. `grad` shares its objective across
coordinate directions, but only for scalar outputs. Add `linearize f point` to
make a prepared forward transform reusable for arbitrary numeric products:

```text
linearize : (a -> b) -> a -> {value: b, pushforward: a -> b}
```

Here `a` and `b` must each be `Num` or a finite nested record/tuple of `Num`.
Empty products follow JVP's existing rules and are permitted. Inference enforces
exact input/direction and objective/output shapes; staging checks numeric leaves.
The returned `pushforward` takes one direction and returns only its tangent.
Each call has the semantics of `(jvp f point direction).tangent`. The primal
`value` has the same shape as `f point`. This is forward-mode differentiation,
not a reverse-mode pullback, a numerical finite difference, or a full Jacobian.

The operation itself may be partially applied. Its pushforward is a statically
known callable: it can be bound, passed to a helper or a scalar stream callback,
stored in an internal record, selected between finite alternatives, or guarded
with `require`. It cannot escape through ASABI 1. The whole linearization record
also cannot escape, because one of its fields is a function. Project its numeric
value or apply its pushforward before returning to the host.

## Example: several sensitivity directions

```ass
fn response = p -> {energy: p.x*p.x + 3*p.x*p.y, balance: p.x-p.y};
export fn sensitivities = (point:{x:Num,y:Num}) -> do {
  let local = linearize response point;
  {value: local.value,
   along_x: local.pushforward {x:1,y:0},
   along_y: local.pushforward {x:0,y:1}}
};
```

At `{x:2,y:4}`, this returns value `{energy:28,balance:-2}`, x-direction
`{energy:16,balance:1}`, and y-direction `{energy:6,balance:-1}`. Each named
direction is an output-shaped tangent, not a row of a new matrix ABI.

## Demand and differentiation invariants

Preparation invokes the source objective once during staging on fresh tagged
symbolic roots. Each later pushforward call walks this saved objective graph
with a new seed map and a per-call derivative cache. It does not invoke the
objective again. Calling a helper that constructs a new linearization is a new
preparation, not global caching. Pure runtime expressions remain subject to the
existing emitter's demand and sharing rules; this is not a guarantee of exactly
one runtime evaluation of all common subexpressions.

The saved graph retains independent perturbation identities even for aliased
input fields. Captures are constant relative to the prepared transform, but
remain differentiable with respect to enclosing transforms. Directions are
ordinary expressions and can themselves be differentiated. Returned derivatives
may participate in JVPs, gradients, higher derivatives, and nested linearizations.
`stop_gradient` blocks every differentiation level through its marked expression.

Demanding a tangent leaf demands its corresponding primal output leaf, even
when the derivative is constant or zero. Other output fields remain independently
demandable. A false demanded `require` traps; inactive runtime branches and wholly
unused bindings remain inactive. A value-only use does not demand a direction or
construct derivatives. Numeric input/output validation still happens when the
linearization is prepared, and ordinary staging still checks every source branch.
Unsupported derivative operations are diagnosed when a pushforward is applied
during staging, even when that application's runtime branch would be inactive.
A numeric objective containing a reduction can therefore be used through `.value`
without pretending that its pushforward supports reduction differentiation.

All existing pathwise and exceptional-f64 conventions from
[DIFFERENTIAL-STAGING.md](DIFFERENTIAL-STAGING.md) apply. No algebraic simplification
of zero seeds is promised: NaNs, infinities, and signed zeros follow the existing
JVP expressions, not an idealized real-number linear map. Independent memory
loads keep their demand/bounds checks; active addresses remain rejected when
differentiated. An already-performed host result is an atomic binding, never a
replayable invocation. No returned callable may acquire or hide host authority.

## Representation, bounds, and alternatives

Add one internal `linearized_callable` staging value containing the checked
application operation. Only the closed compiler intrinsic creates it. Extend
ordinary callable selection, guarding, and invocation to this value. Invocation
consumes exactly one direction (unit for the legacy zero-argument spelling) and
uses existing application rules for any remaining arguments. Each invocation is
charged to the existing `maxExpansion` work budget, and every new scalar uses the
existing scalar graph budget. Input/output product sizes remain subject to the
existing source, parser, type, and ABI budgets; no new option bypasses them.
Unlike `grad`, there is no coordinate-basis expansion and no separate 64-leaf cap.

Reuse the current shared preparation and pushforward implementation. Each call
validates its direction and uses the call-site source location for diagnostics,
rather than reporting every failure at the original preparation site. Temporary
roots are substituted before any derivative result reaches Wasm emission. The
saved callable and graph are compiler data only: no guest closure, indirect call,
function table, tape, dual object, or intermediate array is introduced.

A source helper returning `v -> (jvp f point v).tangent` is a useful equivalent
for runtime results, but restages `f` for each application. A runtime closure or
a separately compiled derivative would require new representation and lifetime
contracts. A reverse-mode transform needs a separate adjoint schedule and demand
proof. This change chooses finite compiler-side reuse, without a speedup claim.

`linearize` becomes a reserved intrinsic name. No syntax, dependency, JTE event
rule, ASABI layout, optimization default, or existing JVP/gradient contract
changes. Stream-valued differentiation, reductions/causal graphs in demanded
derivatives, active memory addressing, recursive callables, and implicit host
effects remain unsupported. Previously accepted uses of the name `linearize`
need renaming; this is the only intended source compatibility break.

## Validation plan

Run the unchanged full suite first. Compare multiple directions and product
outputs to independent analytic JavaScript and central finite differences in all
eight SIMD/fusion/memoization configurations. Exercise nested AD, direction
sensitivity, captures, aliases, records/tuples/empty products, polymorphic helpers,
partial intrinsics, selected/guarded callables, legacy application, scalar stream
callbacks, and causal transitions. Check one-time preparation independently of
runtime equality, and verify no callable reaches Wasm or ASABI.

Regression cases must distinguish primal demand from unused output fields,
value-only from applied derivatives, inactive branches from compile-time checks,
and performed values from host invocations. Compare exceptional f64 outputs to
explicit JVPs using `Object.is`; this is compatibility evidence, not an independent
analytic oracle. Test source-local failures, reserved names, active addressing,
expansion bounds, and compiler session isolation. Add shared Node/Chromium cases
and extract the example above directly into a runnable documentation test.

Run `npm test`, the host/reducer/case-study drivers, `npm run test:browser`, and
`git diff --check`. Preserve historical reports, and record actual results and
unavailable checks in a separate validation report before publication.
