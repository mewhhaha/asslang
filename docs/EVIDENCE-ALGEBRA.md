# Compositional evidence contracts

[Practical guide](CATEGORY-THEORY.md) · [Documentation](README.md)

## Problem and scope

Reusable components should describe requirements in their own vocabulary, then
instantiate those requirements with concrete evidence supplied by another module.
Enumerating every minimal support before composing is not necessary when a
contract has a small symbolic representation. For example, 48 independent
requirements of the form `(a_i or b_i)` have 2^48 minimal supports but a reduced
ordered decision diagram with 96 decision nodes in interleaved variable order.

This feature adds a build-time algebra for monotone Boolean evidence contracts:
canonical conjunction/disjunction, simultaneous cross-domain substitution,
entailment and separating assignments, weakest additional requirements, minimum
priced satisfying supports, and ordinary Asslang Boolean source generation.
It does not replace Hindley–Milner inference or infer evidence laws from code.
The public boundary remains a pure Boolean predicate; callers use `require` to
make it a guard. Facts must be recomputed or explicitly validated for current data.

## What a prime encoding can and cannot do

Assign distinct primes p_e to evidence names. A finite support S can be represented
faithfully by the square-free product P(S)=product_(e in S) p_e. Unique factorization
gives S subset T iff P(S) divides P(T), and

    P(S union T) = lcm(P(S), P(T)).

Ordinary multiplication is wrong for reusable evidence: p*p is not p, whereas
using the same Boolean fact twice still needs it only once. A disjunction also
cannot be represented by a single product without losing its alternatives.
Minimal supports form an antichain under divisibility; conjunction uses pairwise
LCM followed by removal of divisible supersets, and alternatives use antichain
union. This is the existing free distributive/provenance algebra, not a new
factorization theorem [2]. Tiny prime-coded oracles are useful for independent
testing, but production should not factor enormous integers or expand antichains.

A bare commutative product also loses function argument order, arrow structure,
variable binding, scope and the occurs check. A tagged Gödel encoding can preserve
syntax, but merely re-encoding a problem does not provide an inference algorithm.
Damas–Milner principal type schemes [4] are not principal Boolean residuals.
No new principal-type theorem or universal type encoding is claimed here.

## Semantics and substitution theorem

For an ordered finite vocabulary E, a contract F is a monotone function
P(E) -> {false,true}. `all` is conjunction; `any` is disjunction. `always` is
true and `never` is false. A substitution sends each used template atom e to a
monotone contract sigma(e) over a target vocabulary D. For a target support S,

    sigma(F)(S) = F({e : sigma(e)(S)}).

Structural induction on positive formulas proves that substitution preserves
constants, conjunction, disjunction and semantic equality. Induction also proves
identity and associativity: nested component instantiation is independent of
whether the inner substitutions are composed before or after traversal.
The free bounded distributive lattices on vocabularies and these substitutions
therefore compose as lattice homomorphisms. Replacements are simultaneous:
replacing x with y and y with x swaps atoms, rather than recursively looping.

On reduced ordered BDDs of a monotone F, a node with low L, high H and atom e
satisfies L implies H. Consequently F = L or (e and H). Substitution implements
this positive decomposition; it does NOT substitute an atom in place inside a
node whose children might now violate the target's variable order. Rebuilding
with canonical `and`/`or` both preserves semantics and restores target ordering.
This matters when substitutions identify atoms or introduce shared subcontracts.

## Weakest requirements, not snapshot implication

For guarantee G and target F define the monotone residual

    residual(G,F)(S) = for all T containing S, (G(T) implies F(T)).

For every monotone W, W and G implies F exactly when W implies residual(G,F).
For the forward direction, S in W and T containing S imply T in W, so G(T)
forces F(T). For the reverse, choose T=S. This adjunction proves the residual
is the weakest monotone additional requirement: its satisfying family is largest.
This is established Heyting implication [3], extending the bounded eight-label
teaching helper in [conditional evidence](EVIDENCE-RESIDUALS.md).

Let interior(B)(S)=forall T containing S, B(T) for an arbitrary Boolean B.
For a BDD node at e with children L,H, splitting on whether S contains e gives

    interior(node(e,L,H)) = node(e, interior(L) and interior(H), interior(H)).

Constants stay constant; skipped variables are irrelevant. Induction proves
this recurrence. Applying it to Boolean `not G or F` computes the exact residual
without enumerating every assignment. Boolean negation is internal only; users
cannot create a nonmonotone contract through the API.

**Instantiation boundary.** Residuation is NOT preserved by arbitrary atom
substitution. For independent template atoms x,y, residual(x,y)=y. Identify both
with concrete z. Substituting the old residual gives z, but recomputing the
residual of z against z gives true. Always infer the weakest missing requirement
AFTER instantiating module requirements. More generally,

    sigma(residual(G,F)) implies residual(sigma(G),sigma(F)),

because substitution preserves the conjunction/entailment in the adjunction.
The implication may be strict, as the example shows. This gives a concrete rule
for composition: instantiated old requirements are sufficient, not necessarily
principal. The implementation and exhaustive tests retain this boundary.

## Canonical representation and finite algorithms

Use Bryant's reduced ordered binary decision diagrams (ROBDDs) [1]. A node is
(atomIndex, low, high); children are at later variables, equal children collapse,
and equal triples share one node. Fix declaration order for the life of an algebra.
By induction on the first variable at which a Boolean function depends, reduced
ordered representations are unique. Canonical handle identity therefore decides
semantic equality WITHIN one algebra, not across unrelated namespaces/orders.

`and` and `or` split on the earliest variable of their operands, recursively combine
cofactors and intern the result. Work memoization is local to one operation.
Substitution and the interior recurrence use memoized traversal and the same
canonical operators. Entailment checks if `G and not F` is false. A nonfalse
difference yields a separating assignment by walking to a true terminal; this
is a Boolean valuation, not a counterexample to specific numerical maps.

For nonnegative prices, minimum satisfying support uses a DAG dynamic program.
A low edge adds no price; a high edge adds the variable's price once. Terminals
false/true have impossible/zero scores. Induction proves minimum cost; ties
minimize support cardinality, then prefer the low branch in declaration order.
Irrelevant variables are false. This does not enumerate all minimal supports or
optimize instruction cost. Worst-case BDD size is exponential and depends strongly
on variable order; no polynomial algorithm for arbitrary Boolean contracts is
claimed [1]. Shared symbolic structure is the practical gain, not magic primes.

## API and ownership

`createEvidenceAlgebra(atoms, {maxNodes?, maxWork?})` is the only new top-level
compiler export. It returns an explicit bounded session. Atoms are distinct
ordinary Asslang field identifiers in fixed order, with at most 128 entries.
Contracts are opaque, frozen session-owned handles. Forged handles and contracts
from another algebra are rejected except as templates in `substitute`.

Methods:

- `atom(name)`, `always`, `never`, `all(contracts)`, `any(contracts)` construct
  contracts. `fromFrontier(supports)` imports named positive supports; empty list
  means never, a list containing an empty support means always. Importing does
  not verify a descent certificate: use `verifyDescentBatch` first when relevant.
- `substitute(template, [{atom, value}, ...])` simultaneously binds every USED
  template atom to a target-owned contract. Unknown, duplicate, missing or unused
  bindings are rejected. Cross-domain composition is explicit, not string-based
  accidental capture. Renaming is substitution by atoms.
- `equivalent(a,b)`, `entails(a,b)`, `counterexample(a,b)`, `evaluate(f, trueAtoms)`
  work on this domain. A counterexample is null if entailment holds, otherwise a
  frozen list of true atoms satisfying a but not b; unspecified atoms are false.
- `residual(guarantee,target)` computes Heyting implication, NOT Boolean implication.
  Recheck the actual guarantee when using the result to guard a program.
- `minimum(f, [{atom,cost}, ...])` returns `{cost,facts}` or null; costs default
  to one, are integers in [0,1e9], and duplicate/unknown overrides are errors.
- `inspect(f)` returns an immutable reachable-node snapshot with atom order,
  root index, support and decisionNodes count. This is not an import or trust API.
- `source(name,f)` returns `{name,source,support,decisionNodes}` usable directly
  by `compileSources`. `stats` describes lifetime retained node count and bounds.

The generator emits `fn name = facts -> ...` with only the contract's support
fields, typed as Bool, and canonical decision order. It is NOT a new source
optimizer: simplifying/reordering an explicitly built contract can alter which
trapping predicates are demanded compared with a hand-ordered Boolean expression.
Semantics is truth-functional for pure total facts. Unused facts stay lazy, host
calls cannot hide as pure facts, and no allocation or ABI is introduced for an
algebra at guest runtime. A caller must explicitly `require (name facts) value`
where checking should be mandatory; a `{valid,value}` record is not a refinement.
The emitter may factor ordered tests with the same successful continuation:
`if x then H else (if y then H else L)` becomes
`if (x || y) then H else L`. Both truth and decision order agree by cases on
x and y; this avoids duplicating a common continuation in staged control flow.
Terminal branches simplify to their equivalent Boolean forms. This is only
for generated contracts, not a rewrite of existing source.
All loops in demanded facts retain the enclosing invocation's existing budget.

When a batch frontier is imported, the contract checks its candidate truth flags;
local coherence/equality laws do not appear by magic. The executable example
rechecks the instantiated guarantee and residual on current facts, plus the
supporting local equations. Equality, NaN, signed-zero and partial-function
caveats from [descent](DESCENT.md) remain intact.

## Resource and compatibility policy

Default lifetime node limit: 8,192 including two terminals; configurable from 2
to 65,536. Per-operation work limit defaults to 200,000 recursive visits/interning
steps, configurable from 1 to 2,000,000. Contract lists and frontier terms are
bounded to 4,096. Source generation allows at most 512 reachable decision nodes;
existing source, inference, staging and ABI limits apply independently.
Recursion is bounded by at most 128 variables (or 128 source plus 128 target
variables during substitution); it is not proportional to all retained nodes.

A node/work-budget failure rolls back all nodes interned by that operation so
previous handles and the algebra's remaining capacity stay valid. Temporary
operation caches are discarded. Successful operations may retain intermediate
nodes, counted in `stats`; no global intern table, hidden cache or automatic GC
is introduced. Retire an explicit session when no longer needed. Snapshots are
independent plain data; this API does not sandbox hostile JavaScript proxies.

No change to parsing, inference, generalization, occurs checks, ASABI 1, JTE,
Wasm emission, effects, source loading or default lowering. Existing descent
planners retain their limits; this is a compositional contract layer, not a
replacement for certified frontier enumeration or evidence-path proofs.

## Validation plan

Baseline main fa540352b762d79235c142103b49bb9c4e5291d4 has tree
feff895e8d5f0c67fd4ab517215749280e8ce47d. Its unchanged 1,021 Node tests passed.
Record this theory commit before implementation. Exhaust all three-atom monotone
functions against truth tables for equivalence, residual, witnesses and minimum
cost; compare a separate square-free prime/antichain oracle. Check substitution
semantics/composition and the strict residual counterexample. Test a 96-atom
structured formula with 2^48 minimal supports without enumerating them.

Execute generated guards across all eight lowering modes, support-only fields,
false guarantees, demand/traps, wrong types, source-local errors, host effects,
cache snapshots, raw Wasm budgets and projection guards. Test invalid handles,
wrong domains, injection, over-limit input, zero costs, exact big totals, and
transaction rollback. Preserve the short README; link through the practical guide
and docs index. Run all required Node/example/browser checks and record only
executed evidence in a new validation report. No novelty or proof-assistant
verification is claimed.

## Sources and research boundary

[1] Randal E. Bryant. Graph-Based Algorithms for Boolean Function Manipulation.
IEEE Transactions on Computers, 1986, DOI 10.1109/TC.1986.1676819.
https://ieee-ceda.org/media/graph-based-algorithms-boolean-function-manipulation
Canonical BDDs, shared representation and worst-case exponential size are prior work.

[2] Katrin M. Dannert, Erich Grädel, Matthias Naaf and Val Tannen. Generalized
Absorptive Polynomials and Provenance Semantics for Fixed-Point Logic, 2019.
https://arxiv.org/abs/1910.07910
Provenance and absorptive algebra are prior work, not a new prime factorization.

[3] Lean community. Mathlib.Order.Heyting.Basic.
https://leanprover-community.github.io/mathlib4_docs/Mathlib/Order/Heyting/Basic.html
The implication adjunction is established; citing Mathlib does not mean Lean
has verified this implementation or its proofs.

[4] Luís Damas and Robin Milner. Principal Type-Schemes for Functional Programs.
POPL 1982, pp. 207–212. https://doi.org/10.1145/582153.582176
Type inference is distinct from the explicit contract algebra implemented here.

Sources checked September 11, 2026. The earlier research session's final report
was not available when preparing this change; its unseen conclusions are not
attributed or claimed as implemented. The selected construction is independently
derived and compared with the primary references above. Historical priority of
this integration is unverified; no world-first representation claim is made.

## Executed implementation

The single new factory and its methods are implemented in `src/evidence-algebra.mjs`.
Run `npm run example:evidence-algebra` and `npm run test:evidence-algebra`.
The [validation report](EVIDENCE-ALGEBRA-VALIDATION.md) records the exact tests,
structured scaling example, source-factoring correction, and remaining limits.

## Principal public interfaces

The algebra's `.abstract(privateContract, bindings)` method derives the strongest
necessary and weakest sufficient public contracts for a private requirement.
Every public atom is mapped to a meaning in the private contract's session.
The result includes exactness on realizable views and a separating pair if the
interface loses information. See [interface adjunctions](EVIDENCE-INTERFACES.md)
for the proof, API and limits, and [their validation](EVIDENCE-INTERFACES-VALIDATION.md).
A necessary condition is not safe admission; current summaries must be computed
according to their declared meanings before using a sufficient condition.
