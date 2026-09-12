# Elegant partition recursion: executable design experiment

[Documentation](README.md) · [Vertical composition](VERTICAL-COMPOSITION.md)

## Status and question

Can the clarity of functional quicksort coexist with efficient execution?
This change is a **design experiment**, not a new source-language feature.
The executable backend is JavaScript over typed arrays. An integration example
uses real Asslang/Wasm to compute ordering keys, then the experimental host backend
to arrange them. No sorting instruction, recursive definition, new type, or hidden
scratch allocator has been added to the compiler. All syntax below marked proposed
is intentionally outside the accepted language. This distinction matters.

Baseline: main f75b4586834f0f56841e58e7524bde3aec808bc7, tree
4cb759089fd5adc54ec2e364f67f03224c1c1bb9. Read AGENTS, IMPLEMENTATION and SYNTAX first.

## Semantics before optimization

For finite sequences of payloads with cached finite numeric keys, define stable
ordering by ascending key, preserving original order among equal keys. Both signs
of zero compare equal and must retain input order; NaN/infinity keys are rejected
by this initial experiment. Payloads are represented by original indices, so the
algorithm does not drop values or duplicate objects. Input storage is not mutated.

The familiar first-pivot, two-filter quicksort has two independent costs: repeated
intermediate sequence construction and potentially quadratic partition work.
Removing list allocations does not change T(n)=T(n-1)+Theta(n) into n log n.
Median-of-three alone also cannot guarantee balance on arbitrary inputs.

A stable three-way specification is:

    Q(X) = X                                      if |X| < 2
    Q(X) = Q(L) ++ E ++ Q(G)                       otherwise
    (L,E,G) = stable partition by key relative to a pivot FROM X.

Equal elements leave the recursion together. A pivot from X ensures |E|>=1, so
both recursive children are smaller. Using keys rather than arbitrary comparison
callbacks fixes a real order; a user-supplied comparator can be inconsistent,
partial, expensive, or effectful. Hoisting an effectful or partial key function
would also change demand. The experiment eagerly validates all finite keys.
It makes no promise about lazy prefixes, infinite sequences, or skipped traps.

## Proposed surface: readable recurrence, compiler-owned representation

PROPOSED, NOT ACCEPTED ASSLANG:

    fn quicksort = xs ->
      partition_rec xs (x -> x)
        (recur -> {less, equal, greater} ->
          concat3 (recur less) equal (recur greater));

The skeleton handles the empty/singleton case, chooses an input pivot, and presents
strict child regions. The local `recur` is a scoped recursive capability, not an
ordinary escaping runtime function. `concat3` combines disjoint result segments.
No extra punctuation is needed; the current ->, records and whitespace application
can describe this shape. Existing first-argument pipelines could consume its
result. However these functions, capabilities, sorting barrier and laws are NOT
implemented merely by writing this spelling.

A future checker would establish, rather than accept Boolean claims about:

* exact cover/disjointness: L,E,G partition the parent positions;
* progress: the pivot belongs to the parent, E is nonempty;
* order: every L key < every E key < every G key;
* linear placement: each child result is used once in its assigned destination;
* purity/finite key domain and stable equal-key semantics.

The result contract is a stable sorted permutation of the parent. Reversing the
children, duplicating a child, inventing a pivot or using an arbitrary reducer
would not have that contract. A compiler must reject such a proof, choose another
explicit execution contract, or retain ordinary semantics. It must NOT recognize
something 'looking like quicksort' and silently call another sorting algorithm.

This is proof-directed algorithm selection, distinct from ordinary allocation
elimination. A stable mergesort fallback has the same fully demanded extensional
result only once the sorted-permutation and stability obligations are established.
A pivot count, callback side effect, first thrown exception, or lazy prefix is not
preserved by that substitution and must not be promised. Generated proof terms
and type rules are future work, not tested by the host backend.

## Representation tested here

`partitionOrder(keys, options)` copies/validates keys once and produces an owned
Uint32Array of original positions. One n-element permutation, one n-element
scratch permutation and one n-byte classification buffer are allocated, alongside
the n-element Float64 key snapshot and a fixed-size typed stack.

A stable partition first classifies/counts each region position, then scatters
indices into three adjacent scratch intervals in input order, then copies the
interval back. Thus there are THREE linear passes, not a claimed one-pass stable
in-place partition. Keys are not recomputed, and no child payload arrays are
allocated. Children are just integer [lo,hi) ranges. All-equal intervals need only
the classification pass and preserve their current permutation.

Sort the smaller child immediately and postpone the larger in a typed stack.
Recursively completed children already occupy their final intervals: concatenation
is placement, not another data copy. The actual sorting storage is 17n bytes plus
12*(ceil(log2(max(1,n)))+2) stack bytes. This includes output indices and cached
keys; it excludes input, any caller's payload gathering, JS objects, Wasm key
computation, allocator metadata and verification. Input-preserving sorting does
not mean zero allocation or globally in-place execution.

After 2*floor(log2 n) partition levels on a path, run stable bottom-up mergesort
on the unfinished region using the same scratch permutation. `pivot:'first'` is
available to deliberately exercise adversarial behavior; default is median3.
This guard changes execution, not the stable-order result. It is not a generic
rewrite for arbitrary recursive computations. No insertion-sort threshold is used
in the initial experiment, so small exhaustive tests exercise the partitioner.

## Proofs under the stated model

**Stable partition.** During classification, each position receives exactly one
of three tags. Counts give disjoint adjacent intervals whose lengths sum to m.
During scatter each tag's write cursor advances once per tagged input. It stays
within its assigned interval and uses every slot exactly once. Traversing source
positions in order preserves the relative order within each class. Copy-back
preserves these properties. Consequently no payload is lost or duplicated.

**Sorting.** Induct on region size. Sizes 0/1 are sorted. Otherwise the pivot is
an existing key, so strict children are smaller. Their recursively sorted outputs
and E are sorted. The cross-region inequalities imply their concatenation is
sorted. Each partition is stable, so equal keys never cross into different strict
children; stability follows inductively. The fallback merges two sorted runs,
choosing the left on equality. Its standard run-length induction establishes the
same stable sorted permutation. Therefore replacing any subtree with it is valid.

**Uniqueness.** A stable sorted permutation is unique for a fixed total preorder:
its equivalence classes must appear in order, with original positions increasing
within each class. Both recurrences therefore produce identical index sequences,
not merely equal numeric sets. This is why stability is not an optional footnote.

**Work.** At a fixed partition depth the active regions are disjoint and their
lengths sum to at most n. At most D=2*floor(log2 n) such depths are permitted, so
classification/scatter/copy work is O(nD). Fallback regions are disjoint; for their
sizes m_i, sum m_i log m_i <= n log n. Hence total sorting work is O(n log(n+1))
worst case. Key production adds its own cost, e.g. O(n*C_key) only when each key
has an established cost C_key. Calling a key exactly once does not make it O(1).
The all-equal case is O(n). Balanced three-way partitions do not establish a
universal parallel-span or throughput bound.

**Stack and memory.** Whenever an additional larger child is postponed, immediate
work moves into a child at most half the current size. Along simultaneously
pending descendants this can happen at most ceil(log2 n) times. Tail-processing a
lone child adds no pending frame. The three integers per frame therefore fit the
stated stack capacity; all payload/key scratch buffers are allocated once.

**Bounded work.** Count explicit initialization, classification, scatter, copy,
merge-run, merge-write, merge-copy and region-dispatch steps. `maxWork` throws
before exceeding its configured count, returning no partial permutation. It does
not preempt allocation, accessor/proxy work, JS garbage collection or Wasm key
work. It is independent of Asslang's existing emitted-loop budget.
Input count is at most 1,048,576 and work at most 1,000,000,000; defaults are 50
million steps. This is a research resource contract, not a wall-clock sandbox.

**Result checker.** `verifyOrder(keys, indices)` independently checks length,
finite keys, exactly-once occurrence of every original index, nondecreasing keys,
and increasing original indices on equal keys. It is an O(n) result checker, not
a proof of complexity, source elaboration, or the internal partition history.
It has its own n-byte seen array and is run outside benchmark timing.

## Why Asslang cannot get this as a free optimization

Current streams are plans, not persistent partition arrays. General recursion is
rejected. The ABI rejects arrays of records and the emitter currently reports no
intermediate-buffer storage. Sorting finite arbitrary data requires global storage
or an explicit storage/traversal tradeoff: it is a materialization/reordering
boundary, not an ordinary causal map.

A language implementation needs invocation-local scratch accounting and lifetimes,
new event provenance after reordering, pure-key staging, explicit demand at the
sorting barrier, cancellation/error cleanup, destination ownership, and checked
structural recursion. Existing loop budgets must cover partition/fallback work.
`head(sort xs)` cannot be rewritten to selection without a separate demand and
failure-equivalence argument. Nor can independently sorted streams silently zip.
The prototype leaves all these compiler rules intact rather than introducing a
special parser that pretends to support recursive source.

## Validation plan and prior work

Compare against independent stable index sorting and literal functional recurrence,
exhaust small finite alphabets, test duplicates, signed zero and malformed keys,
force fallback with first pivots, test all supported pivot choices, check every
returned permutation, work exhaustion and repeated calls. Measure operation counts,
cumulative reference-array writes and real JS timings separately, never timing-gate
CI. Include sorted, reverse, random, low-cardinality, all-equal and organ-pipe data.
The JS reference is NOT a GHC benchmark and no performance result transfers to
Haskell, generated Wasm, a GPU, or another engine. Preserve raw benchmark samples.
Run actual Asslang key generation across all existing lowering settings.

The key ideas have substantial prior art. No world-first claim is made.

1. NESL: nested data parallelism and a source-language work/depth model.
   https://www.cs.cmu.edu/~scandal/nesl.html
2. Futhark, How should Futhark expose irregular arrays to the programmer?
   August 12, 2026; explicitly uses recursive NESL quicksort as its example.
   https://futhark-lang.org/blog/2026-08-12-flatmap.html
3. Musser, Introspective Sorting and Selection Algorithms, 1997.
   https://www.cs.rpi.edu/~musser/gp/algorithms.html
4. Shaikhha et al., Using Destination-Passing Style to Compile a Functional
   Language into Efficient Low-Level Code, 2017.
   https://www.microsoft.com/en-us/research/publication/using-destination-passing-style-compile-functional-language-efficient-low-level-code/
5. Futhark, Uniqueness Types and In-Place Updates, 2022; also discusses the
   higher-order/pipe ergonomics cost of exposing consumption in types.
   https://futhark-lang.org/blog/2022-06-13-uniqueness-types.html

Sources checked September 12, 2026. This proves properties of a stated algorithm
and tests a lowering target. No proof assistant, independent review, automatic
certificate synthesis, Wasm sort backend, GPU implementation or language-level
complexity checker is delivered by this experiment.

## Run the experiment

```sh
npm run example:partition-recursion
npm run test:partition-order
npm run bench:partition-order
```

The example ranks readings [7,10,4,7,5] by distance to 5. Its ordinary Asslang
`map` computes keys [2,5,1,2,0] in Wasm. The JavaScript backend returns positions
[4,2,0,3,1], retaining input order for the two equally distant 7s. It also compares
an all-equal input with the literal two-filter recurrence and deliberately chooses
first pivots on ascending data to demonstrate the actual merge fallback.

[Executed validation](PARTITION-RECURSION-VALIDATION.md) reports actual commands,
limits and measurements. Benchmark JSON retains every timing sample; counts
distinguish algorithmic changes from representation changes. In particular the
three-way reference already fixes the all-equal quadratic behavior. Allocation
elimination alone must not receive credit for that improvement.
