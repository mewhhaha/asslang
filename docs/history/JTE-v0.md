# Jacob Torrang encoding (JTE), version 0

## The question we start with

Instead of starting with a catalogue of language features, start with three needs:
what can a consumer observe, what does it require before operating, and what
storage/control resources must stay valid for those observations?

For the first executable experiment, the consumer is a numerical reduction. It
needs scalar values and an iteration schedule. It does not require a vector
object, a type-level natural number, or an independently allocated iterator.

We therefore distinguish ordinary value types from relationships between values.
The ordinary type of a stream is `[a]`. The extra encoding is a finite derivation
graph of observations about *particular staged values*. It is not a new universal
bit representation or a replacement for Wasm's validation types.

## The implemented encoding

Each stream-producing operation has a certificate entry:

```text
Step = (id, rule, parentIds, domain, dense, optionalObligation)
```

A `domain` identifies the same ordered iteration events, not an integer length.
`dense` means the producer has one output for each base iteration position; its
extent can be observed without evaluating a filter. These facts are compiler-owned
and erased before execution. User code cannot assert a domain equality.

The compiler also builds a physical stream plan:

```text
Plan = (extent, indexVariables, optionalMask, itemExpression, guards, proofId)
```

The extent is a runtime scalar, not an argument to the ordinary stream type.
Expressions are shared scalar DAG nodes. The plan is compiler data, not an object
allocated by the generated program.

The rules are intentionally small:

```text
source:       fresh domain d; dense
map(s, f):    preserve domain(s) and density(s)
filter(s, p): fresh domain d'; not dense
zip(a,b,f):   require domain(a) = domain(b); preserve that domain
zip_checked:  require dense(a) and dense(b);
              require equal runtime extents before consumption;
              introduce a fresh positional domain d'
reduce(s):    consume the plan; produce a scalar
```

A fresh filter domain is generated even for textually identical predicates. Two
independently constructed `range(n)` sources are also distinct. This is a
conservative identity discipline, not a theorem prover for predicate equivalence.
Naming and reusing a stream shares its observation identity. Pure helpers are
staged, so a helper that maps its argument preserves the relationship without a
user annotation.

For example, the derivation for `examples/cohort.ass` includes:

```text
samples:  source                 domain 0
selected: filter(samples, p)     domain 1
weighted: map(selected, f)       domain 1
shifted:  map(selected, g)       domain 1
paired:   zip(weighted, shifted) domain 1
result:   reduce(paired)         scalar
```

The static composition rule and the backend's permission to use one cursor are
based on the same relationship. This coupling is the experiment we are testing.

## Why a length annotation would not express the point

Take two streams of equal length selected from different rows. Positional pairing
may be intentional, or it may be a bug. A proof that their lengths agree cannot
distinguish those intentions. JTE's default zip requires shared event identity.
The programmer chooses `zip_checked` to explicitly request positional pairing of
independent dense streams.

Checking equal extents does NOT prove equal origins. The checked operation creates
a new domain and does not add `domain(a) = domain(b)` to the environment. In
particular, statically zipping its output back with an original input is rejected
unless another explicit operation establishes the intended pairing.

These choices trade convenience for avoiding accidental row/element alignment.
Whether that tradeoff works outside small kernels is an empirical language-design
question, not a solved usability claim.

## Checking and erasure

`verifyCertificate` independently reconstructs each step's domain and density from
its rule and earlier parents. It rejects forward references, invalid arities,
forged observations, incompatible zip domains, and missing checked-zip obligations.
The staging pass separately ensures that physical plans agree with these choices.

The checker is deliberately small, but this is **not** a mechanized soundness
proof. It does not independently prove the semantics of the scalar DAG or verify
that every byte of emitted Wasm implements the recorded graph. The front end,
stager, certificate construction, and backend remain part of the trusted compiler.
Differential tests exercise this implementation; they do not replace a proof.

Certificates are JSON sidecars. They are not cryptographic signatures, do not
travel with each value, and add no per-element runtime metadata. Logical scalar
locals still exist in Wasm; the engine decides their actual stack/register layout.

## Operational semantics of the kernel slice

This prototype is pure and demand-driven. `let` names graph nodes. Inactive scalar
branches and dead scalar nodes do not execute. A map's result is evaluated only
when demanded. A filter's predicate is evaluated to determine event membership.
A reduction runs left-to-right; numeric operations are not reassociated. A fold
initializes its accumulator and evaluates its reducer at each selected event.

Each accepted single-reduction plan lowers directly to structured loops and
scalar locals. Shared branches over the same selected domain use one mask and
one cursor. Nested reductions may introduce nested loops. Reusing a stream in
separate reductions may recompute it; retaining an input does not create an
implicit materialization cache. This is a space/time tradeoff.

Generated functions have no recursion, host callbacks, memory writes, allocator,
GC operations, or runtime closure construction. Thus their scratch storage is
independent of input length for a fixed generated kernel, although local count
and code size depend on the program. A source `range(n)` needs no linear memory.
Borrowed inputs occupy caller-owned memory and are not free storage.

The host ABI validates each span at entry, even if the source later does not
observe its elements. This is a boundary validity requirement. Pure unused
`range` computations, by contrast, need not execute their extent check.

## What is conventional and what remains research

Ordinary inference is HM-style, with optional concrete annotations at exports.
Function/lambda staging, expression sharing, and stream fusion are not novelty
claims. The new project-specific encoding is the explicit finite observation
ledger and its use for both composition checking and selection of a shared
execution schedule. Historical novelty of that combination has not been proven.

The current implementation is a test bed for the broader proposal below, not an
implementation of every proposed feature.

## Broader proposal: observation and support interfaces

A future generalized encoding could have three orthogonal components:

```text
J(v) = (representation recipe, observation derivation, resource support)
```

The first says how to lower a value, the second which relationships a consumer
may rely on, and the third which memory/control capabilities it retains. A
function interface would describe transformations of these components, projected
onto the observations its consumers demand. Domain identities would be bound in
contracts, rather than exported as unstable global numbers.

This is meant to remove facts from executable specialization keys when they
cannot affect representation. A richer static guarantee should not automatically
create a new machine-code variant. It is also meant to allow dependency tracking
on individual required facts, rather than entire inferred interfaces.

Three concrete next experiments follow from that proposal:

**Modular relation summaries.** Infer and seal rules such as “preserves the input's
event domain; reads only this support.” Check a caller against the summary without
staging the callee's body. Compare invalidation counts and code size against the
current inline-everything bootstrap. Alpha-normalize bound identities and keep
ABI dependencies separate from observation dependencies. None of this cache or
summary machinery exists yet.

**Write-once destinations with inferred support.** Add a caller-provided output
span and a capability authorizing a non-overlapping set of writes. Derive support
through captured values; prohibit a value from escaping its support scope. Model
mutation/version changes explicitly so old observations cannot justify accesses
after relevant data changes. A region/lease system must address aliasing,
exceptions, cancellation, and async suspension, not just lexical block syntax.
There is currently no region allocator, ownership checker, or escape analysis.

**Demand-aware effects and optional managed islands.** Keep the pure kernel model
small. An eventual explicit scope could permit managed graphs or concurrency,
but it needs defined lifetime, resumption, and capture rules. It must not make
all ordinary values GC-managed or silently change demand semantics. No `go` or
`gc` keyword has been assigned speculative semantics in this prototype.

A useful research result would require a calculus, preservation/erasure argument,
modular inference story, implementation, and comparisons with existing typed
fusion and capture/resource systems. The testable claim is not “everything is
novel”; it is that one tractable observation/support interface can make stronger
composition guarantees coincide with predictable execution and compilation costs.
