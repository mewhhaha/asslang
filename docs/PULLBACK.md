# Reusable reverse pullbacks

## Problem and public contract

`vjp f point weights` prepares an objective and performs one reverse sweep.
Repeating it repeats preparation and reverse-graph analysis. Add a compiler-side
reusable counterpart to forward `linearize`:

```text
pullback : (a -> b) -> a -> {value: b, pullback: b -> a}
```

The point and objective result must be finite numeric scalars, records, or tuples.
Weights have the objective's output shape; each application returns a cotangent
with the point's input shape. Empty products retain the rules of VJP. Inference
checks exact shapes and staging checks numeric leaves. `pullback f point` is not
an escaping runtime closure. Bind it inside the language, project `.value`, or
apply `.pullback` before returning a numeric result through ASABI 1.

Each application has the derivative arithmetic and demand semantics of
`(vjp f point weights).cotangent`. It does not enumerate input coordinates,
construct a full Jacobian, or change the existing forward-mode `grad` algorithm.
The intrinsic itself supports partial application. Saved pullbacks support
helpers, internal records, finite callable choices, guards, and scalar stream
callbacks. Numeric results compose with JVPs, gradients, VJPs, forward
linearizations, and other pullbacks, including differentiation of the weights.

## Example: reuse one response for two objectives

```ass
fn response = p -> {energy: p.x*p.x + 3*p.x*p.y, balance: p.x-p.y};
export fn sensitivities = (point:{x:Num,y:Num}) -> do {
  let local = pullback response point;
  {value: local.value,
   energy: local.pullback {energy:1,balance:0},
   weighted: local.pullback {energy:2,balance:5}}
};
```

At `{x:2,y:4}`, this returns value `{energy:28,balance:-2}`, energy sensitivity
`{x:16,y:6}`, and weighted sensitivity `{x:37,y:7}`. The two weight sets reuse
one objective preparation and one reverse-graph analysis. This is not an
optimizer or an exactly-once runtime evaluation guarantee.

## Demand, authority, and staged validation

Numeric inputs and outputs are checked during preparation. Reverse graph
validation is deferred until the first staged application, then its immutable
node order and root-reachability information are reused. A value-only use can
therefore expose a numeric reduction objective without claiming that its reverse
derivative is supported. Once a pullback application appears in staged source,
unsupported derivative operations are diagnosed even in an inactive runtime
branch. The diagnostic belongs to that application site. Existing `vjp` remains
eager about reverse validation, including for `.value` projections.

Every demanded cotangent leaf retains every numeric primal-output demand, even
for an ignored input or a zero weight. Zero weights are not demand masks. Primal
value fields themselves remain independently demandable. Unused input fields,
weights on structurally absent derivative paths, unused bindings, and inactive
branches keep the existing VJP behavior. Empty streams do not execute trapping
callbacks or initialize unused causal state.

Reuse [VJP.md](VJP.md)'s full-expression activity gates, short-circuit control,
accumulation order, stop-gradient boundaries, and exceptional-f64 rules without
numeric simplification. Reverse results can differ from forward results in
rounding, overflow, signed zero, and NaNs; no new equivalence to forward AD is
promised. Repeated applications must not leak adjoints or weights into one
another, even when they share graph nodes or use opposite runtime branches.

Fresh tagged roots keep aliased point fields independent. Captures are constant
relative to this transform, but retain enclosing perturbation identities. Saved
graphs never treat an already-performed host result as a replayable invocation.
One-call capabilities, JTE event domains, and causal access rules are unchanged.
No implicit authority is attached to the saved callable.

## Representation and alternatives

Extract reverse-graph analysis and seeded accumulation from the existing VJP
implementation. The prepared object saves the tagged objective, replacements,
and numeric primal result. Its first application builds a checked reverse plan;
subsequent applications reuse that plan with fresh adjoint maps. The plan never
stores application-specific weights or adjoints. All temporary roots are
substituted before scalar emission. Ordinary VJP uses these same analysis and
accumulation functions while retaining its existing validation order.

Reuse the existing compiler-only `linearized_callable` representation, whose
unary application mechanism also fits a reverse pullback. No new callable
representation, runtime function table, indirect call, closure, tape, dual
object, intermediate buffer, or Wasm instruction is needed. No new dependency,
syntax, ASABI layout, or optimization default is introduced.

An ordinary helper `weights -> (vjp f point weights).cotangent` can produce the
same numeric result but repeats objective staging and graph analysis. A cached
symbolic weight graph could avoid constructing each reverse sweep, but would
need a separate substitution and resource proof. Runtime tapes or closures need
new lifetime/representation contracts. This change instead reuses only the
objective and checked reverse plan and still performs one sweep per application.

## Compatibility and bounds

`pullback` becomes a reserved intrinsic name; declarations using it must be
renamed. Existing `vjp`, `grad`, `jvp`, and `linearize` signatures and derivative
rules remain unchanged. Function values, including a complete `{value,pullback}`
record, cannot escape through ASABI. Stream-valued inputs/outputs, demanded
reduction/causal-graph derivatives, active memory addressing, recursion, and host
differentiation remain unsupported.

Each saved-callable application uses ordinary invocation and consumes existing
staging work, even when generated scalar nodes are interned. Reverse plans and
per-application adjoint maps are bounded by the staged objective; all generated
scalars use `maxExpansion`. Existing parser, type, source, and ABI limits remain.
There is no 64-coordinate cap because reverse mode does not enumerate a basis.
Repeated preparations create distinct plans, not global or cross-session caches.
No whole-compiler complexity or throughput claim is made.

## Validation plan

Run the unchanged Node suite first. Compare repeated scalar/product pullbacks to
independent analytic derivatives and central finite differences across all eight
SIMD/fusion/memoization combinations. Check VJP schedule compatibility with
`Object.is`, including signed zero, NaNs, and infinities. These compatibility
checks are not independent numeric derivative oracles.

Check preparation and plan reuse separately from numeric equality; verify fresh
adjoints across applications. Cover aliases, nested/empty products, tuple field
ordering, polymorphic helpers, finite choices, guarded callables, legacy units,
weight derivatives, mixed forward/reverse Hessian-vector products, stream
callbacks, nested traversals, causal captures, and one-call host capabilities.
Test demanded/unused output guards, inactive singular coefficients, zero weights,
value-only unsupported objectives, source-local failures at application sites,
ABI/authority rejection, reserved names, >64-leaf inputs, low expansion budgets,
and compiler-session isolation.

Add shared Node/Chromium cases, execute the documentation example directly, and
leave the independent corpus evaluator unchanged. Run `npm test`, a focused AD
command, all three example drivers, the example build, Chromium engine checks,
and `git diff --check`. Record actual outcomes and limitations in a new report;
do not rewrite historical validation or benchmark evidence.
