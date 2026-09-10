# Query-directed descent and the metric of evidence

## Problem and scope

Full descent establishes global compatibility of partial records. A consumer may
need only one equality at a specified coordinate while other records legitimately
differ. The completion matroid does not represent logical implication of arbitrary
incomplete evidence. This change derives a single-goal optimizer, explicit proof
and cost certificates, and a support-local generated guard.

## Theory before implementation

Let X:C -> Set be an observation diagram and U_i a successor-closed cover. At a
goal coordinate w, connect patches i,j whenever supplied evidence compares them
at some v with an arrow v->w. A set of comparisons implies equality of patches
a,b at w exactly when those vertices are connected. Naturality and transitivity
prove sufficiency. Necessity is witnessed by Q_S(v)=pi_0 K_v(S), whose arrow maps
send each patch class to the same patch class downstream. Its local sections
satisfy all evidence yet disagree at the requested goal when disconnected.

Give retained comparisons zero cost and permitted candidates nonnegative costs.
The least candidate-subset cost sufficient for one goal is exactly shortest-path
distance: any sufficient subset contains a simple connecting path, and a shortest
path is sufficient. Candidate count is minimized only among minimum-cost choices;
a costly direct comparison can use fewer tests than the cheapest path.

These distances form extended pseudometrics on the patches at each coordinate.
Arrows induce nonexpansive inclusions because evidence propagates forward. The
path distances are the greatest such metric family bounded by each generator's
cost. This gives the free evidence metric, a specialization of established
Lawvere metric reasoning, not a claim to invent enriched categories.

For finite goal cost C, potentials pi(i)=min(d(a,i),C) satisfy all generator
inequalities |pi(i)-pi(j)|<=cost and pi(b)-pi(a)=C. Any such potential gives a
lower bound on all sufficient proofs. A path of cost C and matching potentials
therefore certify optimality without rerunning the optimizer.

Each proof step also records an original-arrow path to w. Selected evidence plus
local coherence equations for the two patches along those paths suffice for the
goal even when all unrelated coordinates are incoherent. This is a sufficient
guard, not an exact decision procedure for equality or a full global join. A
noninjective map can give equal targets despite failed upstream evidence.

## Planned API and trust

Expose planDescentQuery, verifyDescentQuery, verifyDescentQueryCost and
descentQuerySource from src/compiler.mjs. Inputs are a graph, patches, one query,
optional retained evidence and an explicit candidate list with costs. Successful
plans contain a simple transport proof, dual potentials and required support;
failures contain a finite countermodel witnessing the requested disagreement.

Generated checkEvidence rechecks selected evidence, including retained facts.
check also validates local transport equations. select requires check before
returning the left goal value. There is no stale-fact cache token or skip-retained
runtime method. Only support fields and maps are required; unrelated records are
not forced into types or runtime evaluation.

All equalities must be lawful and respected by the used maps. Approximate
comparisons, signed zero, NaN and partial functions retain the existing limitations.
Costs concern acquisition of evidence, not numerical error, loop fuel or measured
performance. This does not optimize multi-goal sharing or local-equation count.

## Representation, alternatives and resources

Generate ordinary staged Asslang; do not change parser, inference, JTE, emitter,
ASABI, effects, budgets, dependencies or workflow permissions. All demanded loops
use the enclosing invocation's allowance. Add no guest graph or allocator.

Reuse the existing graph/cover bounds. Limit retained plus candidate items to
4,096 and costs to integers in [0,1e9]. Simple proof chains have at most 31 steps;
each transport has at most 255 edges. Validate and snapshot input fields, freeze
outputs, use bounded reverse BFS and a small Dijkstra search. Independently check
proofs and potential inequalities. Existing compiler and ABI limits remain intact.

Alternatives are global completion (too strong), direct target checking (make it
an explicit candidate when available), unsafe matroid-closure inference, or a
general congruence solver with much broader scope. Keep the unary observation
fragment and its proof assumptions explicit.

## Validation plan and baseline

Merged main 0a32b7607150d087237f0ca6cf6abc84b17b46bb has tree
01eda99467fa4c634a428dead54e41d40345562c; the source archive reconstructs that
exact tree. The unchanged baseline passed all 936 Node tests.

Exhaust small evidence presentations and goals against subset enumeration and an
independent closure oracle. Check goal countermodels, metric laws, nonexpansive
transport and corrupted proofs/potentials. Enumerate actual finite values without
assuming global coherence. Execute generated guards under all eight lowering
configurations, with support-shaped inputs, stale evidence, irrelevant traps,
noninjective false negatives, effects, ABI, diagnostics, caches and exact budgets.
Run the full Node/Chromium suites and required examples. Reconcile this document
and publish a separate report containing only executed checks and limitations.

## Established foundations and novelty boundary

F. W. Lawvere, Metric spaces, generalized logic and closed categories (1973),
Reprints in TAC 1 (2002): https://www.tac.mta.ca/tac/reprints/articles/1/tr1abs.html

O. Flatt et al., Small Proofs from Congruence Closure, FMCAD 2022:
https://arxiv.org/abs/2209.03398

The Stacks Project, Definition 6.9.1, tag 0072:
https://stacks.math.columbia.edu/tag/0072

These establish background, not historical priority for this specialization.
Originality, proof-assistant verification and independent peer review are not
claimed. Correctness rests on stated proofs and executable checks, not novelty.
