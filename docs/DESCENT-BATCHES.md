# Shared descent proofs and evidence frontiers

## Problem and boundary

Single-goal descent computes a cheapest path of equalities. Keeping only that
path can lose an alternative that a second goal could share. This feature asks
for a set of named goals and pays for each candidate evidence item once, even
when several goal proofs use it. It returns every inclusion-minimal sufficient
set (the evidence frontier), selects a cheapest one, and emits a shared guard.

The starting point is merged main a03652286cbb8afea042d8107e75deee8fad23fc, tree
eae24904757c9444cb4bd12247c748bfbff03794. The supplied source archive reconstructs
that exact tree, checked against GitHub. Its unchanged baseline passed 965 Node
tests on Node v22.16.0. This document precedes implementation.

Provenance semirings, distributive lattices, quantales and Steiner optimization
are established subjects. Historical priority for the specialization below is
unverified. The deliverable is a derivation, explicit certificates and an exact
bounded implementation, not a claim to invent those foundations.

## From scalar distances to shared proof supports

Let C be an observation category with finitely many objects, and let successor-
closed subterminal patches U_i cover it. Coherent local records are natural
transformations U_i -> X for X:C -> Set. Let R be retained comparisons and E a
finite labelled set of permitted candidates. Each comparison identifies patch
copies at one coordinate. Candidate labels remain distinct even if their
coordinates and endpoints coincide.

For S subset E, construct the earlier comparison quotient Q_(R union S). Its
fiber at w is the set of components of K_w(R union S), where comparisons at every
ancestor of w connect the corresponding patch copies. A goal g=(w,a,b) holds
uniformly exactly when a,b are connected. Equivalently the two maps C(w,-) to
the quotient coincide. The quotient's own local sections witness failure when
the goal copies remain distinct. For a batch G, every goal must hold; global
gluing of all patches is not required.

Define U_g={S subset E : S suffices for g}. This is an upward-closed family.
Let A_g be its inclusion-minimal members. Then

    U_G = intersection_(g in G) U_g
    A_G = min_subset { union_(g in G) S_g : S_g in A_g }.

**Proof.** A union of sufficient sets proves every goal. Conversely, any set
proving every goal contains, for each g, a minimal sufficient subset S_g. Their
union is contained in the original set and still proves all goals. Removing
supersets on both sides gives equality. This also handles empty batches (frontier
{empty set}) and impossible goals (empty frontier). QED.

This is not the union of the individually cheapest S_g. For raw->summary, take
a,b containing both coordinates and c containing summary. Goals are a.raw=b.raw
and a.summary=c.summary. Candidates are raw(a,b) cost 4, summary(b,c) cost 1, and
summary(a,c) cost 3. Separately the cheapest proofs use costs 4 and 3, and their
union costs 7. Jointly raw(a,b) plus summary(b,c) proves both for cost 5. Both
{0,1} and {0,2} are frontier members; minimizing too early loses {0,1}.

## The categorical algebra of sharing

Let Q_E be upward-closed subsets of the finite inclusion poset P(E), ordered by
inclusion. Joins are unions, tensor is intersection, unit is all of P(E), and
zero is the empty family. Intersection distributes over arbitrary unions, so
Q_E is a commutative unital quantale (indeed a finite frame). Under the bijection
between upward families and antichains of minimal sets,

    A plus B  = min_subset(A union B)
    A times B = min_subset{a union b : a in A, b in B}.

Alternatives use plus; conjunction and sequential equality composition use times.
Both operations are idempotent, and absorption removes unused extra evidence.
This is the monotone Boolean provenance / free bounded distributive lattice
construction, not a new semiring [1,2].

At each coordinate w assign hom(i,j)=U_(w,i,j). Reflexivity gives unit contained
in hom(i,i). Transitivity gives hom(i,j) tensor hom(j,k) contained in hom(i,k).
These are the axioms of a Q_E-enriched category; symmetry gives symmetric homs.
For every observation arrow v->w, equality propagation gives hom_v(i,j) contained
in hom_w(i,j), hence an enriched functor on the patch inclusions. The homs are
the least such transitive/reflexive families containing the retained generators
at unit and candidate e at the principal upset {S:e in S}. A path argument proves
leastness. The earlier evidence metric forgets this richer sharing information.

For nonnegative candidate prices c, set V(U)=min_(S in U) sum_(e in S)c_e,
with infinity for an empty family. V preserves alternatives:

    V(U union W) = min(V(U),V(W)).

For shared conjunction it satisfies, rather than generally equates,

    max(V(U),V(W)) <= V(U intersection W) <= V(U)+V(W).

The lower bound is restriction to a smaller feasible family. The upper bound
uses the union of cheapest supports and nonnegative prices. Thus evaluation is
lax monoidal into the reverse-ordered min-plus quantale, not a strong monoidal
map. A positive-cost generator obeys U_e intersection U_e=U_e, but c_e+c_e is
not c_e. No identity-preserving scalar evaluation sending this generator to a
positive cost can preserve both intersection-as-sharing and additive cost.
This obstruction explains why shortest distances alone cannot solve proof sharing.

The frontier is independent of prices and represents all monotone availability
and nonnegative repricing questions for the fixed candidates. Every admissible
set contains a frontier member; removing a candidate discards frontier members
using it. These are logical evidence labels, not globally cached runtime facts.

## Exact optimization and its honest complexity

The shared optimum is min_(S in A_G) sum_(e in S)c_e. The implementation breaks
cost ties by cardinality, then the numeric mask of declaration-ordered candidate
indices. It never claims to independently minimize cost and count.

Even with one coordinate and full patches, arbitrary candidate edges and several
pairwise goals give exactly Steiner forest; root-to-terminal goals give Steiner
tree. Hence the general problem contains established hard network-design problems
[3]. We do not claim a polynomial algorithm for arbitrary batches. Frontiers can
be exponentially large (a chain of diamonds gives independent alternative paths).
The exact implementation limits candidates to 16 and goals to 8, so it
has at most 65,536 subsets. Over-limit inputs fail rather than silently returning
an approximate optimum. The existing single-goal and full-descent polynomial
algorithms remain available for larger applicable problems.

Enumeration records the monotone truth function of candidate subsets, with
success propagated from successful immediate predecessors. A subset is minimal
successful iff every one-item deletion fails. A failing subset is maximal iff
every one-item addition succeeds. No cost-based pruning discards zero-price or
more expensive alternatives, since the entire structural frontier is required.

## Two-sided frontier certificates

A few successful sets cannot certify that the frontier is exhaustive. Return:
(1) all minimal sufficient sets F; and (2) all maximal insufficient sets N.
For each M in N give a failed goal and a cut of patches containing its left
endpoint but not its right. No retained or M-selected comparison at an ancestor
of that goal crosses the cut. This proves failure by the exact connectivity
criterion, with the finite quotient as a semantic countermodel.

An independent verifier checks successful boundary sets by equality propagation
without the optimizer's disjoint-set algorithm. It checks negative cuts by local
edge tests and checks that upward(F) and downward(N) partition the Boolean cube.
It checks inclusion-minimality and maximality through one-bit neighbors. These
conditions prove the complete frontier, not merely the selected solution:
monotonicity sends successful boundary sets upward and failing sets downward,
and the partition leaves no unclassified subset. Scanning the certified frontier
then proves the exact selected price. Explicit per-goal transport paths are
checked by the pre-existing verifyDescentQuery, not trusted from the new planner.
The optimality certificate is bounded but not promised to be polynomial-sized.

## Generated guards and API

The compiler exports planDescentBatch(graph,patches,{queries,retained?,candidates}),
verifyDescentBatch(graph,patches,options,plan), and
descentBatchSource(name,graph,patches,options).
Queries are {name,node,left,right}, with distinct validated names and possibly
reflexive endpoints. Evidence has the same fields and costs as single queries.
Plans contain normalized inputs, the complete frontier, selected indices and
cost, per-goal transport proofs, required fields/equations, and used retained
indices. Impossible plans have null cost and a goal-specific finite countermodel.

Plan fields include `frontier.minimal` (sorted index lists),
`frontier.maximalFailures` ({allowed,query,cut}), `complete`, `minimumCost`,
`additionalCount`, `selected`, `proofs` ({name,proof}), `usedRetained`,
`localEquations`, `support`, and `obstruction`. Invalid inputs throw; valid but
impossible batches return `complete:false` and null cost/count. Empty batches
return the singleton empty support and a selected empty result record.

The verifier's checked contract is the frontier, feasibility, selected indices,
primary cost/cardinality fields and named per-goal proofs; it does not attest
unrelated display metadata or supplied runtime values. Malformed proof/certificate
data returns false; malformed graph/options throw. It does not run the batch subset search. It shares input/cover validation with
the earlier descent modules, but does not trust their SCC or optimizer metadata.

For a chosen minimal support, build one proof per goal using only that support
and R. The union of candidates used by those proofs equals the selected support:
otherwise an unused selected candidate could be removed, contradicting minimality.
Deduplicate selected candidate and used retained checks across goals, and deduplicate
transport equations by (patch, original edge index). Generated checkEvidence checks
each used label once; check additionally validates every used transport equation;
select explicitly requires check before returning a record of named goal values.
This is an atomic batch guard: projecting one result still validates the whole
batch. It is not global gluing or runtime search through alternative proofs.

Used retained comparisons are rechecked. No method skips them or creates a cache
authority token. The support-local guard proves all goals even if unrelated
records are incoherent, by applying the existing local transport lemma per goal.
A guard failure does not establish a false goal; noninjective maps can equalize
outputs despite unequal chosen inputs. The planner optimizes evidence acquisition,
not local-equation count, emitted instructions, wall time or trap behavior.

Actual equality, or map-preserved equivalences, is required. NaN, signed zero,
approximate equality and partial functions retain the existing limitations.
Shared checks are pure, not host effects; unused work stays demand-sensitive.
Generated types require only proof-support fields and maps. Output remains the
normal ASABI record representation; no runtime graph, allocator or closure ABI.

## Compatibility, resources and verification plan

Do not change parser, inference, JTE, emitter, ASABI, effects, loop budgets,
dependencies, workflow permissions or existing generators. All demanded loops
consume one enclosing export allowance. Register browser checks in both harnesses.
Graph and cover validation uses the existing limits. Add limits of 16 candidate
labels, 8 goals, and 4,096 total retained/candidate entries. Prices remain safe
integers from zero through one billion. A proof has at most 31 steps per goal;
local equations are bounded by the cover's existing 4,096-equation limit.

Beyond cover validation, preparation costs O(G(V+E+R+P)), enumeration at most
O(2^m G(P+m)), boundary extraction O(m 2^m). Output has at most 2^m boundary
entries, each of bounded label/cut size. Verification uses independent ancestor
closure and Boolean adjacency, boundary tests and O(m 2^m) cube transforms.
Existing compiler/source/ABI limits still apply independently. Snapshot fields
before reuse and freeze returned plain data; do not claim to sandbox hostile JS.

The validation design is to exhaust small graphs/covers, costs and multi-goal subsets
against independent semantic closure and subset enumeration; verify the antichain
algebra and strict sharing counterexamples. Corrupt positive/negative boundaries,
cuts, prices and proofs to test rejection. Enumerate real finite value assignments
without assumed global coherence. Test support-shaped generated inputs, stale
retained facts, guard projection, demand, effects, ABI, caches, source locations,
causal streams and exact shared-loop accounting in all eight lowering modes.
Run full Node/Chromium suites, required examples and boundary cases, then record
only executed results in a separate report. Formal proof-assistant checking and
independent peer review are not implied.

## Sources

[1] Todd J. Green, Grigoris Karvounarakis and Val Tannen. Provenance Semirings.
PODS 2007, pp. 31-40. https://doi.org/10.1145/1265530.1265535
[2] Katrin M. Dannert, Erich Gradel, Matthias Naaf and Val Tannen. Generalized
Absorptive Polynomials and Provenance Semantics for Fixed-Point Logic.
https://arxiv.org/abs/1910.07910
[3] MohammadHossein Bateni, MohammadTaghi Hajiaghayi and Daniel Marx.
Approximation Schemes for Steiner Forest on Planar Graphs and Graphs of Bounded
Treewidth. https://arxiv.org/abs/0911.5143
[4] Oliver Flatt et al. Small Proofs from Congruence Closure. FMCAD 2022.
https://arxiv.org/abs/2209.03398

These sources establish related foundations, not priority for this synthesis.
Research accessed 2026-09-11. No worldwide originality claim is made.

## Implemented validation

The new helpers are implemented in `src/descent-batch.mjs`; existing descent
generators are unchanged. All selected candidate labels are used by the returned
proofs, and the complete frontier and named proofs are independently checked
before a plan returns. The source generator emits one predicate per used label
and one local equation per (patch, original edge).

Run `npm run example:descent-batch` and `npm run test:descent-batches`. The
[executed validation report](DESCENT-BATCHES-VALIDATION.md) records the exact
finite test families, compiler/browser results and unverified boundaries.

The model treats separately declared arrows independently even when the map
dictionary reuses a field. Specific functions, additional equations, injectivity
or shared implementations can imply facts the uniform planner does not exploit.
A countermodel demonstrates insufficiency in the abstract observation model, not
a bug in a supplied numeric map.
