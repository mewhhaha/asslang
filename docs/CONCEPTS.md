# Other language concepts in Asslang 0.2

The examples below are executable corpus members, not syntax for unimplemented
features. The previous expanded discussion remains in history/CONCEPTS-asabi1.md.

## Traits and interfaces: explicit inferred dictionaries

`examples/concepts/traits.ass` passes records containing an identity and a combining
function. Row inference discovers exactly which fields a helper requires. The
stager eliminates dictionaries and captured functions from the kernel. This does
not add global instance search, associated types, coherence checking or automatic
proof of algebraic laws.

## Type-shape programming: polymorphic structural transformations

`type_shapes.ass` uses pair construction, projection and composition. Their inferred
types change with the values they transform. Types are not first-class source
values; there is no arbitrary dependent computation, conditional type-family
solver or unrestricted higher-kinded inference.

## Refinements: distinguish checks from static facts

`refinements.ass` includes `require(condition, value)`, a demanded runtime contract.
It does not automatically produce a statically proved Positive type. JTE domain
identity and seekability are actual compile-time relational facts: misaligned zip
and random access through recurrence are rejected. No vector length parameter or
SMT solver is involved.

## State-polymorphic machine composition

`machine_product.ass` combines descriptions with independently inferred state types.
`machine_composition.ass` connects selective machines, advancing the second only
when the first emits. Product, connect and run are ordinary Asslang functions,
not privileged syntax. Their closures and record structure stage into scalar
locals and one loop. This is not support for escaping runtime closures.

## Loops and ownership

`scan` produces history, `transduce` selectively emits, and `iterate` performs bounded
state evolution with explicit exhaustion. State is scalar or a nested scalar
record, not an arbitrary heap. Prepared JS input leases now retain an immutable
snapshot across calls; disposal invalidates the handle. This extends the previous
call-only lifetime without claiming general source-level ownership inference.

## Effects

Host calls still require perform in an exported effect block and an exact host
grant. Recurrence transitions stay pure. General branch-sensitive/resumable effects,
asynchronous suspension and linear source values are not implemented.

See [CAUSAL.md](CAUSAL.md), [LEASES.md](LEASES.md) and [EFFECTS.md](EFFECTS.md) for
precise semantics and the boundary between compiler guarantees and host trust.
