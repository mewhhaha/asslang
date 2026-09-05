> Integration note: opt-in reduction cohorts can now share a causal schedule
> across independent scalar/record reductions when the exact ordered machine IDs
> also agree. Different histories and iteration-local reductions are not fused.
> The default replay semantics remain unchanged. See REDUCTION-FUSION.md.

# JTE 1: causal observations and scalar machines

Asslang 0.2 extends the Jacob Torrang encoding from event alignment to access and
execution constraints. It adds scan, selective transduction and bounded iteration.
The observation certificate is `jte-1-causal`; the binary ABI stays ASABI 1.

## Observe capabilities rather than putting lengths in types

The ordinary stream type is `[a]`. For a particular staged value the compiler
derives `(event domain, dense, seekable)`. A domain identifies ordered iteration
events, not their count. Dense means one event at each base position; seekable
means a checked cursor can be substituted to obtain an item without replaying
that stream's state machine. Density alone does not imply seekability.

| Operation | Domain | Dense | Seekable |
| --- | --- | --- | --- |
| source/range | fresh | yes | yes |
| map | preserve | preserve | preserve |
| scan | preserve | preserve | no |
| filter/transduce | fresh | no | no |
| zip | require equal; preserve | preserve | both parents must be |
| zip_checked | fresh positional | require both dense | both parents must be |
| stateless conditional choice | fresh | both parents must be | both parents must be |

A shared scan can be zipped with its original input or another scan over the same
source. It cannot be randomly indexed: `at(scan(xs,0,(s,x)=>s+x),4)` gives
`E_CAUSAL_ACCESS`. Independently selected transducer outputs cannot silently zip.
Checked positional pairing does not equate input origins. These are conservative
identity rules, not theorem search for predicate or transition equivalence.

Selecting between independently stateful stream plans is currently rejected with
`E_STATE_BRANCH`. Branch before the recurrence, or within its transition, instead.
`compile(source).observations` exposes result observation shapes; domain numbers
are compilation-local, not public stable identities.

A seekable map can still explicitly perform costly work inside its mapping
function. Seekability is an access legality rule, not a universal O(1) guarantee.

## Inclusive scan

```text
xs |> scan(initial, (state, x) => next_state)
```

Initial and next state share an inferred type. Supported state representations
are Num, Bool, or nested records of those scalars. The new state is emitted at each
upstream event; initial state is not an extra output. Internal record streams can
be mapped or folded; ASABI 1 does not materialize arrays of records.

Two views of the same scan share its state frame inside a fused traversal. Two
independent scans over the same source have separate state but aligned events.
Separate terminal consumers replay the scan independently; sharing a description
does not create an implicit retained history buffer.

## Selective transduction

```text
xs |> transduce(initial, (state, x) => {
  state: next_state,
  emit: should_emit,
  value: output
})
```

The input, state and output types can differ. The transition must have exactly
these fields and `emit: Bool`. It advances state on every upstream event, including
ones that emit nothing. Its independent selection creates a fresh event domain.

A physical plan contains an extent, lexical cursors, mask, item, guards, ordered
machine descriptions, and proof reference. A machine contains an upstream gate,
initial state, old-state binders, next-state expressions, emission and output.
Descriptions are compiler data. Generated code uses scalar Wasm locals, not
runtime machine records or closure objects. Intermediate arrays are unnecessary;
materialized final results still need caller-provided storage.

### Exact demand and update rules

Ordinary maps remain demand-driven. Consumed causal transitions are strict
scheduling boundaries:

1. If no upstream event occurs, do nothing. Initialize state only on the first
   upstream event; an empty source does not demand its initial state.
2. Evaluate and snapshot every next-state component against the OLD state.
3. Evaluate emission; evaluate output components only when emission is true.
4. Commit all new state components simultaneously.

A downstream filter does not undo an upstream transition or suppress an output
already emitted at this boundary. `count(scan(...))` executes transitions even
though dense stateless count can observe an extent without iteration. A dead
whole scan does not run. `filter |> scan` and `scan |> filter` therefore have
different clocks. These choices are covered by tests and are intentional, not a
claim to preserve strict ML semantics or every lazy-stream evaluation order.

No host call may appear in a transition. Strict scheduling is not an implicit
capability grant. The previous explicit effect boundary remains separate.

## User-defined machine combinators

Machine descriptions can be ordinary inferred records of `initial` and `step`:

```text
fn product(left, right) = {
  initial: { left: left.initial, right: right.initial },
  step: (s, x) => {
    left: left.step(s.left, x),
    right: right.step(s.right, x)
  }
};
fn history(xs, machine) = scan(xs, machine.initial, machine.step);
```

The two state types can differ; row inference discovers their relationships.
`examples/concepts/machine_product.ass` combines moments and energy. The selective
`connect` in `machine_composition.ass` advances its second machine only when the
first emits. Distinct suppression, differencing and integration then compose as
`run(xs, connect(connect(distinct(), difference()), integrate()))`.

The latter lowers to one loop and five recurrence scalars. Total locals include
additional cursors, output descriptors, conditions and scratch values. This is
staged higher-order programming, not first-class runtime closures, associated
types, unrestricted type-level computation or a new invention of transducers.

## Bounded state evolution

```text
iterate(initial, budget, state => { state: next, done: finished })
```

The result is `{state, steps, done}`. Budget must be a finite integer from zero
through 2,147,483,647. Invalid budgets trap. Zero returns the initial state, zero
steps and `done: false`. A step reporting done still commits its new state and
increments the count. Exhaustion reports `done: false`, not convergence.

The budget is runtime data. Increasing it does not unroll source or allocate a
recursive stack. An expensive step is not preempted by this budget; untrusted
workloads still require host resource policies and worker cancellation.

## Compiler invariants and limitations

Observation identities, lexical cursors and transition-frame identities are
separate. Nested traversals get independent bindings. Dependency analysis includes
state cells; memoization cannot hoist a computation that depends on an evolving
cell into a scope where it is invariant. All next-state values are snapshotted
before any update. Conditional caches cannot escape their generating branch.

Tests cover shared/independent/nested frames, masks, strict transition demand,
empty streams, budgets, record snapshots and memoization enabled/disabled. The
certificate checker reconstructs observation facts; it does NOT independently
verify the physical plan or every emitted instruction. There is no mechanized
soundness or end-to-end compiler correctness proof.

No automatic materialization, general multi-sink fusion, SIMD, independent filtered
zip, stateful stream branch selection, array-valued state or general recursion is
implemented. Ordinary inference and staging have no claimed linear worst-case
bound. Separately compiled, sealed observation summaries remain future work.

## Research context

Stateful fusion has major precedents, including
[Complete Fusion for Stateful Streams](https://arxiv.org/abs/2412.15768), revised
February 2026, and [Indexed Stream Fusion](https://arxiv.org/abs/2507.06456).
Their proofs and performance results do not transfer to this prototype.

The project-specific experiment is using one derived observation discipline to
control alignment, legal access, state-frame sharing and allocation-free scheduling.
Historical priority of that combination is not established. The more ambitious
research target is modular observation/resource-support contracts that preserve
these guarantees without inspecting every callee body.
