# Optimal descent certificates for partial observation records

## Problem and proposed semantics

Extend reconstruction with the dual integration problem: combine independently
produced, coherent partial records without testing every pair at every shared
coordinate. Use the existing finite graph of pure unary observation maps. A patch
is a successor-closed subset of coordinates, and all patches together must cover
the graph. This is not arbitrary dependency inference or stream-domain equality.

Sheaf gluing is established category theory. The candidate observation is the
exact cost formula below and its constructive countermodel. Historical novelty
is unverified; correctness must rest on the proof, not a priority claim.

## First-principles derivation

Let X:C -> Set be a diagram, and U_i -> 1 the subterminal functors corresponding
to a successor-closed cover. A coherent patch is a natural transformation U_i -> X.
A comparison (v,i,j) identifies the values of patches i and j at coordinate v.

For a comparison set T and coordinate w, let K_w(T) have vertices I(w), the
patches containing w, and edge i--j whenever T compares i and j at some v with
an arrow v->w. All K_w are connected exactly when T ensures unique gluing for
every finite-valued diagram.

For sufficiency, naturality propagates equalities along arrows, connectedness
identifies all copies of each coordinate, and successor closure makes the glued
record coherent. The cover gives uniqueness. For necessity, put Q_T(w)=pi_0 K_w.
An arrow sends the class of patch i to the class of i; this is well-defined and
functorial. Each patch chooses its own class. Every selected comparison holds,
but a disconnected K_w supplies incompatible local records. This finite
countermodel uses at most as many values per coordinate as there are patches.

Categorically Q_T is the coequalizer of the pairs of maps from C(v,-) to the
coproduct of U_i selected by T. The comparison presentation is complete exactly
when the resulting map Q_T -> 1 is an isomorphism.

Collapse reachability to strongly connected components. For component A, form
B_A on I(A) by making I(B) a clique for every strict predecessor B<A, and let
b_A be its number of components. Assign each coordinate a nonnegative comparison
cost c_v, independent of the pair compared. Then

    minimumComparisons = sum_A (b_A - 1)
    minimumCost = sum_A (b_A - 1) * min_{v in A} c_v.

To prove the lower bounds, comparisons from strict ancestors can only connect
vertices within blocks of B_A; incomparable or downstream tests cannot help at A.
Therefore at least b_A-1 comparisons inside A are necessary, each at least as
expensive as its cheapest coordinate. For attainment, process components in
topological order, choose a cheapest coordinate and compare one representative
of the first inherited block with representatives of all remaining blocks.
These comparisons attain both bounds, including when some costs are zero.

For x->z and y->z, patches {x,z}, {x,y,z}, {y,z} need only the two upstream
comparisons. All three copies at z already agree transitively. All-pairs checking
would perform five comparisons. Local coherence is an essential hypothesis.

## API, lowering and invariants

Propose three build-time exports through src/compiler.mjs:

- planDescent(graph, patches, {costs?}): an immutable minimum-cost comparison plan.
- verifyDescent(graph, patches, comparisons): independently replay actual tests
  along arrows and check pointwise connectivity; do not trust optimizer metadata.
- descentSource(name, graph, patches, options): generate ordinary staged Asslang.

Patches are {name,nodes} records. Costs are {node,cost} overrides, defaulting to
one. Generated protocols take the map dictionary and provide agree, check, glue
and join. agree assumes coherent pieces and runs the reduced overlap certificate.
check validates every local edge equation before agreement. glue performs unchecked
first-owner assembly. join explicitly requires check before exposing a result.

All supplied equality predicates must be actual equality, or equivalences respected
by every map. Approximate floating-point equality may not be transitive; numeric
+0/-0 equality is not respected by reciprocal. These laws are not inferred.
Unused pure work remains lazy; a validity field is not a refinement type. Trapping
maps/predicates may trap, and omitted checks need not preserve the trap behavior of
a naive implementation. No effects may be hidden in a pure map dictionary.

Keep existing syntax, inference, JTE, Wasm emission, ASABI 1 and loop-budget
accounting unchanged. Generated functions and records stage away; no guest graph,
allocator, closure ABI, implicit I/O or new host authority is introduced. Loops
inside demanded arrows and comparators consume the enclosing invocation budget.

Reuse the graph limits of 256 nodes, 2,048 edges and 64-character identifiers.
Bound covers to 32 patches, 2,048 memberships and 4,096 local edge equations;
bound verification certificates to 4,096 comparisons. Costs are integers from
zero to one billion. Use iterative graph traversals, bounded partitions and
balanced conjunctions. Existing compiler and ABI limits remain independently in
force. Static costs are estimates, not maxLoopIterations units or performance
measurements.

Alternatives are handwritten joins, naive all-pairs checks, pairwise source-basis
checks that miss cross-patch transitivity, runtime sheaf objects with unnecessary
allocation, or a much larger refinement-type change. Explicit generation keeps
the assumptions inspectable and uses the existing checked pipeline.

## Validation plan

The unchanged main 13c52a7fa20f7133f88fcf6229f66aa9ab620567 passed all 877 Node
tests. Its CI source archive reconstructs tree 5b677be6fd1fa8ddd587fb89eb82126f431390a3.

Before publication, exhaust small covers and all comparison subsets with an
independent closure oracle; brute-force counts and costs; construct countermodels
for insufficient certificates; directly enumerate Boolean diagrams and sections.
Test cyclic/disconnected covers, weighted representatives, malformed/injected
inputs, snapshots and resource bounds. Execute generated joins and their failure
cases, mixed types, reconstruction composition, demand, effects, ABI, source-local
diagnostics, caches, causal streams and exact loop budgets across all eight
lowering configurations. Compare selected generated and handwritten Wasm bytes.
Run the full Node and Chromium suites and required examples. Reconcile the design
with experiments and record exact results and limitations in a new report.

## Established foundations

The Stacks Project, tag 0072: https://stacks.math.columbia.edu/tag/0072

Lean Mathlib, SheafCondition.EqualizerProducts:
https://leanprover-community.github.io/mathlib4_docs/Mathlib/Topology/Sheaves/SheafCondition/EqualizerProducts.html

J. Sanchez Gonzalez and C. Tejero Prieto, Etale Covers and Fundamental Groups of
Schematic Finite Spaces (2022), section 2:
https://doi.org/10.1007/s00009-022-02125-z

These sources establish the surrounding theory, not the priority of this exact
optimization formula. A search that finds no prior statement cannot certify
worldwide originality.
