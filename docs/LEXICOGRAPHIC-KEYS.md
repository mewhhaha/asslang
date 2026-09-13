# Priorities as tuple keys

[Native ordering](NATIVE-ORDERING.md) · [Vertical composition](VERTICAL-COMPOSITION.md)

## See the priorities directly

Choose the nearest reading, then use the smaller reading to break distance ties:

<!-- lexicographic-example: nearest_ties -->
```ass
// Nearest first; break equal-distance ties by the reading, then original order.
export fn nearest_ties = (readings:[Num]) -> (center:Num) ->
  readings
  |> sort_by (reading -> (abs (reading-center), reading));
```

`[7,3,6,4,7,5]` around center 5 becomes `[5,4,6,3,7,7]`. The two 7s remain in
source order. No multiplier encodes priority and no host comparison is invoked.

For an application-shaped example, put jobs in descending priority and ascending
duration, keeping original order when both agree:

<!-- lexicographic-example: schedule_jobs -->
```ass
// Highest priority first, then shortest duration; identical keys stay stable.
export fn schedule_jobs = (priorities:[Num]) -> (durations:[Num]) -> do {
  let ranked =
    priorities
    |> zip_checked durations (priority -> duration -> {priority, duration})
    |> zip_checked (range (count priorities))
      ({priority, duration} -> position -> {priority, duration, position})
    |> sort_by ({priority, duration} -> (-priority, duration));

  ranked |> map (job -> job.position)
};
```

For priorities `[2,1,2,3,2]` and durations `[9,1,4,8,4]`, the original positions
are `[3,2,4,0,1]`. `zip_checked` enforces input alignment. This only computes an
ordering, not a scheduler or a proof that those priorities meet a domain policy.

```sh
npm run example:lexicographic-keys
npm run test:lexicographic-keys
printf '[[2,1,2,3,2],[9,1,4,8,4]]' | node examples/case-studies/app.mjs lexicographic-jobs
```

The comparison compiles the same job example both ways. Its tuple-key version
has one ordering, reserves 400 scratch bytes for five rows, and needs exactly
34 loop units. Two explicit scalar sorts (duration first, priority second) need
640 bytes and 63 units. Both return the same positions. These are measured
artifact/resource counts, not wall-clock promises. The new expression avoids
one complete sort; it does not turn mergesort itself into a single-pass algorithm.

A key helper is an ordinary staged function. Include a nested helper result as
one component to reuse a priority group, for example `(geographicKey row, -row.priority)`.
Grouping nested numeric tuples preserves their left-to-right priority. Named
payload fields need not be reordered to select a different priority order.

[Executed validation](LEXICOGRAPHIC-KEYS-VALIDATION.md) records finite oracles,
scalar compatibility, browser execution, resource limits and remaining boundaries.

## Design before implementation

On merged main `186fb5cadaf93389b060f1ae7509f15a6c443907` (tree
`79fd7f362305186a207520750614a107ffc0b00e`), native `sort_by` accepts one numeric
key. Ordering by distance and then priority needs repeated stable sorts (in
reverse priority order), or an ad hoc scalar score. A score such as
`distance * M - priority` is not lexicographic without additional bounds and
precision assumptions. Neither problem should force users to manage buffers.

Extend the existing key function to return a Num or a nonempty, possibly nested
positional tuple of Num. For example, `sort_by (row -> (row.distance, -row.priority))`
means ascending distance, then descending priority, then original source order.
A tuple's left-to-right order expresses priority; it is not a weighted sum. All
key production, comparison and row movement run in generated Wasm.

No new builtin, token, comparator callback, ABI version or ordering algorithm is
needed. Named records remain payloads, not implicitly ordered keys: renaming a
record field must not silently change priority. Because tuples already ARE
structural records, `{_0:distance,_1:negativePriority}` is the same accepted key.
Positions must be contiguous from `_0`, in numeric order, including `_10` after
`_9`. A nested tuple groups a reusable subkey; left-to-right flattening preserves
lexicographic order. Empty tuples, Bool/Text/Bytes/stream/function leaves, named
fields and symbol fields are rejected. At most 16 numeric key leaves and nesting
depth 16 are accepted; the existing 32 payload-leaf/site limits remain.

## Source ergonomics and useful laws

Records give data names; tuples give explicit priority. A named helper can return
a tuple and another key can include it: `(geographicKey row, -row.priority)`.
There is no special `then_by` builder or tuple-comparison operator to learn, and
no promise that arbitrary comparison callbacks obey a total order. Descending
numeric order uses existing negation, which preserves finiteness and reverses
order on finite f64 numbers (both zero signs remain equivalent).

For equal-shape finite numeric keys, let `lex(a,b)` compare the first differing
component and report equality only when all components compare equal. Induction
on component count establishes a total preorder: it is the ordered sum of the
first component's equivalence classes, each ordered by the remaining key.
Nested tuples flatten by structural induction without changing that comparison.
Stable merges choose the left row when lex reports equality, so the existing
merge proof gives a stable sorted permutation for this extended key model.

For total, pure key functions, stable sorting by B and then by A gives the same
final permutation as one stable sort by `(A,B)`. Within an A class, the earlier
B ordering remains; within an (A,B) class, original order remains. This is a value
law, NOT an automatic optimizer rewrite. Repeated sorts evaluate keys in another
order, have two materialization barriers/domains, use more scratch, and consume
other loop allowances. Partial keys, intermediate observations and failures can
distinguish these programs. The implementation does not fuse them implicitly.

The empty tuple would be a mathematical identity key, but is deliberately not
added as another spelling for `x -> 0`. Grouping versus priority uses ordinary
syntax: `(a)` groups, `(a,)` is a singleton tuple, `(a,b)` is a pair. Newlines are
whitespace; one key component per line can show a longer priority list.

## Types and demand

The HM function skeleton becomes `[a] -> (a -> k) -> [a]`, with a compiler-owned
structural restriction on k. Carry that restriction through unification and scheme
instantiation; validate concrete key shapes even in unused definitions/bindings.
This is not user-defined type classes, arbitrary ordering instances, or a new
source annotation. Generic helper key types may stay unresolved until use.
Unresolved numeric key leaves at an exported ABI boundary default to Num to
preserve previous scalar-inferred exports; do not guess a tuple arity or default
unrelated polymorphic fields. Internal generic helper signatures may show a key
variable; this does not promise arbitrary key representations, just as numeric
product differentiation has representation restrictions beyond its HM skeleton.
Staging rechecks the actual key shape and aggregate leaf/depth bounds after
helper specialization, before emission. This is a fixed-shape key per site, not
a heterogeneous sequence of differently shaped keys.

Once an ordering is demanded, every accepted payload and EVERY numeric key
component is evaluated and checked for finiteness in numeric tuple order before
merging. A unique first key does not exempt a bad second key. Comparisons can
skip later cached components but cannot skip producing/validating them. Empty
input still runs source guards but no key body or lazy scan initialization.
Unused/unselected sorts stay lazy as a whole. Captured invariant orders, source
provenance, scope restrictions, effect authority and shared invocation caching
retain the native-ordering contract. No new derivative for sorting is defined.

## Native representation and cost

For P payload leaves and K key leaves, each row has K cached f64 keys followed
by the same eight-byte payload slots. Row size is `8*(P+K)`; two buffers reserve
`16*(P+K)*N` bytes for source traversal extent N, even for sparse producers.
Bounds are checked before multiplication, with the existing disjoint scratch ABI
and per-invocation clearing. All affected modules already require ASABI 2; no
slot/layout change is introduced. Scalar-key sites retain their original emitted
instruction sequence and row size. A singleton numeric tuple can use that same
backend after shape checking. Diagnostic ordering sites report the key count.

During a merge compare cached components left to right, stopping at the first
unequal pair; choose the left row on complete equality. Do not subtract keys,
pack them into a float or use approximate equality. Materialization checks all
components before comparison, and row copies retain payload bits unchanged.
Key expressions may contain their own metered work or captured order dependencies;
collect every component's dependencies, including those after the first key.

With m accepted rows and h=ceil(log2(max(1,m))), at most K*m*h component comparisons
are needed (a component comparison uses at most two numeric instructions). Loop units remain bounded by N+h+2*m*h before producer/key/downstream
work, because K comparisons and P+K row copies are bounded straight-line code.
Primitive work is O(N + (P+K)*m log(m+1)) plus key production. This is one ordering,
not one total traversal: stable bottom-up merges still take multiple passes.
No new loop/scratch allowance or claimed wall-clock speedup follows automatically.

## Validation plan

The unchanged baseline passes 1,333 Node tests. Reproduce rejection of tuple keys,
then execute actual native multi-key programs against an independently written
lexicographic index oracle and repeated stable scalar sorts. Exhaust small paired
key words, include ties/signed zero/extreme finite values and >10 key positions.
Test nested keys, higher-order helpers, key polymorphism, monomorphic captures,
scalar inference compatibility, invalid shapes in unused definitions, partial
applications, source-local errors, bounds and no new effect authority.

Compare scalar-key builds, ABI and JTE certificates with the actual baseline in
all eight lowering configurations. Check singleton-tuple byte equality. Exercise
all-components-strict demand, sparse/causal input, dependency sorts in later keys,
sharing, exact loop/scratch capacities, raw memory canaries, payload bits, leases
and post-trap reuse. Add registered application examples, executable documentation,
Node and Chromium checks. Record only actual runs; keep historical reports intact.

## Prior work and boundary

Tuple lexicographic keys and repeated stable sorts are established techniques;
Python's official Sorting HOWTO documents both:
https://docs.python.org/3.13/howto/sorting.html
Checked September 13, 2026. This is a native compiler integration and a clearer
source contract, not a new sorting algorithm, priority encoding, human-readability
study, independent formal audit or proof-assistant verification. Checked partition
recursion remains separate work; tuple keys do not implement that proposal.
