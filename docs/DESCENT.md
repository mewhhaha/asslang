# Optimal descent certificates for partial observation records

## Problem and scope

Reconstruction recovers a coherent record from selected coordinates. The dual
integration problem is to combine records produced by separate modules or caches,
each describing part of the same observation diagram. Comparing every shared
coordinate of every pair of records is sufficient, but can repeat implications
already established upstream or through a third record.

This feature derives a minimum set of overlap comparisons, generates ordinary
Asslang for agreement, full validation and assembly, and independently verifies
comparison sufficiency. It uses the existing pure unary observation graph. It
does not infer relationships from arbitrary programs or identify unrelated event
domains. The minimum is uniform over all set-valued diagrams, not necessarily the
minimum for a particular numerical implementation.

Sheaf gluing and equalizer presentations are established category theory [1,2].
The candidate observation here is the exact componentwise cost formula below,
together with the canonical finite countermodel and its staged implementation.
Historical novelty is unverified: a targeted literature search did not establish
priority, and this may be a known consequence or folklore. The proofs are
self-contained; correctness does not depend on a novelty claim.

## First principles: sections and comparison quotients

Let C be a category with finitely many objects. An observation diagram is a
functor X:C -> Set. A section assigns x_v in X(v) with X(f)(x_v)=x_w for every
arrow f:v->w. Equivalently it is a natural transformation 1 -> X.

A patch U_i is a successor-closed set of objects: v in U_i and v->w imply
w in U_i. It defines a subterminal functor U_i -> 1. Assume the patches cover all
objects. A local coherent record is a natural transformation U_i -> X. We allow
empty patches, repeated patch domains under distinct names, loops, parallel arrows,
and nontrivial strongly connected components (SCCs).

A comparison t=(v,i,j) asks whether local records i and j agree at a common
coordinate v. For a set T of comparisons and each object w, form an undirected
graph K_w(T). Its vertices are I(w)={i:w in U_i}; it has an edge i--j whenever
T contains (v,i,j) and some arrow v->w exists, including identities.

**Theorem 1 (exact descent criterion).** For every finite-valued X, every family
of coherent local records satisfying T has a unique global extension if and only
if every K_w(T) is connected.

**Proof of sufficiency.** Naturality propagates each tested equality along every
arrow. Connectedness, symmetry and transitivity give equality of all local values
at w. Pick any patch containing w to define the global value. For f:v->w, choose
a patch containing v; successor closure includes w, so its section equation proves
the global section equation. The cover proves uniqueness.

**Proof of necessity and explicit countermodel.** Put Q_T(w)=pi_0(K_w(T)), the
set of connected components. If f:v->w, inclusion I(v) subset I(w) sends every
edge of K_v to an edge of K_w, so [i] maps to [i] independently of representative.
These maps respect identities and composition, including any relations in C.
Each patch has a section s_i(w)=[i]. All selected comparisons hold. If K_w is
disconnected, these local sections disagree at w and cannot extend globally.
Every Q_T(w) has at most the number of patches, so finite targets suffice. QED.

Categorically, start with the coproduct of subterminals S=coproduct_i U_i.
For each comparison (v,i,j), the covariant representable C(v,-) has two natural
maps to S, selecting copies i and j. Their joint coequalizer is Q_T. Naturality
identifies maps Q_T -> X with locally coherent families satisfying T. The cover
gives Q_T -> 1. Theorem 1 says that the comparison presentation is complete
exactly when this map is an isomorphism. This is a finite, executable instance of
a universal property, not a new definition of sheaf or a proof of new topos axioms.
For a graph presentation with cycles, its path category may be infinite; Q_T
still has finite fibers and the algorithm only uses finite reachability.

## An exact minimum, not just a greedy reduction

Collapse C's reachability relation to its SCC poset. Patch membership I(A) is
constant within an SCC A. Define an undirected graph B_A on I(A) by making I(B)
a clique for every strict predecessor component B<A. Let b_A be its number of
connected components. Each component has at least one patch because this is a
cover. Assign a nonnegative coordinate comparison cost c_v.

**Theorem 2 (optimal coordinate-cost descent).** The least possible number of
pairwise coordinate comparisons that imply gluing for every finite-valued diagram is

    minimumComparisons = sum_A (b_A - 1).

The least total comparison cost, when comparing at v costs c_v regardless of the
patch pair, is

    minimumCost = sum_A (b_A - 1) * min_{v in A} c_v.

One certificate attains both minima, even with zero costs.

**Lower bound.** Any sufficient certificate makes K_v connected. At A, tests
from strict ancestors only connect vertices inside components of B_A; tests from
incomparable components or descendants cannot propagate to A. Therefore tests
inside A must connect all b_A blocks. Each comparison can reduce the block count
by at most one, so there must be at least b_A-1 such tests. Each costs at least
the cheapest coordinate in A. Sum these disjoint lower bounds over A.

**Construction.** Process SCCs in topological order. Earlier tests already connect
all of I(B) at every B<A, and hence connect each block of B_A at A. Choose the
cheapest coordinate of A and one representative patch per block; compare the
first representative with each remaining representative. This connects I(A)
using exactly b_A-1 tests of minimum cost. Induction proves completeness and
attainment of both lower bounds. For equal costs, declaration order breaks ties.
The use of all strict ancestors is equivalent to using incoming predecessor SCCs:
every earlier membership set is contained in one of those incoming sets. QED.

The bounds concern fixed, pairwise, coordinate-equality certificates. They do not
optimize local coherence checks, input-dependent early failure, instruction counts,
transport cost, or algorithms that exploit particular maps, injectivity, shared
map-key constraints, hashes, or a different observation model. Costs are static
user estimates, not measured performance or units of maxLoopIterations.

A further abstract generalization allows arbitrary nonnegative costs for individual
(v,i,j) tests: contract each B_A and find a minimum spanning tree whose candidate
edges are all tests inside A. The same lower-bound and induction arguments show
that these independent minima sum to the global optimum. This generalized
candidate-edge optimizer is not part of the API in this change.

## Example: transitivity across three patches

Take x->z and y->z, with patches

    left   = {x,z}
    middle = {x,y,z}
    right  = {y,z}.

All-pairs overlap checking makes five comparisons: one at x, one at y, and three
at z. The minimum certificate has two:

    left.x == middle.x
    middle.y == right.y.

At z, the inherited blocks {left,middle} and {middle,right} already connect all
three copies. No additional comparison is needed. This works because the records
are individually coherent; arbitrary z values can fool these two comparisons.
That counterexample is an explicit regression test for the trust boundary below.

## API and generated protocol

Expose these helpers through src/compiler.mjs:

```js
const graph = {
  nodes: ['x', 'y', 'z'],
  edges: [
    { from: 'x', to: 'z', map: 'zero' },
    { from: 'y', to: 'z', map: 'zero' },
  ],
};
const patches = [
  { name: 'left', nodes: ['x', 'z'] },
  { name: 'middle', nodes: ['x', 'y', 'z'] },
  { name: 'right', nodes: ['y', 'z'] },
];
const plan = planDescent(graph, patches);
const complete = verifyDescent(graph, patches, plan.comparisons);
const generated = descentSource('assemble', graph, patches);
// compileSources([generated, {name: 'app.ass', source: ...}])
```

`planDescent(graph, patches, {costs?})` returns an independently owned, deeply frozen
snapshot. It includes normalized nodes/edges/patches, normalized coordinate costs,
SCCs with inherited blocks and chosen comparison coordinates, `comparisons`
(records {node,left,right}), `minimumComparisons`, `minimumCost`,
`naiveComparisons`, `localEquations`, and `owners` (first-declared patch per node).
Patch membership is normalized to graph node order; comparisons use SCC order
by first-declared node, with patch representatives in declaration order. The
mathematical construction can be scheduled topologically, but conjunction order
does not affect sufficiency: all comparisons are required on success.

`costs` is an optional array of {node,cost} overrides. Unspecified costs are one;
values must be safe integers from zero to 1,000,000,000. Duplicates, unknown
coordinates, invalid identifiers, malformed arrays, and non-successor-closed or
incomplete covers are errors. An empty diagram has zero comparisons and cost;
it permits no patches or any allowed number of empty patches.

`verifyDescent(graph, patches, comparisons)` checks a user-provided comparison
certificate, independently of the optimizer and its metadata. It returns a Boolean;
malformed comparisons throw rather than being accepted as an incomplete proof.
It propagates the actual pairs along graph edges and tests connectivity at every
coordinate. It does not evaluate Asslang maps, prove equality laws, or certify
arbitrary record values. Extra or repeated valid comparisons are allowed.

`descentSource(name, graph, patches, options)` returns
{name: '<name>.descent.ass', source, plan}. Its generated definition takes the
map dictionary and returns four staged methods:

- `agree same pieces` runs only the minimum overlap certificate. It assumes each
  piece already satisfies its local edge equations.
- `check same pieces` first checks every edge equation in every patch, then runs
  `agree`. It is the full input-validation boundary.
- `glue pieces` selects each coordinate from its first-declared owning patch.
  This is unchecked, demand-sensitive assembly, not validation or silent repair.
- `join same pieces` is `require (check same pieces) (glue pieces)`, making full
  validation explicit in one call. Demanding a result coordinate demands validity.

Patch names, membership arrays and cost entries are captured once before use;
mutable accessors cannot substitute unvalidated field names during generation.
All methods statically require the declared patch fields and their coordinates,
including isolates. Additional fields are permitted. Empty patches impose no
coordinate constraints. Maps are pure unary Asslang functions, not host callbacks.
Equality predicates in `same` are curried functions at the relevant coordinates;
all check results are constrained to Bool even for a single equation. A typed
identity around the agreement expression imposes this constraint without adding
a runtime Boolean branch; an initial `&& true` experiment emitted an extra
branch in the selected byte-equivalence test.

## Equality, demand and trust

The proof uses actual equality and total functions. A more general implementation
can use equivalence relations only if every supplied map respects those relations;
then the result is unique only up to those equivalences. Approximate floating-point
comparisons generally are not transitive, and ordinary numeric equality identifies
+0 and -0 although some maps distinguish them. NaN is not equal to itself. These
are application responsibilities, not facts inferred by the compiler. The tests
include a deliberately nontransitive comparator to demonstrate the boundary.

`agree` must not be marketed as validation of untrusted pieces. `join` uses full
local equations, but even it depends on the intended, compatible equality semantics.
Trapping maps/comparators may trap; optimized short-circuit checking can skip work
that a naive checker would have demanded. There is no claim of effect equivalence
for partial predicates. Pure checks are not host effects and unused work stays lazy.
A record {valid,value} does not establish a refinement type. Nothing here proves
function totality, floating-point algebra, or stream provenance equivalence.

## Representation, compatibility and resource bounds

This is build-time analysis and ordinary source generation. It changes no parser,
inference, JTE, Wasm emitter, ASABI 1 layout or default optimization. Functions,
records and dictionaries stage away, and loops in maps/equalities use the existing
per-invocation budget. No guest graph, allocator, reflection, dynamic dispatch,
implicit I/O, new import or closure ABI is introduced. Output records still use
the normal ABI storage rules. Typed protocol records cannot escape through ASABI.

Reuse graph validation from reconstruction (256 nodes, 2,048 edges and 64-character
identifiers). Bound covers to 32 patches and 2,048 total memberships, local edge
checks to 4,096, and supplied verification certificates to 4,096 comparisons.
Use iterative reachability and bounded disjoint-set operations; planning costs
O(V(V+E)+V^2 P), verification O(T(V+E)+VP), with V vertices, E edges, P patches
and T comparisons. Generated size is linear in memberships, local equations and
selected comparisons; balanced conjunctions bound expression nesting. Existing
source, type, staging and ABI limits apply independently and are not raised.

Alternatives are handwritten joins; all-pairs checking (simpler but redundant);
pairwise source-basis checks (miss cross-patch transitivity); a new runtime sheaf
object (unnecessary allocation); and an unchecked/refined type system extension
(too large a trust change). Explicit staged protocols preserve current semantics
while providing a mathematically optimal certificate under the stated model.

## Validation design and baseline

The unchanged main 13c52a7fa20f7133f88fcf6229f66aa9ab620567 passed all 877 Node
tests on Node v22.16.0. The downloaded CI source archive reconstructs tree
5b677be6fd1fa8ddd587fb89eb82126f431390a3 exactly.

Independently enumerate small covers and all comparison subsets; build quotient
countermodels for insufficient subsets and brute-force minimum counts/costs.
Check all Boolean map assignments in a bounded family to test the section/gluing
semantics directly, not just one graph algorithm against another. Add randomized
larger diagrams, cyclic and disconnected covers, cheap coordinates inside cycles,
input validation, mutation/injection rejection, and resource-bound tests.

Execute generated protocols with scalar and product coordinates and reconstructed
pieces, inconsistent overlaps/local sections, all eight lowering configurations,
demand/traps, explicit budgets, source-local diagnostics, caches, effects, ABI and
stream restrictions. Compare selected generated/manual exports byte-for-byte.
Run the complete Node and Chromium suites and existing required examples. Record
only executed results in a separate validation report before publishing the PR.

Run the feature with `npm run example:descent` and `npm run test:descent`.
See [executed validation and limitations](DESCENT-VALIDATION.md) for results.

## Sources and novelty boundary

[1] The Stacks Project authors, Definition 6.9.1 (tag 0072), sheaves as equalizers.
https://stacks.math.columbia.edu/tag/0072

[2] Lean community, Mathlib.Topology.Sheaves.SheafCondition.EqualizerProducts,
official library documentation, accessed 2026-09-10.
https://leanprover-community.github.io/mathlib4_docs/Mathlib/Topology/Sheaves/SheafCondition/EqualizerProducts.html

[3] J. Sanchez Gonzalez and C. Tejero Prieto, "Etale Covers and Fundamental Groups
of Schematic Finite Spaces," Mediterranean Journal of Mathematics 19, 229 (2022),
section 2: finite posets and functor descriptions of sheaves.
https://doi.org/10.1007/s00009-022-02125-z

These sources establish the surrounding theory; none is being cited as proving
the exact cost formula above. Searches also covered minimal sheaf presentations,
spanning-tree compatibility checks, and redundant gluing conditions. Search
absence is not evidence that no prior proof exists. The development claims a
proved derivation and an implementation, not worldwide mathematical priority.
