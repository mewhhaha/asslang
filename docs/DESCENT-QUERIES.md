# Query-directed descent and the metric of evidence

## Problem and scope

Full descent establishes that every partial record agrees wherever it overlaps.
Sometimes a consumer only needs one equality: two modules must report the same
summary, while their raw observations or other modules may legitimately differ.
Global completion is too strong for that task. The completion matroid deliberately
does not describe logical implication of arbitrary incomplete evidence.

This feature derives exact single-goal implication and minimum evidence cost,
exposes transport proofs that can be checked without trusting a shortest-path
optimizer, and generates a demand-local sufficient guard. It extends the
comparison-quotient construction in DESCENT-EXTENSIONS.md, not the language's
notion of equality or its effect system. Historical originality is unverified.
Shortest paths, congruence reasoning and Lawvere metric categories are established
mathematics [1,2]; the claim here is a self-contained derivation in this observation
model and an application with explicitly limited trust.

Baseline: merged main 0a32b7607150d087237f0ca6cf6abc84b17b46bb has tree
01eda99467fa4c634a428dead54e41d40345562c. The supplied research archive reconstructed
that exact tree, verified against GitHub. Before edits, all 936 Node tests passed.

## Exact logical consequence from the comparison quotient

Let C have finitely many objects, X:C -> Set, and let successor-closed subterminal
patches U_i cover C. A coherent local family is a collection U_i -> X. Write I(w)
for patches containing w. Each evidence item e=(v,i,j) compares copies i,j at v.
For a set S of evidence, K_w(S) has vertices I(w) and edges i--j from every test
(v,i,j) in S with an arrow v->w, including identity arrows.

**Theorem 1.** S implies the single goal s_a(w)=s_b(w), uniformly over every
finite-valued diagram and coherent local family, exactly when a,b are connected
in K_w(S). No other coordinate or patch must have global agreement.

The forward construction is transport and transitivity: each edge comparison
propagates to w by naturality, and a connecting path proves the goal. Conversely,
Q_S(v)=pi_0 K_v(S), with arrows sending [i] to [i], is a finite functor. Its local
sections choose each patch's own class. All S comparisons hold; when a,b are
disconnected their values at the requested w differ. This is a goal-specific
countermodel even when other coordinates have unrelated failures. The construction
respects identities and composition, including relations between arrows.

Categorically, let P=coproduct_i U_i and form the coequalizer Q_S imposing S on P.
The two goal copies determine maps C(w,-) -> Q_S. The goal is implied precisely
when these maps coincide: by Yoneda it suffices to compare their identity values
at w. Any coherent local family satisfying S factors through Q_S. Thus testing
logical consequence is testing equality in a presented object, not asking whether
Q_S -> 1 is an isomorphism as full gluing would require.

## Cheapest evidence and a functor into metric spaces

Let R be retained comparisons and L a finite list of allowed candidate tests,
with nonnegative costs c_e. At a goal coordinate w, put all tests at ancestors of
w into a weighted graph on I(w): R edges have cost zero and candidate edges cost
c_e. Define d_w(a,b) as shortest-path distance, with infinity when disconnected.

**Theorem 2.** The minimum sum of candidate costs of a subset T of L such that
R union T implies the goal is exactly d_w(a,b).

A shortest path gives sufficient tests at its candidate edges. Conversely any
sufficient subset contains an a--b path. Remove cycles from that path. Each
candidate on the resulting simple path is used once, so its cost is at most the
sum paid for the subset. This proves both inequalities. The argument needs
nonnegative costs and single-goal, pairwise evidence. Retained comparisons are
logical assumptions in this optimization, not automatically trusted runtime data.

An optimal path can use at most |I(w)|-1 edges (zero for a=b). Costs are the primary
objective. Among minimum-cost paths the implementation minimizes the number of
new candidates, then the total number of path edges. This does NOT minimize cost
and comparison count independently: one direct edge of cost 9 versus a two-edge
path of cost 3 is a counterexample. Multiple simultaneous goals can share edges;
independent shortest paths do not establish a joint-cost optimum.

**Theorem 3 (free evidence metric).** Every d_w is an extended pseudometric.
For each arrow v->w, inclusion I(v) -> I(w) is nonexpansive:

    d_w(i,j) <= d_v(i,j).

Every proof path available at v is available at w; additional evidence or mediating
patches can shorten it. Diagonals are zero, edges are symmetric, and concatenating
paths proves the triangle inequality. Distinct copies may have distance zero.
These facts define a functor C -> extended pseudometric spaces and nonexpansive
maps, a symmetric case of Lawvere's enriched perspective [1].

More strongly, d is the pointwise greatest family of extended pseudometrics on
I(w) such that all inclusions are nonexpansive and each evidence edge has distance
at most its declared cost at its source (retained edges at most zero). To prove
maximality, transport each generator bound to w and use the triangle inequality
along a path. Any such metric delta satisfies delta_w(a,b)<=d_w(a,b). The path
metric itself satisfies all those conditions.

This has a free universal property. A natural family of maps I(w)->Y(w) into any
metric diagram satisfying the generator bounds is uniquely nonexpansive from d:
apply those bounds along every evidence path. Costs measure proof acquisition,
NOT numerical distance or approximate equality of Asslang values. A cost of zero
means available evidence is free under the model, not that its comparison is
logically true without an assumption or runtime check.

## A checkable optimality certificate from metric potentials

For a finite optimum C=d_w(a,b), define pi(i)=min(d_w(a,i),C), interpreting
min(infinity,C)=C. Then pi(a)=0, pi(b)=C, and for every eligible candidate edge
(i,j), |pi(i)-pi(j)|<=c_e; retained edges have equal potentials. These bounds
follow from the triangle inequality and truncation being nonexpansive.

Conversely, ANY finite potentials with these generator inequalities imply that
every candidate subset proving the goal costs at least pi(b)-pi(a): sum the
inequalities along its connecting path. A valid proof of cost C and potentials
with difference C therefore certify the exact optimum, without rerunning the
shortest-path search. This is a concrete dual witness: a short transport proof
is an upper bound, and a nonexpansive scalar probe is a matching lower bound.
The construction is the distance-to-a-point perspective of enriched metric
reasoning, specialized to a finite, executable certificate.

Plans include one finite potential per patch containing the goal. The extra
helper verifyDescentQueryCost(graph, patches, options, proof, potentials) checks
the simple proof, recomputes its cost, and checks the potential inequalities on
all eligible evidence. It verifies primary cost optimality only, not secondary
tie-breaking. Proof or potential corruption returns false. For reflexive or
zero-cost goals all potentials can be zero. Impossible plans have null potentials.

## Local transport proofs, without global coherence

Each proof step stores one oriented evidence edge i--j at v and a directed list
of original graph-edge indices v->...->w. A simple chain of such steps ends at
the requested patch b. Its validity can be checked by inspecting evidence indices,
patch endpoints and the declared transport edges; no optimality metadata or
shortest-path algorithm is needed.

**Theorem 4 (support-local sufficient guard).** Even for arbitrary, globally
incoherent partial records, the goal follows if: (a) every selected comparison
holds at its source; and (b) each patch on a proof step satisfies the local arrow
equations along that step's transport path. Proof: use the checked local equations
to transport each selected equality and then use transitivity at w. No other
patch or arrow equation is used. Only the maps on these paths need to preserve
the supplied equality relations.

This does not make the guard necessary. With a noninjective map, target values
can agree despite unequal upstream evidence. A failed sufficient guard means
"this proof did not establish the goal", not "the goal is false". Likewise a
successful guard says nothing about a full global join. This is not a weakest
runtime precondition, an optimizer for the number of local arrow equations, or a
proof that user functions are total. Proof paths choose shortest transports in
edge count deterministically; shared local equations are deduplicated afterwards.

## API and generated representation

Add the following exports through src/compiler.mjs (plus the cost verifier above):

- planDescentQuery(graph, patches, {query, retained?, candidates}) returns immutable
  normalized inputs, complete, minimumCost (null if impossible), additionalCount,
  a proof array, selected candidate and used-retained indices, required local
  equations and support fields. An impossible plan includes Q_(R union L) with
  its witness set to the requested query, not an unrelated global obstruction.
- verifyDescentQuery(graph, patches, options, proof) validates a simple transport
  proof. Bad graph/options throw; invalid or overlarge proof data returns false.
  It proves sufficiency, not shortest-path optimality or truth of runtime data.
- descentQuerySource(name, graph, patches, options) rejects impossible plans and
  emits an ordinary protocol with checkEvidence, check and select.

A query is {node,left,right} with both patches containing node; identical endpoints
are allowed and need an empty proof. Candidate items are {node,left,right,cost?},
with distinct patch endpoints and default cost one. Retained items omit cost.
Candidates are explicitly supplied; the goal comparison is not implicitly free
or available. Comparison semantics at a coordinate must be the same for every pair.

checkEvidence rechecks ALL evidence on the selected proof, including used retained
facts, but assumes the necessary local coherence. check additionally checks the
support-local arrow equations. select returns the left goal value under an explicit
require of check. None of these methods trusts a stale retained value or silently
turns a plan into a proof of data. There is no conditional skip-retained method
in this API. Costs nevertheless optimize incremental evidence acquisition when
retained facts are already established externally.

Source uses only support fields and maps, with numbered local bindings and
validated field identifiers. Unrelated patches and coordinates are not required
by generated types; irrelevant fields supplied by a caller remain unused. Pure
checks remain demand-sensitive; projecting a select result must demand its guard.
Map/predicate laws, NaN, signed zero, approximate comparisons, and partial/trapping
functions retain the limitations of DESCENT.md. Equivalent rather than identical
values give agreement only up to that equivalence. No effects may hide in maps.

Existing graph/cover limits apply: 256 nodes, 2,048 edges, 32 patches, 2,048
memberships and 4,096 local equations. Retained plus candidate tests are limited
to 4,096; costs are safe integers in [0,1e9]. Simple proof paths have at most 31
steps; each transport has at most V-1 edges. Bounds are checked before reading
unbounded proof arrays. Retained/candidate/query fields and graph properties are
captured before reuse; arbitrary hostile proxies are not sandboxed.

Beyond cover validation, reverse BFS costs O(V+E), the small Dijkstra search
O(P^2+T), and proof materialization O(PV), with P patches and T evidence items.
Only reverse-reachable evidence is offered to the shortest-path search. Countermodel
generation uses the existing independent forward-propagation implementation. Source
size is linear in support, evidence and deduplicated local equations. Existing
source, inference, staging and ASABI limits remain independent and unchanged.
No parser, ABI, emitter, budget policy, guest allocator, runtime graph, dependency
or host authority changes. All demanded loops spend the enclosing export budget.

Alternatives are full descent (too strong), blindly trusting matroid closure
(unsound for partial evidence), direct target equality (often available but not
always cheapest; include it explicitly as a candidate), a general e-graph solver
(more scope than the unary naturality fragment), and runtime proof objects (not
needed for static plans). The typed generated guard is a sufficient condition,
not a refinement-type extension.

## Planned verification and related work

Exhaust small graphs/covers, evidence subsets and goals with an independent
Boolean closure oracle; check goal countermodels. Enumerate candidate subsets to
confirm minimum costs and tie counts, with retained facts and zero weights.
Check metric triangle, symmetry, and nonexpansiveness; counterexamples for
independent count optimality and globally incomplete but locally provable goals.
Mutate proof indices, directions, paths and dual potentials; verify rejection.
Check primal/dual equality and reject sufficient but unnecessarily costly proofs.
Enumerate finite value assignments to check the support-local guard implication
without assuming other coherence equations.

Execute generated guarded selections, subset-shaped inputs, stale evidence,
irrelevant incoherence/traps, noninjective false negatives, mixed types, effects,
ABI, source-local errors, cache isolation, causal streams and loop budgets under
all eight lowering configurations where applicable. Compare selected generated
Wasm against handwritten equivalents. Run full Node/Chromium tests, examples,
syntax/diff checks, and record only executed results in a new validation report.

[1] F. W. Lawvere, Metric spaces, generalized logic and closed categories (1973),
reprinted with commentary, Reprints in TAC 1 (2002).
https://www.tac.mta.ca/tac/reprints/articles/1/tr1abs.html

[2] O. Flatt, S. Coward, M. Willsey, Z. Tatlock and P. Panchekha, Small Proofs from
Congruence Closure, FMCAD 2022. https://arxiv.org/abs/2209.03398
Their general congruence-proof minimization is not the restricted single-goal
transport model here; no solution of the general optimization problem is claimed.

[3] The Stacks Project, Definition 6.9.1 (0072), sheaf equalizer condition.
https://stacks.math.columbia.edu/tag/0072

Accessed 2026-09-11. These establish background, not priority for the particular
synthesis. Targeted searches of weighted descent, shortest-path equality proofs
and evidence metrics did not establish originality. Written proofs, executable
verification and historical novelty are distinct claims.

## Implementation and validation

The four helpers are implemented in src/descent-query.mjs and exported from
src/compiler.mjs. Every successful plan checks its transport proof and matching
dual cost certificate before returning. Run `npm run example:descent-query` and
`npm run test:descent-queries`. See [executed validation and limitations](DESCENT-QUERIES-VALIDATION.md).
