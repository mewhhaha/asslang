# Jacob Torrang encoding: current executable model

JTE separates three questions: what representation a computation needs, which
observations justify composing it, and which external resources support those
observations. The stream-observation layer is implemented; general resource-support
inference and modular contracts remain research work.

The core ordinary types are functions, records, Num, Bool, Text, Bytes and `[a]`.
A stream's runtime extent is not a type parameter. The compiler additionally derives
an observation certificate for particular staged streams:

```text
Step = (id, rule, parentIds, domain, dense, optionalObligation)
Plan = (extent, lexicalIndexVariables, optionalMask, itemExpression, guards, proofId)
```

`domain` identifies an ordered sequence of events. It is not a length. `dense`
means there is one emitted event per base position. Certificate facts are erased
before execution and stored as a compiler sidecar, not per-element metadata.

## Rules

```text
source       fresh domain, dense
map          preserves the input domain and density
filter       fresh domain, not dense
zip          requires equal domains; preserves domain/density
zip_checked  dense parents + equal-extent runtime obligation; fresh positional domain
choose       fresh domain; dense only when both branches are dense
reduce       consumes a stream and yields an ordinary scalar/record result
```

A checked positional zip does not equate its parents' origins. A conditional choice
also gets a fresh identity; it does not claim its output always has either original
domain. Reusing a named result shares the derived identity. Independently written
filters stay distinct even when their predicates look identical.

`verifyCertificate` reconstructs domain/density facts and checks earlier-parent
references, rule arities, zip compatibility and checked-zip obligations. This is
not a mechanized compiler correctness proof. In particular the checker does not
independently connect every physical plan or emitted instruction to its certificate.
The compiler and backend remain trusted; differential testing is evidence, not a
proof of global novelty or semantic soundness.

## Observation identity is not a lexical cursor

The new corpus exposed a bug in the original bootstrap. In:

```text
map(xs, x => sum(map(xs, y => x * y)))
```

`x` and `y` are drawn from the same source domain but belong to different nested
traversals. Reusing the source's single scalar index node made their bindings
indistinguishable. Related code could reuse a cached outer element while entering
an independent inner reduction.

The staging pass now renames physical cursor variables when a source is traversed
inside an active use of the same source. This does **not** rename its observation
domain. The backend also invalidates cached expressions whose free bindings are
rebound on loop entry. Tests exercise two/three-level nesting, captures, record
accumulators and optimization-enabled/disabled execution against the reference.

This distinction is fundamental: a certificate about event relationships cannot
also serve as a universal binder identity for every dynamic execution of those
events.

## Demand-preserving reduction memoization

The straightforward code:

```text
let total = sum(xs);
map(xs, x => total + x)
```

previously emitted the reduction inside the output loop, repeating it once per
element. A normal preheader hoist is not automatically valid: a trapping reduction
must not execute for an empty stream or an unselected branch.

The backend derives free cursor/accumulator dependencies for scalar graph nodes.
A reduction independent of a loop's changing bindings receives a scalar initialized
flag and cached result locals. It runs on **first actual demand**, then reuses the
result during that loop invocation. Record reductions cache all state fields, and
simultaneous updates snapshot every next-state component before any accumulator is
changed. Flags are reset at the correct enclosing loop scope.

This is local demand-preserving memoization, not a runtime thunk heap, global
common-subexpression cache, or general loop-optimization theorem. The
`memoizeReductions: false` compiler option is retained for differential tests and
before/after scaling measurements. It changes optimization, not language semantics.

Dense `count` is an observation of extent and lowers directly, preserving dynamic
guards. Counting a filtered stream still needs its selection traversal.

## ABI and effects as explicit support boundaries

ASABI 1 fixes the representation and call lifetime of data crossing JS. It uses
borrowed inputs and caller-provided output regions; the recommended adapter copies
and scrubs its private arena. This supports realistic values without introducing a
guest object heap. It is not a general region/borrow calculus.

Host operations use a separate strict boundary. Each effectful export has an ordered
operation trace. `perform` advances implicit invocation state, enforced by a private
JS broker with explicit grants, exact signatures, policies and quotas. Pure graph
rewrites cannot duplicate or erase a host call because host operations never become
ordinary pure function values. This is not a full algebraic-effect or linear-value
type system. See ABI.md and EFFECTS.md for implementation contracts and limits.

## Next research milestones

A generalized encoding remains:

```text
J(v) = (representation recipe, observation derivation, resource support)
```

The next substantial compiler change should be **modular observation/support
summaries**. A helper should be able to promise that it preserves a domain and
retains a particular support without every caller staging its body. Bound domain
identities need alpha-normalization; representation and calling-convention
compatibility must remain separate from observational compatibility. A valid
cached type is not automatically the newly most-general inferred type.

For runtime performance, the corpus motivates generation-checked borrowed JS input
leases, a scan/stateful producer, multi-sink reductions, and destination-aware
bounds-check elimination. Those should be introduced with explicit lifetimes and
semantics, not hidden mutable caches or speculative effect execution.

There is no claim that the implementation proves this generalized design sound,
scalable, or historically unique. Existing fusion, capture/resource, destination
and inference research remains directly relevant. The original prototype-0 design
is preserved as `history/JTE-v0.md`.
