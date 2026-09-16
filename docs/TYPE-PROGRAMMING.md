# Numeric shape programming

[Documentation](README.md) · [Core boundary](CORE-AND-PRELUDE.md)

## Design before implementation

Main `6be919cf32041208b208d8764508c398d1ad2677` exposes higher-order staged
functions and source-defined operators but source code cannot enumerate an
unknown record's fields. The previous partial type-programming work is absent
from the recovered files. This pass rebuilds a focused structural mechanism,
not a claim that the lost implementation or its failing test was repaired.

Provide `product_map value function`, `product_zip left right function`, and
`product_fold value initial step` for statically known numeric products. Their
compiler responsibility is finite shape traversal. Algorithms and dictionaries
remain source. Neither a `Type` runtime value, unrestricted compile-time evaluator,
new parser syntax, code string evaluation, nor a runtime reflection table is added.
A numeric product is Num or a record of numeric products, including the empty
record. Tuples are positional records. Symbol-keyed fields are rejected so a
generic traversal does not open private-symbol protocols.

The restriction is structural, not a test that runtime numbers are finite.
Numbers may be NaN, infinite or signed zero as before; leaf functions select the
arithmetic and guards. Map and zip keep the exact product shape and numeric
leaves. Zip requires the same recursive field names, not just the same leaf count.
Fold may return a scalar, record, staged function, or an ordinary stream plan,
subject to the existing type/staging/ABI rules. Its accumulator has one ordinary
monomorphic type throughout a call; this is not a rank-2 heterogeneous fold.

## Type and traversal contract

With P restricted to numeric products, the HM skeletons are:

    product_map  : P -> (Num -> Num) -> P
    product_zip  : P -> P -> (Num -> Num -> Num) -> P
    product_fold : P -> A -> (A -> Num -> A) -> A

Representation restrictions follow variables, record components, open-row tails,
and scheme instantiation. Reject concrete invalid leaves even in unused functions
and unused calls to polymorphic helpers. Generic shapes may remain unresolved
until use. Do not choose a scalar or invent record fields for an ambiguous export;
its normal concrete ABI annotation is required. The signature printer shows the
HM skeleton, not a new source constraint language. Recheck concrete aggregate
limits after specialization; component restrictions cannot by themselves prove
the combined size of a tuple assembled inside a generic helper.

Canonical traversal is depth first. Ordinary field names are ordered by code-unit
comparison, independent of record construction order. A record with exactly the
contiguous positional fields `_0` ... `_(n-1)` uses numeric position order, so a
12-element tuple visits position 9 before 10. Mixed positional/named records use
ordinary field-name order. Nested grouping is preserved in map/zip and erased
only by fold traversal; no flattened record is exposed as a runtime value.

An empty product maps/zips to the empty shape and folds to the initial value.
Its callback is still type checked but not applied by the structural elaborator.
All input shapes are validated before any callback is staged. In map/zip,
runtime evaluation remains driven by selected output fields. Fold elaborates
left-associated applications in the stated order; a callback may ignore earlier
values, so elaboration order is NOT a promise of strict runtime evaluation.
No associativity, numerical reassociation or eager validation is assumed.

## Source-defined derivation and compile-time construction

`lib/products.ass` will derive zero/constant products and pointwise algebra using
these three mechanisms. The witness supplies a type shape, not trusted metadata;
its numeric contents need not execute when ignored. The same Horner source from
`lib/polynomials.ass` can then evaluate a nested product without enumerating fields.
A shape fold can construct a chain of ordinary staged functions, or concatenate
runtime-sized range plans and then scan them. The number of field stages is known
at compilation; their numeric parameters and array extents remain dynamic.

This is deliberately not arbitrary type computation. No new types, field names,
variant types, user-defined type predicates, file/network I/O, general recursion,
or differentiation of unsupported graphs is introduced. Source function names
are not recognized as derivation patterns; renamed definitions must still work.

## Representation and proof obligations

Validate a staged product into a bounded compiler-side tree of field paths and
existing scalar graph leaves. Map/zip invoke the supplied staged callback at each
leaf and rebuild an ordinary compiler record. Fold repeatedly invokes its step
on the previous accumulator and each leaf. Do not add a new scalar opcode, guest
loop, buffer or instruction to the Wasm emitter. New array/machine plans created
by user callbacks retain ordinary provenance, demand and resource rules.

Projection induction: at a leaf, map is application and zip is binary application.
At a record, reconstruction preserves its field labels and applies the induction
hypothesis under each label. Thus every output path contains exactly the specified
leaf application. Zip's shape check ensures every path has exactly one partner.
Fold induction on the canonical leaf list proves equivalence to the explicit
left-associated source applications. Empty products give the base cases.
These prove the elaboration scheme, not correctness of the entire compiler.

Every invocation is bounded to 128 numeric leaves, 16 record levels and 4,096
shape nodes, including empty records. Staging callback applications still consume
the existing expansion allowance; widths/limits are not raised. Unrolling may
increase code and compiler work, and a fold can build repeatedly used expensive
subcomputations. No universal linear runtime or zero-cost compiler claim follows.
Mapped/zipped products do not allocate guest records except ordinary ABI result
storage. A folded stream may need loops, output arrays or existing sort scratch.
A folded function cannot escape through the ABI.

## Compatibility and alternatives

Only the three new callable names become reserved. There is no parser, operator,
ABI, host-authority or default-resource change. Existing programs without those
names should retain exact artifacts. The audited callable core grows from 30 to
33: these operations supply access to finite shape information that ordinary
source could not obtain. They are not three new arithmetic algorithms. Handwritten
field projections remain valid; unrestricted macros or runtime record reflection
would add substantially different authority and execution semantics.

## Validation plan

Run the reconstructed 1,746-test baseline and compare unchanged corpus artifacts
against it. Check source derivation against explicit fieldwise programs and
independent nested-object oracles in eight SIMD/fusion/memoization configurations.
Cover empty/one-leaf/nested/large tuples, annotation requirements, changed field
construction order, symbols, invalid leaves in unused generic calls, monomorphic
captures, lexical operators, exact shape mismatch, bounds and source locations.
Test ignored values/guards, branch demand, effects, forward/reverse differentiation,
function-valued folds, range-plan folds, alignment rejection, causal chunks,
loop/output capacity, cache snapshots, prepared calls and failure recovery.
Register examples in the normal corpus, extract published snippets, update the
core inventory and browser harnesses, run all tests and required example drivers.
Record only executed validation in a new report, preserving historical reports.

## Established context

Scala 3 documents product mirrors and compile-time derivation over type structure:
https://docs.scala-lang.org/scala3/reference/contextual/derivation.html
Zig documents compile-time type reflection and inline iteration:
https://ziglang.org/documentation/master/
Checked September 15, 2026. These are related mechanisms, not evidence of Asslang's
correctness or a priority claim. This smaller numeric-product interface does not
implement their full metaprogramming facilities. No new theorem, universal
minimality, proof-assistant verification or independent formal audit is claimed.
