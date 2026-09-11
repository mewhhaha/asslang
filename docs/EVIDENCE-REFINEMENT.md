# Minimum-cost interface refinement

[Principal interfaces](EVIDENCE-INTERFACES.md) · [Practical guide](CATEGORY-THEORY.md)

## Problem and theory-first scope

An interface can diagnose information loss without saying which extra summaries
should be exposed. Given existing summaries, permitted new summaries and their
nonnegative prices, select a cheapest extension that expresses every requested
private contract exactly. Pay for a summary once even when several consumers use
it. Do not simply accumulate each locally cheapest repair.

The implementation builds on the existing exact `.abstract` oracle. It adds
counterexample-guided selection and a separately checked lower-bound certificate,
not a new type system, a change of runtime equality, or a claim to invent CEGAR.
Abstract-domain completion, discernibility methods and implicit hitting-set
optimization are established prior work [1–4]. Historical originality of this
particular synthesis is unverified; the proofs below state its exact model.

Baseline main `8d7184c65315babbee252c530fc5656fd5609557` has tree
`12940fdeea79d9db020c16d95fac70e42f1b6981`. The supplied prior source archive
reconstructs that tree exactly. Before edits the unchanged 1,079 Node tests passed.

## The categorical problem is factorization, not flag inequality

Let X=P(D) be the private Boolean poset, phi:X->P(E) the existing monotone
summary map, and F_j:X->2 the requested monotone contracts. Candidate i is a
monotone summary c_i:X->2. For a selected label set K, write phi_K for phi
augmented with those summaries. We want monotone public contracts A_j with

    F_j = A_j o phi_K.

By the principal-interface theorem this is equivalent to

    phi_K(P) subset phi_K(N)  implies  F_j(P) <= F_j(N)

for all private assignments P,N and every j. Equivalently the preorder induced
by phi_K is contained in the preorder induced by the vector of target contracts.
Different public views alone do not suffice: their direction in the Boolean
order matters. A positive public formula cannot accept a smaller view and reject
a larger one. Exactness concerns realizable views, not equality of the public
necessary/sufficient handles at arbitrary flags.

For every *base ambiguity* (j,P,N) with F_j(P)=true, F_j(N)=false and
phi(P) subset phi(N), define its directional separator set

    D(j,P,N) = {i : c_i(P)=true and c_i(N)=false}.

**Theorem 1 (exact repair criterion).** A candidate set K repairs the interface
for every requested target iff K intersects every such separator set.

**Proof.** If K misses D(j,P,N), all its candidate coordinates preserve the
incorrect order between P and N. So phi_K(P) subset phi_K(N), making exact
factorization of F_j impossible. Conversely, any obstruction to exactness for
phi_K is a base ambiguity and has no selected directional separator. Thus
hitting every separator eliminates all obstructions, and the earlier theorem
constructs exact public contracts. QED.

This is a weighted hitting-set problem presented by a symbolic oracle; the
number of private ambiguity pairs may be exponential. An empty separator proves
that no combination of the permitted candidates can repair the interface. A
candidate with unequal values in the reverse direction does NOT repair a pair.

## Counterexample-guided optimization with a certificate

Maintain a finite set C of witnessed separator clauses. Start with none. Compute
a minimum-cost hitting set K of C, with cardinality as a secondary objective.
Ask `.abstract` whether phi_K is exact for each target. If it is, return K.
Otherwise add the directional separator of a reported ambiguity and reoptimize
from scratch. Candidate choices may be removed or replaced between rounds.

**Theorem 2 (global optimum on termination).** Every exact repair hits C, since
all its clauses have valid ambiguity witnesses. Hence the optimum for C is a
lower bound on every exact repair. When the selected optimum K for C is itself
exact, this lower bound is attained. It is therefore globally minimum in price,
and in cardinality among minimum-price solutions. QED.

Each unsuccessful round adds a clause not hit by the current K, so that same
candidate set can never recur. There are only 2^m sets. Without resource limits,
this proves finite termination; it is not a polynomial complexity claim.
Nonnegative prices allow a cardinality-minimal cheapest solution with no unused
summaries. Existing summaries are fixed, sunk interface choices, not assumed
runtime truth and not charged again.

A returned certificate lists ambiguity pairs and their complete separator sets.
The checker evaluates each pair against the original targets, existing summaries
and every candidate. It then independently rules out a cheaper (or equally priced
smaller) hitting set using bounded branching on an unhit clause. A packing of
disjoint unhit clauses supplies an admissible cost/cardinality lower bound to
prune branches. This search does not call the planner's BDD `.minimum` routine.
Finally it rechecks the selected interface using `.abstract` in fresh sessions.
The semantic abstraction engine is shared; the optimizer and its selection
metadata are not trusted. Invalid certificate data returns false. Resource
exhaustion throws rather than pretending a proof was verified.

Completeness of the clause family is NOT required for a cost certificate: valid
necessary clauses plus a matching exact repair are enough. The checker does not
certify all possible repairs or an entire structural frontier. An impossible
result includes a valid empty separator, sufficient to disprove all extensions.
A corrupted missing clause may or may not matter: reject it when the remaining
lower bound no longer establishes the claimed optimum, not merely because its
history differs from the planner's run.

## A useful stronger consequence and a boundary

**Theorem 3 (positive consumer closure).** If the selected interface expresses
every F_j exactly, it also expresses every contract built from those targets
using constants, conjunction, disjunction and positive simultaneous substitution.

**Proof.** Choose exact public representatives A_j and replace the generators in
the consumer formula by those representatives. Substitution preserves constants,
conjunction and disjunction, so induction yields the private consumer formula
when the result is concretized. QED.

Thus one selected interface supports the entire positive contract fragment
generated by the requested consumers, not just the tested numerical inputs.
This does NOT extend automatically to Heyting residuals. With private a,b and
public x:=a, y:=a AND b, both a and a AND b are exactly expressible. Their private
residual is b, which the interface cannot express: private {} and {b} have the
same public view. Adding target residuals explicitly may require further repair.
It also does not establish general program, effect, temporal or HM-type completeness.

## Shared example: one extra summary instead of two

Private facts are calibrated, leftValid and rightValid. Targets are

    leftReady  = calibrated AND leftValid
    rightReady = calibrated AND rightValid.

The existing interface exposes leftValid and rightValid. Allowed additions are
calibrated (cost 3), leftReady (cost 2), and rightReady (cost 2). Separately,
each target prefers its own cost-2 summary. Their union costs 4. Joint refinement
chooses the one calibrated summary for cost 3, allowing both targets and all
positive combinations of them to be expressed. The cost is a declared schema
price, not measured CPU time, an access-control policy, or a privacy guarantee.

The example will build the selected public algebra from existing plus selected
bindings, call `.abstract` for the exact public predicates, and emit them with
the unchanged `.source` method. Ordinary Asslang computes the current private
facts and public summaries before requiring the guards. No supplied Boolean flag
is authenticated by a plan, and no private equality/coherence law is inferred.

## API and ownership

Add two methods to the existing private `createEvidenceAlgebra` session:

    privateAlgebra.refine(targets, options)
    privateAlgebra.verifyRefinement(targets, options, certificate)

`targets` is an array of `{name,value}` private-owned contracts. `options` has
`retained` (default empty) and required `candidates`. Both list `{atom,value}`
private-owned meanings; candidates additionally allow `cost` (default 1).
All summary names across both arrays are distinct validated identifiers. Target
names are separately unique. Identical formulas under different names remain
distinct priced choices. Every private handle is validated before analysis.

The planner returns a frozen, JSON-serializable certificate with `schemaVersion`,
`complete`, `selected` (candidate indices in declaration order), `minimumCost`,
`additionalCount`, and `separations`. Each separation is
`{target,satisfying,failing,separates}` with private true-atom lists and candidate
indices. Unlisted private atoms are false. Complete results have exact selected
interfaces; impossible results have empty selected lists, null cost/count and at
least one empty separator. Diagnostic `oracleCalls` is not part of the checked
claim. Nothing in the output is a runtime authority handle.

The result can be passed directly to `verifyRefinement`. That method checks the
claimed fields against the CURRENT explicit inputs, not only copied metadata.
Repricing, changing target meanings or changing candidate meanings can invalidate
a certificate. The original private session is read-only on success and failure;
selection BDDs and trial public algebras are separate ephemeral sessions. No new
nodes are interned into a caller session by either new method.

To generate source, combine retained bindings with selected candidates, create
an algebra with those public names, and call its existing `.abstract` and
`.source`. This keeps representation generation separate from selection and
avoids introducing another source language or duplicating the guard emitter.

## Limits and compatibility

Accept at most 8 targets, 64 candidates, and 128 retained-plus-candidate names.
Prices are safe integers from zero to one billion. Default `maxRounds` is 128,
configurable from 1 to 1,024. The separately checked hitting-set search has
`maxVerificationWork` default 200,000, capped at 2,000,000. The latter charges
witness evaluations, clause work and recursive search; each Boolean evaluation
itself follows at most 128 private variables. Over-limit proof arrays are rejected
before traversal. Witness input lists contain at most 128 distinct private atoms.

Every temporary algebra and abstraction workspace uses the receiving private
session's configured node/work limits. These are per session/operation, not a
claim of one aggregate BDD budget for an entire refinement: at most maxRounds
rounds each perform up to 8 exactness checks. Old workspaces are discarded between
rounds. Certificate size is bounded by maxRounds witnesses. Independent checking
can be exponential too; a work-limit error is neither `complete:false` nor a
verified optimum. Exact search, symbolic abstraction and source emission may
fail at different limits. No arbitrary-contract polynomial-size claim is made.

Use BigInt masks only inside the bounded verifier to handle candidate indices
above 31; no integer/prime arithmetic reaches guest code. Existing parser,
inference, JTE, Wasm emitter, ASABI, effect grants, loop budgets, dependencies
and workflow permissions are unchanged. Existing summary/guard purity, totality,
equality and trap-demand caveats remain explicit. Keep the root README short;
link this design and a new validation report from docs instead.

## Verification plan

Compare all small candidate subsets against direct ordered-pair semantics,
without using `.abstract` as the test oracle. Check priced shared targets,
directional separators, unavailable repairs, duplicates, zero prices, constants,
empty interfaces and contract families, positive consumer closure and its residual
counterexample. Corrupt witnesses, separator lists, claimed prices, exactness and
selected sets. Verify that valid alternative optima can pass and that resource
limits are honest. Check namespace ownership, single-read input capture, immutable
certificates and private-session preservation.

Exercise generated exact guards, typed support shapes, local errors, effects,
ABI rejection, cached compilation, demand, projected guards, stream provenance
and raw iteration budgets across all eight lowering configurations where useful.
Include a structured case with more than sixteen candidates and many private
atoms without enumerating private assignments. Run the complete Node suite,
required host/reducer examples and available Chromium suites. Record only actual
execution; proof-assistant verification and independent review remain unverified.

## Primary references and novelty boundary

[1] R. Giacobazzi, F. Ranzato, F. Scozzari. Making Abstract Interpretations
Complete. JACM 47(2), 2000, 361–416. DOI 10.1145/333979.333989.
https://profs.sci.univr.it/~giaco/abstracts/jacm.abstract.html

[2] E. Clarke, O. Grumberg, S. Jha, Y. Lu, H. Veith. Counterexample-Guided
Abstraction Refinement. CAV 2000. DOI 10.1007/10722167_15.
https://doi.org/10.1184/R1/6604547
(The linked author-institution deposit is a later repository posting.)

[3] E. Gamba, B. Bogaerts, T. Guns. Efficiently Explaining CSPs with Unsatisfiable
Subset Optimization. 2021. https://arxiv.org/abs/2105.11763
Related cost-optimal implicit hitting-set methodology, not this interface API.

[4] J. Blaszczyński, S. Greco, B. Matarazzo, M. Szeląg. Dominance-based Rough Set
Approach, basic ideas and main trends. 2022. https://arxiv.org/abs/2210.03233
Ordered discernibility and reductions of summary attributes are related prior work.

Sources checked September 11, 2026. These establish neighboring theory; their
absence of this API does not establish priority. The delivered result is a proved
specialization and tested compiler-side tool, not a world-first theorem claim.
