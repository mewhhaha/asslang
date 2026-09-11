# Conditional evidence: the missing implication

[Category-theory guide](CATEGORY-THEORY.md) · [Documentation](README.md)

The shared-proof frontier answers “which evidence sets prove these goals?”
A caller may instead promise **one of several evidence sets**, without saying
which one. What additional evidence is enough in every case? The answer is an
internal hom in the same lattice used for shared proofs: Heyting implication.
This is an application of established mathematics, not a claim of new priority.

## A practical distinction

Suppose a target needs both labels 0 and 1. A caller guarantees label 0 **or**
label 1, but does not identify which. A fixed additional check of 0 is not enough:
the caller may already have only 0. Checking 1 alone has the symmetric problem.
The only minimal fixed completion is `{0,1}`.

Compare this with a caller guaranteeing specifically `{0}`. Then the missing
requirement is just `{1}`. Universal uncertainty and a known retained set are
different contracts. An adaptive program may inspect which case holds, but that
is a different optimization problem from choosing one fixed evidence set.

## The construction

Fix a finite set E of candidate evidence labels. An upward-closed family U of
subsets of E describes a monotone evidence requirement: if S satisfies it, any
superset of S does too. These are the families from [shared descent](DESCENT-BATCHES.md).
A family is represented by its antichain of inclusion-minimal sufficient sets.
The empty family `[]` is impossible; `[[]]` requires no evidence.

For upward families U (the caller's guarantee) and V (the target), define

\[
U\Rightarrow V
=\{S\subseteq E:\ \forall T\supseteq S,\ T\in U\Longrightarrow T\in V\}.
\]

This is upward-closed: increasing S reduces the extensions T that must be tested.
It is the **weakest monotone additional condition** whose conjunction with U
entails V. “Weakest” means the largest family of acceptable supports.

**Adjunction.** For every upward-closed W,

\[
W\cap U\subseteq V\quad\Longleftrightarrow\quad W\subseteq(U\Rightarrow V).
\]

**Proof.** Assume the left side. For S in W and T containing S, upward closure
puts T in W; if T is also in U, it is in V. Hence S is in the implication.
Conversely, if S is in W and U, membership in the implication can be tested
with T=S, yielding S in V. This proves both directions. ∎

Ordered by inclusion, these families form a thin category: there is one arrow
U→V exactly when U is contained in V. Intersection is the categorical product.
The adjunction says that `(- ∩ U)` has right adjoint `(U ⇒ -)`, making this
category cartesian closed. This is the standard Heyting-algebra interpretation
of implication [1], specialized to evidence supports.

## An exact frontier formula

Let B be the minimal sets of U and A the minimal sets of V. Then

\[
S\in U\Rightarrow V
\quad\Longleftrightarrow\quad
\forall b\in B,\ \exists a\in A:\ a\subseteq S\cup b.
\]

To see this, use T=S∪b for necessity. For sufficiency, any T in U contains some
b in B, so S∪b is contained in T. The stated condition and upward closure put
T in V. Since `a ⊆ S ∪ b` is equivalent to `a \ b ⊆ S`, the residual frontier is

\[
\boxed{\min_{\subseteq}
 \left\{\ \bigcup_{b\in B}(a_b\setminus b):\ a_b\in A\ \right\}.}
\]

An empty B gives the single empty union: an impossible assumption entails
anything. If A is empty but B is not, there is no completion. The formula does
not turn an impossible caller guarantee into a runtime capability.

For the existing batch example, the target frontier is `[[0,1],[0,2]]`. A caller
promising `[[1],[2]]` needs exactly `[[0]]` as additional evidence. Every target
support contains 0; either promised summary comparison can then finish the proof.
The executable example obtains the target frontier from `planDescentBatch` and
checks it with `verifyDescentBatch` before applying this calculation.

## Composition laws and a trap to avoid

The adjunction gives

\[
(U\cup W)\Rightarrow V=(U\Rightarrow V)\cap(W\Rightarrow V),
\]

\[
(U\cap W)\Rightarrow V=U\Rightarrow(W\Rightarrow V).
\]

The first law says that uncertainty requires handling both possible contracts.
The second is currying: two assumptions can be discharged together or in stages.
Both follow by applying the adjunction to an arbitrary test family and the
associativity/distributivity of intersection.

Do **not** replace this operation with pointwise Boolean `!U(S) || V(S)`.
That expression can be true now and false after more evidence arrives. For
U requiring `{0}` and V requiring `{0,1}`, it accepts S={} only because U is
currently false; the extension T={0} immediately disproves the contract.
The correct residual requires `{1}`. Classical material implication on a
snapshot is not monotone implication over all extensions.

The weakest condition is structural, not a cheapest implementation. Nonnegative
prices can select a cheapest member of the resulting frontier. Adaptive tests,
evaluation order, correlated failures, and shared runtime evaluation costs need
separate models. Nothing here makes a stale fact true, or changes Asslang equality.

## Executable scope and representation

`examples/interop/evidence-residual.mjs` supplies a small teaching helper,
`residualEvidence(labelCount, guarantee, target)`. It is **not a new compiler
export or language intrinsic**. It accepts at most eight labels and at most
256 supports per input family, each with distinct integer indices. Empty,
redundant and unsorted families are normalized; malformed inputs are rejected.
The result is an independent frozen array of minimal supports in numeric-mask
order. This bound keeps the complete state space to 256 supports.

The helper computes the target's upward closure, tests `S ∪ b` for every promised
b, and extracts minimal passing S. With m labels, A target terms and B guarantee
terms, work is O(m(A+B)+m·2^m+B·2^m), memory O(2^m+A+B). It does not price supports
or evaluate program values. Keeping the helper in the example avoids expanding
the public compiler API for a small algebra demonstration.

The example also compiles an ordinary Asslang guard that rechecks the actual
caller guarantee, the additional evidence, and required local equations before
returning values. This uses existing `require`, ordinary Boolean operations and
ASABI records. It introduces no runtime graph, cache token, special effect,
compiler optimization, allocator, or ABI change. All demanded loops retain the
existing per-invocation budget semantics.

The categorical reading of an actual descent frontier assumes coherent patches
and lawful equality, or equivalences respected by every involved map. Generated
or handwritten support-local equations can establish the coherence used in a
specific proof. Approximate comparison, NaN, signed zero and partial functions
retain the [existing limitations](DESCENT.md). No equality laws or novelty are
inferred. A guard rejection means the chosen evidence failed, not necessarily
that every target value differs.

## Documentation integration and validation plan

Keep the root README an introduction, not a reverse-chronological feature log.
Use canonical syntax, complete runnable examples, a short prototype warning and
links to getting started, a language tour and a practical category guide. Move
technical navigation into the existing docs directory. Preserve historical
validation reports and link them from a separate evidence index rather than
copying old test counts into the README.

Before implementation, unchanged main `2b79e9919aaedecaacd01fe6fe7efd402162a5a0`
(tree `889fe8978e7611fffa3cfeb802c2b84f1eeed12f`) passed all 995 Node tests.

Add tests that extract and execute README/guide code blocks, exercise expected
language errors, verify local file/heading links and check documented npm scripts.
For the new derivation, enumerate all 20 antichains on three labels and compare
the residual to the definition quantified over extensions. Check the adjunction,
currying, frontier formula, false pointwise-implication case, empty families,
input bounds and immutability. Compile the example guard in all eight lowering
configurations and test failure of the caller guarantee and of new evidence.

Run the full Node suite, host/reducer examples and browser suite when available.
Record only executed results in [the documentation validation report](DOCUMENTATION-VALIDATION.md).
Formal proof-assistant verification, worldwide priority and runtime improvements
are not claimed. The research direction is a documented, executable specialization.

## Sources

[1] Lean community, [Mathlib.Order.Heyting.Basic](https://leanprover-community.github.io/mathlib4_docs/Mathlib/Order/Heyting/Basic.html).
Definitions and the implication adjunction; accessed September 11, 2026. Citing
these library definitions does not mean the proofs above were checked in Lean.

[2] Katrin M. Dannert, Erich Grädel, Matthias Naaf and Val Tannen,
[Generalized Absorptive Polynomials and Provenance Semantics for Fixed-Point Logic](https://arxiv.org/abs/1910.07910), 2019.
Related provenance foundations, not a priority claim for this example.

[3] The Stacks Project authors, [Definition 6.9.1, tag 0072](https://stacks.math.columbia.edu/tag/0072).
The established sheaf equalizer condition underlying the descent discussion.
