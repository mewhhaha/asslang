# Close a pipeline over its previous state

[Machines](CLOCKED-MACHINES.md) · [Sensitivities](MACHINE-SENSITIVITY.md) · [Documentation](README.md)

## Use an existing pipeline as a closed loop

Link `lib/machine-feedback.ass` alongside `lib/machines.ass` and
`lib/reducers.ass`. A body accepts `{input,feedback}`. Close it over an observation
of the **previous state**, without a new state field or stored feedback array:

<!-- feedback-library -->
```ass
// Close a body over an observation of its OLD state. No fixed point or buffer.
// Body ports are {input,feedback}; the state and finish protocol stay unchanged.
fn machine_feedback = body -> observe -> {
  initial: body.initial,
  step: state -> input ->
    body.step state {input, feedback:observe state},
  finish: body.finish,
};
```

In the [quantization example](../examples/case-studies/feedback/quantize.ass), the
first stage adds the residual from the preceding event; the second rounds the
corrected reading. The circuit closes with ordinary composition:

```text
let circuit = correct |> machine_then round;
machine_feedback circuit (state -> state.left-state.right)
```

Eight inputs of 0.25 at unit 1 become `[0,1,0,0,0,1,0,0]`, rather than eight zeros.
The inputs sum to 2, as do the quantized outputs. A returned `{left,right}` state
holds the last corrected and quantized values, so their difference is the residual.
The state can be serialized and supplied to the next call. Resuming at every split
is tested; ordinary JSON need not preserve signed zero or authenticate the model.

`quantize_blocks` applies that same machine in `chunks |> map |> flatten`.
At width 3 it returns `[0,1,0,0,1,0,0,1]`: residuals deliberately restart between
independent blocks, unlike checkpoint continuation. Both forms have one native
loop and two recurrence scalars, without any intermediate array. The closed form
has exactly the same Wasm bytes as explicit port wiring. The checkpoint-only
form needs no result array but still returns a 16-byte state descriptor.

### Feed back the previous output

This complete tracking kernel closes a correction/integration pipeline over its
own output. Its inputs and gain should be suitably scaled finite numbers; it is
a numerical composition example, not a control-system safety or stability check.

<!-- feedback-example: tracking -->
```ass
// A discrete numerical tracker, not a deployed control system.
fn tracking_body = gain -> do {
  let correction = {
    initial:0,
    step:previous -> ports -> gain*(ports.input-ports.feedback),
    finish:x -> x,
  };
  correction |> machine_then (sum_reducer ())
};

export fn tracking = (targets:[Num]) -> (gain:Num) -> (saved:{left:Num,right:Num}) -> do {
  let body = tracking_body gain;
  let closed = machine_feedback body body.finish;
  let history = machine_states_from targets closed saved;
  {
    values:history |> map closed.finish,
    state:history |> fold saved (previous -> next -> next),
  }
};
```

Targets `[1,1,1,1]`, gain 0.5 and zero saved state give
`[0.5,0.75,0.875,0.9375]`. Lifting the closed machine with existing `machine_jvp`
and an input direction `[1,0,0,0]` gives sensitivities
`[0.5,0.25,0.125,0.0625]`. This differentiates the feedback dependency, not a
version with that dependency held constant. The value/tangent state resumes in
exactly the same way. The discontinuous quantizer is not this AD demonstration.

```sh
npm run example:machine-feedback
npm run test:machine-feedback
printf '[[0.25,0.25,0.25,0.25],1,{"left":0,"right":0}]' | node examples/case-studies/app.mjs feedback-quantize
```

The example driver runs quantization, block resets, persistence and the optional
sensitivity program, checking exact output/loop limits. It reports emitted-code
and storage counts, not wall-clock speedups. See
[executed validation](MACHINE-FEEDBACK-VALIDATION.md) for evidence and limitations.

## Design before implementation

Merged main `d47539f51deb935cac721a92bc2ddfa0f044b763` supports source-defined
serial machines, products, held updates, resets, checkpoints and forward
sensitivities. It lacks a named way to close an already composed pipeline over
an observation of its own previous state. Rewriting each closed loop as a custom
scan loses the reusable stages; storing an additional feedback trace is unnecessary.

Add one ordinary source adapter, `machine_feedback body observe`, in
`lib/machine-feedback.ass`. `body` retains the reducer/machine protocol. Its input
has named fields `{input,feedback}`. `observe` maps the previous body state to the
feedback value. The result accepts only the external input and has exactly the
body's initial state, state shape and finish function:

```text
initial = body.initial
step s input = body.step s {input, feedback:observe s}
finish = body.finish
```

This is an old-state read, NOT an instantaneous recursive equation. On event t,
read h(s[t-1]), then compute s[t]=F(s[t-1],(a[t],h(s[t-1]))). `machine_then` still
passes the left stage's NEW observation into the right stage in this same event.
These two timings are intentionally distinct. Passing `body.finish` as `observe`
feeds back the preceding output; another observer can select a residual or a
product of channels. There is no separate delay buffer, initial feedback argument,
fixed-point iteration, runtime closure, new compiler token or primitive.

The starting feedback is h(body.initial), only when demanded by the first step.
Resuming from saved s starts with h(saved). An outer `machine_reset_when` resets
before feedback is read. Resetting a stage inside the open body is different: an
outer feedback observer still sees the pre-reset composite state. Do not silently
commute reset and feedback. Holding the whole closed machine with `reducer_filter`
also holds its feedback state and retains its output clock; filtering the input
stream removes events instead.

## Values, demand and cost

The constructor is ordinary source and may be renamed. It works without the
prelude and composes with machines/reducers/chunks using their existing libraries.
Type inference checks observer/state/port compatibility; scans impose the existing
scalar-product state restriction. Feedback is not a new effect permission or an
escape route for functions/streams across the ABI. The adapter does not validate
application state, finiteness or checkpoint provenance for the caller.

Every closed transition reads one immutable previous-state snapshot. With a
product body, both lanes see that same snapshot even if they feed each other.
Next-state fields keep the existing strict/simultaneous update semantics. An
observer that the body ignores stays undemanded; empty scans run neither an
observer nor a seed. Requested empty final-state folds still demand their seed.
Stopped consumers retain suffix laziness. No Boolean observation is an assertion.

The adapter adds no fields to the recurrence state. Its observation can still
add scalar locals, work, guards, nested reductions or nested machine state. No O(1) observer cost, global memoization,
universal fusion, stability of arbitrary feedback or timing speedup is promised.
Compatible output arrays and final state may share an existing scan cohort;
ineligible consumers retain normal replay. Final output arrays/descriptors and
host copies are not intermediate buffers and still occupy memory.

## Three useful laws, with their hypotheses

**Unrolling and causality.** Let a pure total body have state S, transition
F:S x (A x C)->S, output G:S->B and observation h:S->C. Its closure has transition
Fh(s,a)=F(s,(a,h(s))). This expression is finite and uses only previous state and
current input, so induction uniquely defines every finite prefix from a seed.
The induction also proves equivalence to explicit port wiring. No contractivity
or numerical stability follows: a finite causal recurrence can diverge or overflow.

**Product feedback.** Two body lanes consume the same ports and update their
respective components. An observation of their pair is evaluated on the previous
pair, not a partially updated pair. Substitution into the product transition
proves simultaneous cross-coupling. An in-place left-then-right implementation
that reads the newly written left state is generally different; test a swap as
a counterexample. This is not an arbitrary trace law or permission to commute
callbacks and failures.

**Forward differentiation.** For supported differentiable numeric F,h,G, the
closed state differential is

    ds' = DF(s,(a,h(s))) (ds,(da,Dh(s) ds)).

This is the chain rule for F composed with (s,a)->(s,a,h(s)). Induction over events
proves that lifting the closed machine agrees over reals with closing the lifted
body using a lifted observer, after rearranging product ports. Both the observer's
value and tangent must be routed into the body; treating the feedback tangent as
zero is wrong. This uses the existing source `machine_jvp` and source `jvp`; no
AD rule for scan, reverse tape, or full history Jacobian is introduced. Floating
rounding can distinguish algebraic rearrangements. Captured configuration remains
constant unless supplied/seeded as differentiable input or state.

## Application: preserve small contributions while quantizing

Compose a correction stage with a quantizer; close feedback over the difference
between their previous states. For a positive unit u:

    c[t] = x[t] + e[t-1]
    q[t] = u * floor(c[t]/u + 1/2)
    e[t] = c[t] - q[t].

With zero seed, eight readings of 0.25 and u=1 yield [0,1,0,0,0,1,0,0]. Independent
rounding yields all zeros. The feedback carries the unrepresented contribution
forward rather than storing all input history. Under real arithmetic and an
unbounded quantizer, -u/2 <= e[t] < u/2, and telescoping gives

    sum(q[1..n]) = sum(x[1..n]) + e[0] - e[n].

The prefix-total error is therefore bounded by half a unit for zero residual seed.
This is NOT a bound on each output's error relative to its individual input, nor
a floating-point accuracy theorem or a new compression/ADC algorithm. Tests use
exact dyadic cases for this identity. Arbitrary f64 rounding, subnormal units and
large quotients can violate the real bound. Reject nonfinite arithmetic; do not
saturate or claim that a finite result proves the half-unit bound. Quantizer output
is still Num, not packed bits. The discontinuous quantizer is not given an invented
derivative. A separate smooth tracking example demonstrates feedback sensitivity.

The example should return final state for host checkpointing. Chunk-local use
restarts the residual per chunk, which intentionally differs from continuous
resumption. Document both. Provide an explicit expanded-wiring comparison with
identical Wasm and exact loop/output budgets, not a comparison to a fabricated
allocation-heavy baseline.

## Validation plan and prior work

Check old-state timing, simultaneous cross-coupling, unused observers, empty
input, resets versus inner resets, held events, stopped suffixes, lexical scope,
wrong ports/state types, source locations, effects, core-only/renamed source,
checkpoint splits and independent output storage. Execute quantization examples
against independent dyadic/seeded oracles and the telescoping identity. Check
smooth nonlinear feedback gradients analytically and by whole-recurrence finite
differences, and compare lifting before/after closure with explicit port routing.
Run scalar/SIMD, fusion and memoization combinations, exact loop allowances,
raw/managed/prepared calls, chunk flattening and a long checkpoint-only case.
Retain a cost counterexample for an expensive observer. Register all examples and
real browser checks. Run the full suite, required example drivers and core audit.
Compare current-main corpus bytes/ABI/certificates and all compiler files.
Record executed results separately; never convert planned checks into pass claims.

Feedback combinators and error-feedback quantization have established prior art.
Haskell's ArrowLoop documents feedback via fixed points, which is explicitly NOT
this adapter's old-state operation [1]. Error-feedback quantizers are studied in
[2]; this example is a simple unbounded uniform quantizer, not that paper's filter
optimization, coding scheme or rate-distortion guarantee. Sources checked
September 14, 2026:

[1] https://downloads.haskell.org/ghc/8.2.1/docs/html/libraries/base-4.10.0.0/Control-Arrow.html
[2] https://arxiv.org/abs/1609.01383

This is a small source-level integration with executable laws, not worldwide
novelty, a general recursion feature, a full traced-category implementation, an
independent formal audit, proof-assistant verification or a readability study.
