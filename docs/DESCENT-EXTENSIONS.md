# Relative descent certificates and optimal extension

## Problem, scope and baseline

The descent abstraction finds a minimum overlap certificate when every pairwise
coordinate comparison is available with the same cost at a coordinate. Real
validation plans may retain some previously established comparisons, lose access
to others, or have pair-specific costs. Rebuilding a fixed star need not be
possible or cheapest. A failed plan should also explain its ambiguity with actual
finite values and arrow maps, not just return false.

This change derives the structure of all complete certificates, then applies it
to minimum-cost completion under explicit assumptions and allowed comparisons.
It extends, rather than replaces, `DESCENT.md`. Sheaf equalizers, graphic matroids,
contraction and minimum spanning forests are established theory. Historical
priority of this particular descent representation is unverified. No claim of
new matroid axioms or a new spanning-tree algorithm is made.

The starting source is main `dc650aaee1d002ffdcf58137e272da6bb507b53e`, whose tree
is `022c010e5b30c6d1730ec49646534f06face11aa`. The uploaded source archive matches
that tree. Before implementation, the unchanged source passed all 906 Node tests
on Node v22.16.0.

## First principles and the certificate matroid

Let X:C -> Set be a diagram on a category with finitely many objects, and let
U_i -> 1 be a successor-closed cover by subterminal functors. A coherent local
family consists of sections U_i -> X. Comparisons (v,i,j) impose equalities of
the two local values at v. For a set T of comparisons, K_w(T) connects the patches
at w by tests at every coordinate reaching w. The earlier descent theorem proves
that T forces unique gluing in every finite-valued diagram exactly when every
K_w(T) is connected. Its necessity witness is Q_T(w)=pi_0 K_w(T).

Collapse reachability to strongly connected components A. Let I(A) be the patches
containing A. Let B_A be the graph on I(A) obtained by making I(B) a clique for
every strict predecessor B<A; write P_A for its connected-component partition.
Construct a multigraph H_A with vertices P_A. Every legal test (v,i,j), v in A,
is an edge from the block of i to the block of j. Parallel edges and loops are
retained as labelled comparisons. Write M for the direct sum of the cycle
matroids of these H_A. It is graphic: take the disjoint union of the H_A.

**Theorem 1 (global completeness is matroid spanning).** A comparison set T is
universally sufficient for unique gluing if and only if T spans M. Equivalently,
for every A the edges of T inside A connect all vertices of P_A. Consequently,
the inclusion-minimal complete certificates are precisely the bases of M.

**Proof.** If T is sufficient, K_w(T) is connected at A. Every strict-ancestor
comparison has both endpoints in one block of B_A. No other component can send a
test into A. Contracting B_A therefore leaves a connected graph formed by tests
in A, so T spans each summand. Conversely suppose every such graph is connected.
Induct over a topological order of the SCCs. Tests at strict predecessors already
connect all of each I(B), so their propagation connects every block of B_A. The
tests in A connect these blocks and hence all of I(A). This proves connectedness
at every coordinate, and the descent criterion supplies unique gluing. QED.

In particular define

    r(T) = sum_A (|P_A| - components(H_A restricted to T)).
    r_full = sum_A (|P_A| - 1).

Then T is complete exactly when r(T)=r_full. All minimal complete certificates
have r_full tests. If B and D are two minimal complete certificates and e is in
B but not D, removing e splits one tree; some edge of D crosses that cut. Adding
that edge yields another minimal complete certificate. This gives basis exchange
directly, without taking matroid axioms on faith.

**Important non-claim.** This matroid describes global completion, NOT all logical
consequences of an incomplete test set. For two full patches on x->z, the test at
z is a loop of M: it is unnecessary in every minimal complete certificate. But
it is not implied by the empty set. A constant-two-value diagram has coherent
patches disagreeing at z. Never use matroid closure to erase arbitrary local checks;
only use the proved spanning criterion for complete validation plans.

## Relative completion, restrictions and optimal costs

Let R be comparisons assumed true of the CURRENT local family, and L a labelled
list of permitted new comparisons, each with a nonnegative cost. The problem is
to choose T from L with R union T complete, minimizing sum of costs. Repeated
comparisons may be modelled by parallel labelled edges. R need not be independent.

**Theorem 2 (relative optimum and exact feasibility).** A completion exists if
and only if r(R union L)=r_full. When it exists, the minimum necessary number of
additional comparisons is r_full-r(R). A minimum spanning forest after contracting
R within each H_A attains this count and the minimum possible additional cost.
Equivalently the problem is a minimum-weight basis in (M/R) restricted to L,
provided that restriction has the full residual rank.

**Proof.** A new edge increases rank by at most one, giving the count lower bound.
Contract the connected components created by R in each H_A. The remaining task
is precisely to connect the contracted graph using L. Feasibility is connectivity.
Delete cycle edges from any feasible solution; nonnegative costs do not increase,
and the resulting trees have exactly r_full-r(R) edges. To minimize weight, sort
candidate edges by cost and add each that joins distinct components. For the next
chosen edge, any extending spanning tree has an edge crossing its current cut;
that crossing edge cannot be cheaper than the chosen edge. Swapping it preserves
a spanning tree and cannot increase weight. Induction proves minimum cost and
works for ties and zero weights. Independent summands add their optima. QED.

All prior comparisons count as sunk assumptions, not as new costs. A cheap test
inside an inherited block is a matroid loop and cannot replace a required upstream
comparison. Negative costs, pair-dependent equality *semantics*, batch-cost
sharing, instruction-count minimization and arbitrary dataflow graphs are outside
the model. Costs may depend on the pair, but all tests at a coordinate must use
the same lawful equality.

Categorically, imposing R produces the coequalizer Q_R; imposing T on its images
produces Q_(R union T). This follows directly from the universal property: maps
out of either quotient are exactly coherent local families satisfying both sets
of equations. Iterated reuse is contraction by R and then by T, equivalent to
contraction by their union. It does not validate stale observations or imply that
optimizing each batch retrospectively optimizes all costs paid across batches.

## Executable impossibility witnesses

For an insufficient certificate S, expose Q_S as finite data. At coordinate w,
its values are numbered connected components of K_w(S); each patch's value is the
number of its component. Each declared arrow v->w has a table sending each source
component to the component of any representative patch at w. Equality propagation
makes the table independent of representative, and identities/compositions agree.
There are at most 32 values per coordinate under the existing patch bound.

For an impossible extension use S=R union L: all retained AND every available
comparison pass on these coherent patches, yet a reported pair disagrees. Thus
adding more of the allowed tests cannot resolve the ambiguity. These tables are
an abstract finite diagram, not evaluations or counterexamples of a user's
specific Asslang map dictionary. Distinct arrows sharing one map key are treated
independently in the uniform theorem, as in the existing descent contract.

## API and trust boundaries

Expose three new helpers from src/compiler.mjs:

- `planDescentExtension(graph, patches, {retained, candidates})` returns normalized
  immutable inputs, selected candidate indices, `additional`, `comparisons`
  (retained followed by selected), `rank`, `retainedRank`, `achievedRank`,
  `complete`, `minimumAdditional`, `minimumCost`, and `obstruction`.
- `descentCountermodel(graph, patches, comparisons)` returns null for sufficient
  tests; otherwise returns immutable coordinate classes, arrow tables, local
  section values and a disagreeing pair. It propagates actual tests, not the
  matroid optimizer's inherited partitions.
- `descentExtensionSource(name, graph, patches, options)` requires a complete
  extension and generates the existing agree/check/glue/join methods plus
  `checkAdditional same pieces`, which checks only the selected new comparisons.

`retained` is an optional array of {node,left,right}, default empty. `candidates`
is a required array of {node,left,right,cost?}, default cost one. Nothing is
implicitly available. Candidate order breaks cost ties. Selected checks execute
in cost-then-declaration order; retained checks precede them in full agreement.
Every cost is an integer between zero and one billion. With no solution,
`minimumAdditional` and `minimumCost` are null, `additional` is a minimum-cost
maximum-rank forest (NOT a complete certificate), and `obstruction` is non-null.

Crucially `agree`, `check` and `join` RECHECK the retained comparisons as well.
`checkAdditional` assumes both local coherence and all retained equalities of the
current pieces; it is not validation of untrusted or changed values. There are
no runtime cache tokens or implicit stale-result reuse. The caller is responsible
for retaining only facts that still hold under unchanged values, maps, and
compatible equality predicates. Full join remains the safe validation entry point
under the pre-existing equality contract. It never accepts an impossible plan.

As before, actual equality or map-preserved equivalences are required. Approximate
comparisons, NaN and signed-zero distinctions may violate these laws. Partial
comparators may trap, and changing check order can change which trap is demanded.
A planner's `complete` flag is a theorem about its certificate, not a proof of
current values. `checkAdditional` must not be renamed or presented as a checked join.

## Representation, compatibility, resources and alternatives

Factor the existing pure source emitter into an internal module; preserve the
old generated source byte-for-byte for default plans. Planning and countermodels
remain build-time JavaScript data. Generated functions/dictionaries stage away
through existing inference and JTE. All demanded loops consume the enclosing
export's budget; no new execution boundaries, host capabilities, runtime graphs,
ABI layouts, parsers, dependencies or workflow permissions are introduced.

Retain the existing 256-node/2,048-edge/32-patch/2,048-membership/4,096-local-equation
limits. Bound retained plus candidate entries together to 4,096. Capture graph
properties and comparison fields once before delegating to the existing graph
validator, validate before generation, freeze output recursively,
and use indexed arrays/maps rather than user-named object prototypes. All totals
fit within safe integer precision (at most 4,096 times one billion). Reachability
and partitions use iterative traversals. Beyond the existing planner cost, sorting
is O(L log L) and forest work is bounded by patch count. Every extension is
independently replayed by verifyDescent, costing O((|R|+|L|)(V+E)+VP) in the
worst case. Countermodel replay costs O(|S|(V+E)+VP+EP); its output size is
O(VP+EP). Existing source/type/staging/ABI
limits remain independent and unchanged.

Alternatives include keeping the coordinate-only star (cannot honor arbitrary
available tests), exponential subset search (useful as an independent oracle, not
as production code), opaque cross-invocation tokens (requires a new authority and
lifetime model), or a full runtime matroid library (unnecessary for static plans).
The selected design exposes the conditional optimization without weakening the
full checking path.

## Verification design and sources

Exhaust small covers and all retained/candidate/unavailable assignments; brute-force
feasibility, minimum added counts and pair-specific costs independently. Enumerate
minimal complete certificates and test basis exchange. Check countermodel arrows,
local equations, all assumed/allowed equalities and the reported disagreement.
Include the non-logical-closure example, zero weights, duplicates, restricted
comparisons, cycles, mutable accessors, malformed inputs and resource boundaries.

Execute generated full/conditional checks with good, incoherent and stale pieces;
verify old code-generation byte compatibility, selected handwritten equivalents,
mixed types, demand, effects, ABI, source-local errors, caches, stream provenance
and exact budgets. Run all eight SIMD/fusion/memoization modes where applicable,
the complete Node and Chromium suites, and required examples. Record only executed
results in a separate validation report. No independent peer review or proof
assistant verification is implied by these tests.

Established foundations (accessed 2026-09-11):

1. The Stacks Project, Definition 6.9.1, tag 0072, sheaves as equalizers.
   https://stacks.math.columbia.edu/tag/0072
2. Lean community, Mathlib.Combinatorics.Matroid.Basic, basis exchange and rank.
   https://leanprover-community.github.io/mathlib4_docs/Mathlib/Combinatorics/Matroid/Basic.html
3. Noah Weninger and Ricardo Fukasawa, Interdiction of minimum spanning trees and
   other matroid bases (2024), arXiv:2407.14906, established MST/basis connection.
   https://arxiv.org/abs/2407.14906

These establish background, not the specific descent representation or its
historical priority. Searches for descent/graphic matroid, gluing/comparison
matroid and minimal compatibility presentations did not establish priority.
Absence of a search hit is not a proof of originality.

The new browser checks are registered in both the engine bundle and HTTP harness.
Execution results, including environment-blocked runs, are in
[the validation report](DESCENT-EXTENSIONS-VALIDATION.md). Run the feature with
`npm run example:descent-extension` or `npm run test:descent-extensions`.
