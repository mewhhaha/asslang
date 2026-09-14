# Clocked machines from ordinary source

Measurements below belong to the original #37 base. See
[publication on current main](CLOCKED-MACHINES-PUBLICATION.md) for fresh #38 integration results.

[Core audit](CORE-AND-PRELUDE.md) · [Reducers](COMPOSABILITY.md) · [Documentation](README.md)

## Use one pipeline as a batch, a step function, or resumable state

These are implemented source helpers, explicitly linked with the existing reducer
library. Compiler callable counts stay at 30 primitives and four prelude functions.
The four new helpers are ordinary functions in [lib/machines.ass](../lib/machines.ass).
They add no runtime machine object or scratch storage.

```sh
npm run example:clocked-machines
npm run test:clocked-machines
printf '[[0,8,8,0],0.5]' | node examples/case-studies/app.mjs clocked-shared-prefix
node src/cli.mjs examples/case-studies/machines/block_cascade.ass --lib lib/reducers.ass --lib lib/machines.ass --no-prelude --run block_cascade --args '[[1,2,3,4,5,6,7],3]'
```

### Factor a stateful prefix before branching

Smooth once, then send that updated signal into both a running total and a peak
observer. The intermediate smoothed array is never constructed:

<!-- clocked-example: shared_prefix -->
```ass
fn smooth_signal = alpha -> {
  initial: 0,
  step: mean -> value -> mean+alpha*(value-mean),
  finish: mean -> mean,
};
fn peak_signal = () -> {
  initial: 0,
  step: peak -> value -> max peak (abs value),
  finish: peak -> peak,
};

// One smoothing state feeds two observers. No smoothed array is stored.
export fn shared_prefix = (samples:[Num]) -> (alpha:Num) -> do {
  let observers = reducer_product (sum_reducer ()) (peak_signal ());
  let machine = smooth_signal alpha |> machine_then observers;
  let history = samples |> machine_states machine;
  {
    totals: history |> map (state -> (machine.finish state).left),
    peaks: history |> map (state -> (machine.finish state).right),
    summary: machine.finish (history |> fold machine.initial (previous -> next -> next)),
  }
};
```

For `[0,8,8,0]`, alpha 0.5, totals are `[0,4,10,13]`, peaks are `[0,4,6,6]`,
and summary is `{left:13,right:6}`. This example assumes suitably scaled finite
inputs; it is a composition demonstration, not a certified signal estimator.
The source-defined smoothing recurrence starts from zero, not from the first input.

The important grouping is `smooth_signal alpha |> machine_then observers`.
Putting a separate smoother in each observer branch gives the same results for
these total steps but duplicates smoothing state and work. The driver executes
both forms. On this fixture each emits one loop and needs exactly four loop units
and 64 final-array bytes, with zero intermediate buffers. Sharing reduces numeric
state slots **4 to 3**, all Wasm local-value bytes **288 to 224**, and module size
**2,192 to 2,143 bytes** with the four-unit allowance. Local-value bytes describe
emitted locals, not measured physical registers or a native stack allocation.
The three numeric recurrence slots represent 24 bytes, versus 32 for four slots;
other locals, final storage and host copies are additional.

This is explicit source factoring, not automatic merging of independent machines.
The value/state relation proving it is below. It is not a timing benchmark.

### Hold independent updates without losing event alignment

A validity bit selects whether a lane updates. Both lanes still produce a value
on every original input event. The existing `reducer_filter` supplies this held
update behavior; a new `machine_hold` primitive or library alias is unnecessary.

<!-- clocked-example: held_channels -->
```ass
// The validity bit gates the update, NOT the output clock.
fn held_total = project -> enabled -> {
  initial: 0,
  step: total -> value -> do {
    let next = total+value;
    require (value-value == 0 && next-next == 0) next
  },
  finish: total -> total,
}
  |> reducer_map_input project
  |> reducer_filter enabled;

export fn held_channels = (left:[Num]) -> (leftValid:[Bool]) ->
  (right:[Num]) -> (rightValid:[Bool]) -> do {
    let rows =
      zip_checked left leftValid (value -> valid -> {value, valid})
      |> zip_checked (zip_checked right rightValid (value -> valid -> {value, valid}))
        (left -> right -> {left, right});
    let machine = reducer_product
      (held_total (row -> row.left.value) (row -> row.left.valid))
      (held_total (row -> row.right.value) (row -> row.right.valid));
    let history = rows |> machine_states machine;

    {
      left: history |> map (state -> state.left),
      right: history |> map (state -> state.right),
      state: history |> fold machine.initial (previous -> next -> next),
    }
};
```

For left `[1,99,3,99]` with validity `[true,false,true,false]` and right
`[99,20,99,40]` with `[false,true,false,true]`, outputs are `[1,1,4,4]` and
`[0,20,20,60]`. The final state is `{left:4,right:60}`. Disabled values can even
be NaN/infinity when called through the JS ABI; validation is inside the enabled
update. Enabled invalid values or a nonfinite accumulated total trap. The JSON
CLI cannot represent NaN/infinity. Length mismatches still fail `zip_checked`.

The fixture uses one loop, two numeric state slots, four units and 64 final-array
bytes. Its three runtime zip checks establish alignment among four input arrays;
holding lanes introduces no further length guess or alignment cast. This is a
shared input-event clock, not interpolation or an asynchronous/timestamp join.

### Reset the whole pipeline at symbolic block boundaries

A complete composed machine can be the callback of a chunk program:

<!-- clocked-example: block_cascade -->
```ass
// Both stages reset together at each symbolic block boundary.
export fn block_cascade = (samples:[Num]) -> (width:Num) -> do {
  let cascade = sum_reducer () |> machine_then (sum_reducer ());
  samples
  |> chunks width
  |> map (block -> block |> scan_with cascade)
  |> flatten
};
```

On `[1,2,3,4,5,6,7]` with width 3, it returns `[1,4,10,4,13,28,7]`. Each stage
restarts in each block. One loop, two state slots and exactly seven loop units
produce the 56-byte result. No block arrays, segment descriptors or intermediate
prefix arrays are allocated. Flattening retains the source event cover, so this
result can be zipped with the original source without a runtime alignment check.

### Resume without changing the reset target

The [complete monitor](../examples/case-studies/machines/resumable_pipeline.ass)
composes smoothing with hysteresis, then adds event resets. Both stages live in
one inferred product state `{left:mean,right:alarm}`. `machine_states_from` starts
from a checkpoint without replacing the configured initial state of either stage.

The example driver processes `[0,8,8,0]` with alpha 0.5, low 3 and high 6. It
saves `{left:3,right:false}` and the configuration through JSON. Resuming with
`[8,0]` and reset flags `[true,false]` produces means **`[4,2]`**, not `[5.5,2.75]`:
the first new event resets to the configured zero seed before being processed.
Full-array and every tested split execution agree exactly. Empty chunks keep the
provided checkpoint. Any shape-correct finite checkpoint is accepted; the caller
must keep its configuration and semantics consistent. No authentication, epoch,
version enforcement or reachability proof is implicit in the generic library.

The monitor returns means, alarms and state with one loop on the six-event fixture:
exactly six units and 72 array bytes. Its config guard is on the source stream,
so it is enforced even for empty input while remaining compatible with output
fusion. A mandatory guard attached separately around each finished scalar result
can instead prevent a cohort; equivalent-looking source placement is not a blanket
fusion guarantee. No compiler rule was changed to obtain the shared schedule.

`machine.step saved event` is also an ordinary callable for one-event execution;
a test drives a composed machine that way with **zero loop units** and matches
its batch scan. Host call overhead is not eliminated. The state is ordinary data;
functions and protocol dictionaries stay on the compiler side of the ABI.

### The library boundary

<!-- machine-library-source -->
```ass
// Ordinary source, using the same {initial,step,finish} protocol as reducers.
// Pairing/adaptation/held updates already live in lib/reducers.ass.
fn machine_then = left -> right -> {
  initial: {left:left.initial, right:right.initial},
  step: state -> input -> do {
    let next = left.step state.left input;
    {left:next, right:right.step state.right (left.finish next)}
  },
  finish: state -> right.finish state.right,
};

// Reset to the DECLARED initial state, then process the current event.
fn machine_reset_when = machine -> reset -> {
  initial: machine.initial,
  step: state -> input ->
    machine.step (if reset input then machine.initial else state) input,
  finish: machine.finish,
};

// Histories are sequential plans, not stored arrays of state records.
fn machine_states = inputs -> machine ->
  scan inputs machine.initial machine.step;

// Starting from a checkpoint does not change an enclosed reset's target.
fn machine_states_from = inputs -> machine -> state -> do {
  // Check seed/transition compatibility without demanding the declared seed.
  let initial_step = machine.step machine.initial;
  scan inputs state machine.step
};
```

Only four helpers are added. Input/result mapping, products, held updates and
observation use the existing reducer library. The unused partial application in
`machine_states_from` couples the seed and transition types at inference; tests
show it emits the exact bytes of a plain resumed scan and never evaluates a
trapping declared seed. A reset may still demand that seed on a later event.
This type check does not validate a checkpoint's value or provenance.

### Do not hide the expensive-callback case

The driver also replaces smoothing with a synthetic stateful range reduction.
With `[2,3,1]`, the existing multi-output planner cannot form a cohort: the traces
and summary run three traversals. Shared-prefix factoring then costs **27 loop
units**, versus **45** for duplicate prefixes, with respectively six and nine
loop sites. Both have zero intermediate buffers and produce the same result.
This is an intentional cost probe, not a useful smoothing formula or a claim of
universal one-pass composition. The compiler, nested-loop policy and limits stay
unchanged. Fusion disabled also replays the simple multi-output reports.

[Executed checks](CLOCKED-MACHINES-VALIDATION.md) distinguish measured counts,
value laws, representation arguments and the remaining execution limits.

## Design before implementation

Base: merged main `12754f5b69e297d9422205bd1205ff08b8ed142a`, tree
`de77cb80d30ada9751252a785e6b255dce6576ed`. The supplied prelude archive reproduces
this exact tree. The previous audit calls for stronger source composition rather
than another algorithm-specific compiler primitive.

The existing reducer protocol already describes a state machine:

    {initial : S, step : S -> A -> S, finish : S -> B}

`scan_with` observes its updated state at every accepted input event; `reduce_with`
observes only its final state. `reducer_product`, input/output adapters and
`reducer_filter` already compose parts of that protocol. Reuse them. Do not add
a second product/hold API or rename a compiler operation as a source helper.

What is missing is serial stateful composition and a reusable way to reset and
resume its *whole state*. Add `lib/machines.ass` with `machine_then`,
`machine_reset_when`, `machine_states`, and `machine_states_from`. The protocol is
structural, inferred, and identical to that of the existing reducer library. The
library is explicitly linked, not an implicit prelude expansion or builtin.
No file under `src/`, ABI, compiler inventory of callable names, resource limit,
syntax token, guest allocator, host permission, or dependency needs changing.

## Clock and observation contract

A machine performs one update per accepted source event and observes the new
state. Initial state is not an extra event. State contains only Num/Bool or their
finite nested products when used by scan; functions stay staged. For a finite
input sequence x, define

    s[0] = initial
    s[i+1] = step(s[i], x[i]); output[i] = finish(s[i+1]).

This equation describes values when the functions are total. Actual runtime
observation remains demand-directed: every next-state component is evaluated,
but an unused observation/field is not automatically forced. A source helper
gains no effect authority. A scan remains sequential, retains the input event
domain/density, and creates no retained history buffer by being named.

The existing `reducer_filter m enabled` holds m's state when disabled. Under a
scan it does NOT remove the event: the held state is still present on the source
clock. This is different from `filter xs enabled |> scan ...`, which changes the
clock and emits fewer outputs. Two independently held lanes can form one product
and emit aligned observations without an intermediate mask, split array, held
array, or checked zip based on coincident lengths. This is synchronous input-event
alignment, not timestamp alignment, asynchronous joining or watermark processing.

Holding a state does not suppress the scan's initial seed. A nonempty source
initializes all product state even if no lane updates; a truly empty source does
not initialize a scan. A final-state fold with an explicit initial fallback DOES
demand that fallback on empty input. Initial observations and checkpoints must be
valid when the chosen consumer asks for them. Do not confuse these runners.

## Serial composition and state ownership

For machines M:S x A -> S with observation h:S -> B, and N:T x B -> T with
observation k:T -> C, the combined state is (S,T). One transition is

    s' = M.step(s, a)
    t' = N.step(t, h(s'))
    result = (s', t'); observe(result) = k(t').

`machine_then M N` owns that pair, not the intermediate array h(s'). Staging
inlines the step and observation into one ordinary product-state scan. A previous
left state cannot be read accidentally by the right update: the source binds s'
and feeds its observation to N. A held left lane still feeds its current held
observation to the right on every source event. To hold BOTH stages, wrap the
whole composition in `reducer_filter`; these spellings are intentionally different.

Existing `reducer_product M N` advances both on the same input and observes the
pair. Existing `reducer_map_input` and `reducer_map_result` adapt its boundaries.
No special machine syntax, dynamic closure, type class, implicit buffering or
new clock witness is introduced. Serial composition is not composition of final
reductions: a finish function now used by the next stage may execute at each
event, not once at the end. Its work/traps cannot be treated as free.

### Associativity with an explicit state isomorphism

`(M then N) then P` stores `{{s,t},u}`; `M then (N then P)` stores `{s,{t,u}}`.
Relate them by reassociation R((s,t),u)=(s,(t,u)). Their initial states are related.
At an event a, both compute the same s', then t' from h(s'), then u' from k(t').
Their next states are related by R and their observations are equal. Induction
on events proves equal output sequences and related final checkpoints. This uses
no associativity of floating-point addition: the arithmetic inside each step is
unchanged, only the nesting of the state container differs.

This is a bisimulation/value law for the stated total machine model, not an
automatic optimizer rewrite or a full Haskell Arrow instance. State checkpoints
are exposed as ordinary products, so differently parenthesized states have
DIFFERENT layouts; transport them explicitly. There is no hidden existential
state type or universal identity/lifting operation in this API. Partial
observations, different consumers and exact compilation/loop costs require their
own checks rather than following from the total-value argument.

### Share a stateful prefix before branching

`P then product(Q,R)` and `product(P then Q,P then R)` have the same observations
for identical initial P copies and total pure transitions/observations. Relate
state `(p,(q,r))` to `((p,q),(p,r))`. Both copies of P receive the same event and
remain equal by induction; Q/R receive the same observed p'. This relation proves
output equality and corresponding final states, not equality of stored layouts.

The first spelling stores P once, while the second stores it twice. With scalar
state sizes p,q,r, the totals are p+q+r and 2p+q+r. Shared prefix work is performed
once in the first state transition; an expensive observation still has its own
demand/work cost. Test a smooth-then-total-and-peak pipeline against the duplicated
prefix and an imperative oracle. Preserve independent source machines rather than
teaching the compiler to collapse coincident histories automatically. This law is
not an optimizer rule when partial work, effects, budgets or observed checkpoints
can distinguish the programs.

## Reset and resume are distinct operations

`machine_reset_when m reset` selects m.initial when reset(input) is true, then
applies m.step on that SAME event. It does not insert an event or evaluate a
reset on empty input. The configured initial state is the reset target. Reset tests are ordinary pure
expressions, not implicit assertions: a step that ignores its previous state
can leave the reset predicate undemanded. Mandatory validation still needs
`require` on a demanded state/value or a structural stream guard.

`machine_states_from xs m saved` instead starts this invocation's scan at saved.
It does not replace m.initial or capture saved inside m.step. An unused partial
application `machine.step machine.initial` is checked normally to connect the
declared seed type to the transition type; it never runs the seed or a step.
The resumed scan then constrains saved to that same state type. This is source
checking, not a new compiler intrinsic or a runtime validity assertion.
Consequently a reset
inside a resumed pipeline still targets the configured initial state, NOT the
last checkpoint. Configuring a reset after a state-replacement helper could easily
make that mistake; the API avoids such a helper altogether.

Wrapper order is part of the program. Reset outside a held machine resets even
when that event's transition is disabled. Holding the resettable machine outside
instead suppresses both reset and transition on disabled events. Add a minimal
executable counterexample and do not present the wrappers as commuting operators.

For fixed machine configuration and a pure step, running xs++ys from s is equivalent
to running xs from s and ys from its final state. Induction on ys establishes the
same ordered operations and exact f64 values, not a reassociated reduction. Test
every split, including empty pieces, combined with resets and held lanes. The
host must preserve the state and configuration. JSON is demonstrated only for
finite sample states; generic JSON does not preserve NaN/infinity or signed zero.
A shape-correct saved state is not proof of reachability, matching configuration,
authenticity, or integrity. No authentication/checkpoint service is added.

## Useful examples and expected execution

1. Two quality-gated measurement lanes accumulate independently but emit on a
   shared event clock. Return both traces and final state in one existing output
   cohort. Project/validate a measurement INSIDE its enabled step so a disabled
   invalid payload is not read, while enabled invalid data still traps.
2. Compose smoothing and hysteresis once, execute it on a whole array or resume
   from a scalar-record checkpoint, and preserve resets across boundaries.
3. Share a smoothing prefix before a product of total/peak observers, compared
   with duplicating that prefix in each branch.
4. Run a composed two-stage accumulator inside `chunks |> map |> flatten`, so
   block boundaries reset the whole product-state pipeline, without child arrays.

Compare each to an independently written imperative oracle. Compare serial
source machines to two ordinary chained scans where meaningful, without promising
fewer buffers than an already fused baseline. Register every new example in the
normal corpus, which also exercises actual Chromium compilation/execution.
Expose full source snippets from the exact files and execute the documented CLI.

For a fixed machine with P scalar state leaves and n input events, compiler-owned
state is O(P) and a constant-time step uses O(n) work. Observe/store only final
requested outputs: k numeric traces cost 8kn bytes plus final descriptors and
state fields; input and host copies are additional. For qualified dense outputs,
existing output fusion can share one loop between multiple traces and a final
fold. Fusion disabled may replay the state machine, with unchanged values but
different loop allowances. Sparse and stopping consumers retain existing policies.
A transition with a nested reduction can make a multi-output cohort ineligible,
even though its output is dense. Then the current writer replays each consumer.
The explicit synthetic probe (replacing smoothing by a stateful range reduction)
must test this fallback as well as sharing inside one traversal. Do not change
the compiler or advertise a universal single-pass runner to hide the distinction.
There is no general fan-out cache or promise that arbitrary finish functions or
nested reductions are constant-time. All source expansion/loop bounds still apply.

## Validation plan and compatibility

Run the unchanged baseline first. Then run full Node, focused source/law/demand
checks, documentation, required host/reducer examples and available browser suites.
Check current corpus binaries, ABI and JTE certificates against the actual
baseline snapshot. The compiler is unchanged; no new primitive should appear in
`audit:core`. Explicit renamed library functions and core-only compilation must
work, proving this is a library mechanism rather than body recognition.

Cover serial associativity with checkpoint transport, product independence, wrapper
order, exact chunk split/resume, lazy unused states/seeds/observations, strict
next-state fields, disabled-invalid data, held versus filtered clocks, early
stopping, sum cancellation/signed zero, reset during resumed operation, type/shape
and source-location errors, forbidden host calls, snapshots and memory ownership,
exact output/work capacities and failure recovery in all eight lowering modes.
Report measured local counts, not a guessed speedup or unrun remote CI pass.

## Prior art and claim boundary

State-machine composition and arrow-style libraries have substantial prior art.
Hughes's *Generalising Monads to Arrows* (2000) establishes a reusable composition
interface; the Haskell Arrow documentation makes the algebraic laws explicit.
Asslang already has example-level machine products and selective `connect`, and
its reducer library already has product and hold transitions. This PR builds on
those, rather than claiming to invent them.

- https://www.sciencedirect.com/science/article/pii/S0167642399000234
- https://www.haskell.org/arrows/
- https://downloads.haskell.org/ghc/8.2.1/docs/html/libraries/base-4.10.0.0/Control-Arrow.html

References checked September 14, 2026. The contribution here is tested reusable
source composition with explicit shared clocks, reset targets and resumable state,
not a new category, a full FRP system, historical novelty, automatic proof
synthesis, empirical readability study or independently audited compiler proof.

## Compose with differentiation

The optional [machine JVP adapter](MACHINE-SENSITIVITY.md) lifts a numeric
transition before scanning it. A composed pipeline can therefore carry both
value and sensitivity state in one traversal, with no reverse-mode tape or
compiler rule for differentiating scans. Boolean state and arbitrary loop-valued
steps do not become differentiable. The linked adapter is separate from this
core-only library.
