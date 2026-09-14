# Differentiate a machine, then scan its state

Measurements below belong to the original #37 base. See
[publication on current main](CLOCKED-MACHINES-PUBLICATION.md) for fresh #38 integration results.

[Clocked source machines](CLOCKED-MACHINES.md) · [Core/prelude](CORE-AND-PRELUDE.md)

## Run the source-only sensitivity pipeline

```sh
npm run example:machine-sensitivity
npm run test:machine-differentials
```

The adapter is nine lines of ordinary source; `jvp` itself is source from the
previous core/prelude change:

<!-- machine-jvp-source -->
```ass
// Optional source adapter. Uses the prelude's jvp; no stream AD intrinsic.
fn machine_jvp = machine -> initial_tangent -> {
  initial: {value:machine.initial, tangent:initial_tangent},
  step: state -> input ->
    jvp (p -> machine.step p.state p.input)
      {state:state.value, input:input.value}
      {state:state.tangent, input:input.tangent},
  finish: state -> jvp machine.finish state.value state.tangent,
};
```

The complete named example source is:

<!-- sensitivity-kernel-source -->
```ass
fn sensitivity_smooth = alpha -> {
    initial:0,
    step:mean -> value -> mean+alpha*(value-mean),
    finish:mean -> mean,
  };
  export fn sensitivity = (samples:[Num]) -> (directions:[Num]) -> (alpha:Num) ->
    (saved:{value:{left:Num,right:Num},tangent:{left:Num,right:Num}}) -> do {
      let pipeline = sensitivity_smooth alpha |> machine_then (sum_reducer ());
      let lifted = machine_jvp pipeline {left:0,right:0};
      let events = zip_checked samples directions (value -> tangent -> {value,tangent});
      let history = machine_states_from events lifted saved;
      {
        values: history |> map (state -> (lifted.finish state).value),
        sensitivities: history |> map (state -> (lifted.finish state).tangent),
        state: history |> fold saved (previous -> next -> next),
      }
    };
```

Use zero for all fields of `saved`, samples `[0,8,8,0]`, directions `[1,0,0,0]`
and alpha 0.5. `values` is `[0,4,10,13]`; `sensitivities` is
`[0.5,0.75,0.875,0.9375]`. Each sensitivity describes that output's response to
an infinitesimal perturbation of the FIRST reading, not the current reading.
The returned state has value `{left:3,right:13}` and tangent
`{left:0.0625,right:0.9375}`. Preserve both when resuming.

The driver checks exact four-unit traversal and 64 output-array bytes (one less
fails), with **one loop, four scalar recurrence slots, zero intermediate buffers**.
The default four-unit module is 4,064 bytes, including 2,683 bytes of ABI metadata;
its 520 local-value bytes include all emitted locals, not just recurrence state.
There is no timing benchmark or promise about machine registers. Output arrays,
the checkpoint descriptor, input arrays and host copies still need storage.
With output fusion disabled, three consumers replay the scan: twelve loop units
and twelve emitted recurrence slots rather than four. This is existing scheduling,
not a change in mathematical sensitivity or a hidden optimization guarantee.

Selecting only the final `.state` through an ordinary private report helper
removes both traces. The driver executes that variant with zero output-array
allowance: **one loop, four state slots, no intermediate buffers**, and a 32-byte
result descriptor. Its four-unit module is 3,081 bytes. Tests run the same
checkpoint-only shape up to 4,096 events; state size stays fixed. Inputs still
come from host arrays, so this is a constant-state computation, not a constant-
memory end-to-end input system. The full trace variant remains available when
per-event results are useful.

A captured alpha is constant for this derivative. For alpha sensitivity, carry
`{x,alpha}` in the event's `value` and seed `{x:0,alpha:1}` in its `tangent`.
An executable test checks this separately. One direction per run does not give
the entire input-history Jacobian at constant cost.

The example has no blanket finite-input or stable-estimator guarantee. It follows
ordinary f64 arithmetic and existing JVP rules. Shape-correct checkpoints can be
supplied by callers; no authenticity or configuration identity is verified.

## Design before implementation

The source-machine protocol exposes a pure single-event transition. Lift that
transition with the existing source `jvp`, then use the existing scan runner on
its augmented value/tangent state. This permits online forward sensitivities
without differentiating `scan` in the compiler and without storing a reverse tape.
It is an optional ordinary source library, not a new intrinsic or AD rule.

`machine_jvp machine initial_tangent` uses state `{value:S,tangent:S}`, input
`{value:A,tangent:A}`, and observation `{value:B,tangent:B}`. S, A and B must be
accepted nonempty numeric products with the usual AD shape/graph restrictions.
A separate `lib/machine-differentials.ass` keeps the core-only base machine library
independent of the prelude. Default compilation supplies `jvp`; core-only clients
must explicitly link `lib/prelude.ass`. An unused definition still type-checks.

For step F:S×A→S and observation H:S→B, the lifted transition is

    s' = F(s,a)
    ds' = D F(s,a) (ds,da)
    y = H(s')
    dy = D H(s') ds'.

Both old-state and event tangents are supplied explicitly. Captured parameters
are constant for these derivatives unless a caller includes them among state or
input variables and supplies their tangents. An initial tangent is the tangent
of the provided initial state, not an inferred derivative of its construction.
This computes ONE directional derivative per run, not the full Jacobian with
respect to an arbitrarily long input history.

## Composition and proof obligations

Induct on the finite input prefix. The base augmented state contains the supplied
primal and tangent. If its tangent is the derivative of the previous state along
the chosen initial/input perturbations, the chain rule for F gives the next-state
tangent above. Applying H gives the next output derivative. Thus a scan of lifted
steps is the forward directional derivative of the unrolled discrete recurrence,
where F and H are differentiable and their graphs have the implemented derivatives.
Floating-point execution implements those formulas, not exact real arithmetic.

Lifting also commutes with serial machine composition, up to rearranging state:

    {value:{left:s,right:t},tangent:{left:ds,right:dt}}
       <-> {left:{value:s,tangent:ds},right:{value:t,tangent:dt}}.

The left tangent evolves through F, the emitted tangent through H, and the right
transition receives both that updated value and its tangent. Applying the chain
rule to the combined transition gives the same mathematical pair. Prove the
state relation per step, then induct on events. This is not a universal byte-
equality or bit-equality law: differently staged derivatives may round differently.
Tests must compare both compositions and an independent analytic/finite-difference
oracle, not merely two calls to the same lifted implementation.

Checkpointing retains BOTH value and tangent state. The ordinary scan split law
then applies without replaying prior input. A checkpoint with a new tangent means
a new sensitivity initial condition. Restoring only the value loses sensitivity
history. No generic JSON codec, authentication or parameter versioning is implied.

## Storage, demand and scope

For P numeric state leaves, the lift has 2P recurrence leaves for one direction.
Its per-event graph is statically expanded by the existing bounded AD machinery.
State size does not grow with the event count; intermediate histories need not be
stored. Materialized output arrays, input direction arrays, ordinary host snapshots
and compiler graph storage are additional memory. No reverse-mode tape or allocator
is introduced, but this is not an allocation-free embedding or O(1)-memory input API.
Existing loop budgets count scan traversal; bounded straight-line derivative work
is not metered as individual arithmetic instructions. Nested callbacks may still
prevent output fusion, and separate consumers can replay existing traversals.

No derivative of `scan`, `fold`, `sort_by` or arbitrary host calls is added. A
machine whose step uses unsupported graph operations still fails the existing AD
check. Boolean state/input/output is not automatically differentiable. Branches
retain current pathwise AD conventions, not a claim of smoothness at boundaries.
The generic lift adds no finite-value guard or numerical-stability guarantee.

Whole lifted scans keep ordinary demand, provenance and sequential-access rules.
A dead scan remains dead, an empty scan has no transition, and a stopped scan need
not visit a later bad event. Returning a checkpoint uses the explicit fallback
state on empty input. All helper records and functions are compiler-side values;
only supported scalar/array projections may cross the ABI.

## Planned demonstration and validation

Compose zero-seeded smoothing at alpha=0.5 with a cumulative total. Readings
[0,8,8,0] have outputs [0,4,10,13]. Perturb only the first reading with direction
[1,0,0,0]. The derivative outputs are [0.5,0.75,0.875,0.9375]. The final cumulative
sensitivity is 1-(1-alpha)^4. Compare with an imperative analytic oracle and
finite differences of the WHOLE primal recurrence. Check intermediate and initial
state tangents, nonlinear steps, both forms of serial composition, every split,
empty input, shape/effect/unsupported-operation failures, core-only linking,
exact loop/output capacities, and real browser execution across lowering modes.

The AD kernel remains a named JS-held source fragment, following existing project
practice: the normal corpus interpreter does not implement differentiation.
Independent derivative tests and dedicated browser checks cover it. Do not skip
or extend unsupported interpreter behavior merely to register the AD example.
Record actual measurements and completed checks before publication.

## Prior work

Forward propagation and Jacobian-vector products are established techniques.
JAX's primary documentation describes their pushforward interpretation and
composition; it is context, not a dependency or evidence for this implementation:
https://docs.jax.dev/en/latest/jacobian-vector-products.html
https://docs.jax.dev/en/latest/_autosummary/jax.jvp.html
Checked September 14, 2026. This contribution composes existing Asslang mechanisms
in source. No new AD algorithm, worldwide novelty, automatic differentiation of
all stream programs, independent audit or proof-assistant verification is claimed.

[Executed checks and limitations](CLOCKED-MACHINES-VALIDATION.md) cover the
shared-clock library and this optional lift together.

## Numerical boundary observed in the long-prefix test

For an impulse followed by 4,095 zero directions at alpha 0.5, the original
step graph propagates `dm + 0.5*(0-dm)`. At the least subnormal, its half correction
rounds to zero and the tangent remains `Number.MIN_VALUE` (approximately 4.94e-324).
The algebraically simplified oracle `(1-alpha)*dm` instead underflows to zero.
The 4,096-event regression records both results explicitly in every lowering mode;
it does not silently alter AD, reassociate arithmetic, or accept a wide tolerance.
The accumulated output tangent agrees at 1 in that case. The real-arithmetic
chain-rule argument is not a guarantee of accurate arbitrarily tiny derivatives.
