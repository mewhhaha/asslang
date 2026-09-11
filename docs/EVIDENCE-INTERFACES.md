# Principal evidence interfaces

[Contract algebra](EVIDENCE-ALGEBRA.md) · [Practical guide](CATEGORY-THEORY.md)

## Problem and theory-first scope

A module exposes summaries of private evidence. Substitution already translates a
public requirement into concrete facts; the missing direction is to synthesize the
best public contract for a private requirement. A necessary summary is not a safe
admission rule. We need both the strongest necessary public consequence and the
weakest sufficient public requirement, with an explanation when neither can express
the private predicate exactly.

This extends `createEvidenceAlgebra`, not Hindley–Milner inference or the language
ABI. Galois connections, abstract interpretation, adjoint quantifiers and ROBDDs
are established mathematics [1–3]. The contribution here is a self-contained
specialization, an explicit information-loss witness and a bounded implementation.
Historical priority, proof-assistant verification and independent peer review are
not claimed.

Baseline: merged main `7e2c2e27458933ef4acc6976987d2c4314d364a5` has tree
`69ce38490ef7e451c9c9ecf8b25d144aad2b1544`. The supplied source archive reconstructs
that exact tree, checked against GitHub. Before edits the 1,051 Node tests passed.

## Three adjoints from first principles

Let D be private atoms and E public atoms. Every public atom e has a monotone
meaning phi_e on private assignments S subset D. Define the monotone observation
map phi(S)={e : phi_e(S)}. Contracts are upward-closed families, ordered by logical
implication (inclusion). Substitution is inverse image:

    sigma(A)(S) = A(phi(S)).

For a private contract F define two public contracts:

    necessary(F)(T)  iff exists S: F(S) and phi(S) subset T
    sufficient(F)(T) iff forall S: T subset phi(S) implies F(S).

Both are monotone in T. In the first, enlarging T preserves a witness; in the
second, it reduces the set of private assignments that must be safe.

**Theorem 1 (principal interfaces).** For every public contract A,

    necessary(F) entails A  iff  F entails sigma(A)
    sigma(A) entails F      iff  A entails sufficient(F).

Thus necessary is left adjoint to substitution, and sufficient is right adjoint:

    necessary  -|  sigma  -|  sufficient.

**Proof.** If necessary(F) entails A, each S satisfying F gives phi(S) satisfying
necessary(F), hence A. Conversely, if F entails sigma(A), a witness S for
necessary(F)(T) gives A(phi(S)); monotonicity and phi(S) subset T give A(T).
For the second equivalence, suppose sigma(A) entails F. If A(T) and T subset
phi(S), monotonicity gives A(phi(S)), hence F(S). Thus A entails sufficient(F).
Conversely set T=phi(S) to conclude F(S) from A(phi(S)). QED.

This supplies exact universal properties, not heuristics. Among public contracts
that F guarantees, necessary(F) is the strongest. Among public contracts whose
concrete meaning guarantees F, sufficient(F) is the weakest. On actual views:

    sigma(sufficient(F)) entails F entails sigma(necessary(F)).

Using necessary(F) as a runtime guard would reverse the useful implication and
can accept invalid private data. Only sufficient(F), evaluated on correctly
computed current public facts, supplies the admission guarantee.

## What the interface forgets

**Theorem 2 (exact expressibility and a separating pair).** The following are
equivalent: (a) F = sigma(A) for some monotone public A; (b) F equals the
concretization of necessary(F); (c) F equals the concretization of sufficient(F);
(d) no private assignments P,N exist with F(P), not F(N), and phi(P) subset phi(N).

For (a) to (b)/(c), apply the two adjunctions and the sandwich inequalities above.
Either equality gives an explicit A, proving the converses. If an ordered pair
P,N exists, a monotone A accepting phi(P) must also accept phi(N), contradicting
exactness. If F is not exact, choose N satisfying sigma(necessary(F)) but not F.
The definition of necessary supplies P satisfying F with phi(P) subset phi(N).
This proves (d) and constructs the witness. QED.

The two public views can be equal, but need not be. A monotone interface can lose
order information even while distinguishing the two assignments. The returned
obstruction must report the ordered relation, not always claim identical views.

**Unreachable views matter.** If a public atom always means true, necessary(true)
requires that atom while sufficient(true) is true. Both concretize to true. Thus
comparing the two public handles is NOT a valid exactness test. Similarly, a
public atom meaning false may make a nonempty public requirement sufficient for
private false, vacuously: that view can never occur under the declared mapping.
User-supplied or forged summary flags cannot be trusted just because a contract
is sufficient. Explicit current-fact computation is part of the runtime boundary.

## Composition and the missing-requirement law

If public vocabulary E is summarized again by B, observation maps compose.
Substitutions compose in reverse direction. Uniqueness of adjoints gives
necessary_(psi o phi)=necessary_psi o necessary_phi and likewise for sufficient.
These equalities also follow by applying each adjunction twice to arbitrary
contracts. Abstracting through several module boundaries agrees with abstracting
through their composed summaries. This does not make lossy interfaces lossless.

The right adjoint also restores a useful exact residual law. For a public
guarantee G and a private target F,

    sufficient(residual(sigma(G), F)) = residual(G, sufficient(F)).

For any public W, W entails the left side iff sigma(W) and sigma(G) entails F,
iff sigma(W and G) entails F, iff W and G entails sufficient(F), iff W entails
the right side. Antisymmetry proves equality. This is an adjunction calculation,
not an assertion that arbitrary substitution preserves Heyting implication.
The earlier counterexample to residual preservation remains valid.

## Concrete interface refinement

Private atoms leftValid, rightValid and reviewed describe a component needing
F=leftValid AND rightValid. A coarse interface exposes

    someValid   := leftValid OR rightValid
    reviewedPair := leftValid AND rightValid AND reviewed.

The principal necessary contract is someValid. The principal sufficient contract
is reviewedPair. The interface cannot express F exactly: valid but unreviewed
pairs and invalid pairs can both present only someValid. Checking just someValid
can accept an invalid pair; checking reviewedPair is safe but rejects some valid
pairs. Add public pairValid := F and the representation becomes exact on actual
views. This provides a concrete diagnosis and repair of an under-informative API.

An implementation may generate ordinary Asslang predicates for the public
contracts or concretize them through the existing simultaneous substitution API.
The example will compute leftValid/rightValid from current numeric inputs, use
reviewed as an explicit Boolean input, and require the sufficient predicate before
returning their sum. These are Boolean contract guarantees, not authentication,
cryptographic trust, or verified refinement types.

## Proposed API and symbolic algorithm

Add one method to an existing algebra:

    publicAlgebra.abstract(privateContract, [{atom, value}, ...])

Each binding names a public atom and its meaning, a contract owned by the SAME
private session as privateContract. Every public atom must be bound exactly once,
even if it does not occur in the eventual result. Duplicate, unknown, missing,
sparse, forged or mixed-private-session bindings fail before analysis. Binding
and mapping are simultaneous; private/public names may coincide safely.

Return a frozen object with `necessary` and `sufficient` public-session handles,
`exact`, and `obstruction` (null for exact results). An obstruction contains
`satisfying`, `failing` (lists of true private atoms), `satisfyingView` and
`failingView` (true public atoms). It certifies F on the first, not F on the second,
and inclusion of their views. These are synthetic Boolean assignments, not
observations about the user's real values. No private intern-table identifiers
or authority tokens escape.

Use a private, ephemeral Boolean BDD workspace. Copy only needed source DAGs,
without allocating anything in the private session. The public transaction's
node/work bounds also bound the workspace and all symbolic steps. Memoized
recursion over public variables builds output diagrams:

* For necessary, start with the private condition C=F. Choosing public atom e
  false adds constraint not phi_e; choosing it true adds no constraint. At a leaf,
  accept iff C is satisfiable.
* For sufficient, start with bad states C=not F. Choosing public atom e true adds
  phi_e; choosing it false adds no constraint. At a leaf, accept iff C is empty.

These are exactly the quantified definitions, since phi(S) subset T constrains
only atoms absent from T, and T subset phi(S) constrains only atoms present in T.
Use `(public position, private root)` memoization and canonical public nodes;
prune empty private conditions. After each public decision, existentially eliminate
private variables that occur in no remaining summary formula. Such variables can
no longer affect future constraints; the distributive law for existential
quantification over a conjunction independent of that variable proves this early
elimination sound. Memoize these eliminations as well, so irrelevant decision
history does not create distinct states forever. This avoids enumerating private assignments,
but intermediate or output diagrams may still grow exponentially.

Concretize both results in the same workspace and compare canonical private
roots to F for exactness. If not exact, find a satisfying assignment of
sigma(necessary(F)) AND not F, then an F-assignment whose view lies below it.
Validate the witness fields against the declared formulas before publication.
Existing public nodes and private sessions remain usable after node/work failures;
roll back public allocations and discard the workspace. A separate private session is not mutated. If source and receiver are the same
session, only its normal transactional result allocation changes the session;
the analysis still uses private copies of input nodes.

## Resources, representation and alternatives

Keep existing bounds: at most 128 atoms per session, default 8,192/max 65,536 nodes
including terminals, default 200,000/max 2,000,000 operation steps. The workspace
gets the receiving session's node cap separately, so at most that many temporary
nodes and that many retained public nodes exist per call. Charge copying,
Boolean operations, transfer states, concretization and witnesses to one work
budget. Memo tables are operation-local; input loops are bounded to 128 bindings.
Algorithm depth is bounded by the two vocabularies, not by private assignment
count. Worst-case work/output remain exponential; exceeding a budget is an error,
never a silently weakened contract or an `exact:true` fallback.

No changes to parser, HM inference, JTE, Wasm emitter, ASABI 1, effects or loop
accounting. The new contracts use the existing `.source` emitter with its 512-node
bound; old emitted source remains unchanged. Current facts and any intended
equality/coherence laws must still be established explicitly. Canonical BDD order
can differ from arbitrary handwritten partial-predicate demand. No runtime graph,
guest allocator, implicit I/O, dependency or workflow permission is introduced.

Alternatives are manually approximated public contracts (easy to confuse
necessity and sufficiency), enumerating assignments (a useful independent small
oracle), simply replacing hidden atoms with constants (only correct for special
coordinate projections), or broad dependent/refinement-type inference (a larger
semantic change). General monotone summaries and checkable information-loss
witnesses fit the existing explicit build-time contract layer.

## Validation plan

Exhaust all 20 private three-atom monotone contracts and all pairs of them as
meanings for a two-atom public interface. Compare both bounds to direct quantified
truth tables, check both adjunctions against every two-atom public contract, and
verify exactness/witnesses. Check composition and the right-residual law, including
unreachable views, distinct ordered views and strict necessity/sufficiency gaps.
Compare coordinate hiding against independent constant-cofactor expectations.
Test constants, empty vocabularies, repeated meanings, reverse variable orders,
self-session mapping, source immutability, forged handles, sparse data, rollback,
large symbolic examples and resource limits.

Execute generated public/instantiated guards in all eight lowering configurations;
show that necessary-only guards can fail, sufficient guards can conservatively
reject, and refinement restores exactness. Test direct Wasm fuel, false facts,
current data, demand, source-local errors, host-effect rejection, cache isolation,
product projection and stream provenance. Run the full Node suite, required host/
reducer examples and available Chromium suite. Preserve the short root README
and historical reports; link a new validation report through docs.

## Primary sources and research boundary

[1] Patrick Cousot and Radhia Cousot. Abstract interpretation: a unified lattice
model for static analysis of programs by construction or approximation of fixpoints.
POPL 1977. https://www.di.ens.fr/~cousot/COUSOTpapers/POPL77.shtml

[2] Lean community. Mathlib.Order.GaloisConnection.Basic (order-theoretic adjoints)
and Mathlib.Order.Heyting.Basic (implication adjunction).
https://leanprover-community.github.io/mathlib4_docs/Mathlib/Order/GaloisConnection/Basic.html
https://leanprover-community.github.io/mathlib4_docs/Mathlib/Order/Heyting/Basic.html

[3] Randal E. Bryant. Graph-Based Algorithms for Boolean Function Manipulation.
IEEE Transactions on Computers 35(8), 1986, pp. 677–691.
https://ieee-ceda.org/media/graph-based-algorithms-boolean-function-manipulation

[4] David Darais and David Van Horn. Constructive Galois Connections, 2018.
https://arxiv.org/abs/1807.08711

Sources accessed September 11, 2026. These establish the background rather than
historical priority of this exact integration. Citing formal libraries does not
mean this code or these proofs were checked in a proof assistant.
