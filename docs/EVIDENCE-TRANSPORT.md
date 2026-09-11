# Implication-preserving evidence transport

[Evidence algebra](EVIDENCE-ALGEBRA.md) · [Interfaces](EVIDENCE-INTERFACES.md)

## Problem and scope

AND/OR composability is not enough for reusable conditional requirements. An
interface may express its target generators exactly yet fail to commute with
Heyting implication. This change checks the *whole interface*, not one chosen
consumer, and constructs minimum-cost private evidence extensions implementing
an exact requested public view. It is a build-time Boolean model, not an action
that makes facts true or a replacement for Hindley–Milner inference.

Baseline main `4c2dbe7879341ba7d646f7eb6d56757c819704cb` has source tree
`8afa577ff371acb6531793314e03fb0ebbe4da92`. The supplied archive reconstructs
that exact tree, confirmed against GitHub. All 1,109 baseline Node tests passed.
This design precedes implementation, examples and tests.

The general characterization below is established bounded-morphism/Esakia theory
[1]. The delivered work specializes it to executable evidence interfaces,
constructive failure formulas, a single-public-step symbolic audit, and priced
lifting. Neither world-first mathematics nor verified general type inference is
claimed. Written proofs and finite execution checks are distinct from a formal
proof-assistant verification of the JavaScript implementation.

## The exact condition for conditional composition

Let X=P(D) and Y=P(E) be the private and public Boolean posets, ordered by
inclusion. Every public atom e has a monotone private meaning phi_e. Write
phi(S)={e:phi_e(S)} and sigma(A)=A o phi for substitution. The evidence residual is

    (A => B)(T) iff for every V containing T, A(V) implies B(V).

**Theorem 1 (lifting and implication).** The following conditions are equivalent:

1. Every public evidence extension lifts: for all S and T containing phi(S),
   there exists U containing S with phi(U)=T.
2. For all monotone public contracts A,B,
   sigma(A => B) = (sigma(A) => sigma(B)).
3. For every S and e not in phi(S), there exists U containing S with
   phi(U)=phi(S) union {e}.

Condition 1 says phi maps each principal upper set onto the corresponding
principal upper set: phi(up S)=up phi(S). These monotone maps are p-morphisms
(also called bounded morphisms) of the finite posets. They are not required to
be globally surjective if phi(empty) is nonempty.

**Proof, 1 implies 2.** Substitution always gives the forward implication. If
A=>B holds at phi(S), take any U containing S; monotonicity makes phi(U) an
extension of phi(S), so A(phi(U)) implies B(phi(U)). For the reverse direction,
assume the private residual holds at S. Given any T containing phi(S), lift it
to U containing S. If A(T), the private residual gives B(T). Thus the public
residual holds. QED.

**Proof, 2 implies 1, with explicit counterexample.** If some T containing
phi(S) has no lift, set A=up T and B=(up T) minus {T}. Both are upward closed.
At phi(S), A=>B fails because T witnesses A and not B. On every U containing S,
if A(phi(U)), then phi(U) contains T but cannot equal T, so B(phi(U)). Therefore
sigma(A)=>sigma(B) holds at S while sigma(A=>B) fails. This contradicts 2. QED.

On a Boolean public vocabulary these witnesses are positive formulas:

    A = AND of atoms in T
    B = A AND (OR of public atoms outside T).

An empty OR is false. They can be replayed using the *existing* algebra's
residual and substitute methods, independently of the new audit algorithm.

**Proof, 1 iff 3.** Condition 1 directly supplies each single-atom lift. Conversely,
list the finitely many atoms of T minus phi(S), add one at a time, and apply 3 to
the current lifted private state. The private states only grow and the public
view gains exactly the requested atom at each step. After all steps, its view is
T. No claim of a cost-optimal sequential strategy follows from this argument.

Consequently a positive audit licenses arbitrary nested AND/OR/residual formulas
and constants across this substitution, by induction on formulas. A finite
consumer test suite cannot establish this all-formula guarantee by itself; the
lifting condition supplies the uniform proof. It does NOT imply every private
predicate is observable publicly. These are different kinds of completeness.

## Boundaries that matter

Identifying two public atoms x,y with one private atom z is not lawful transport:
from private empty the public extension {x} cannot be realized. The witnesses
A=x, B=x AND y show the defect. Refining a one-output identity interface by adding
this redundant public label can therefore destroy implication preservation even
though it cannot destroy positive expressibility. Re-run the audit after interface
changes; the earlier target-directed `.refine` is not a repair algorithm for this
stronger property.

A public constant-true meaning is allowed: that atom is already in every current
view, so it need not be newly enabled. A constant-false public atom fails because
an extension can request it. Unreachable worlds above an actual view matter; worlds
that are not extensions of that view do not. Surjectivity alone is insufficient. For p:=a OR (b AND c), q:=b, all four public
views occur. But from private {c}, public view {} cannot extend to exactly {q}:
enabling b also forces p. From private empty the same requested view does have
lift {b}. Thus checking fibers only at the initial empty state is unsound.

Lawful maps compose: lift an outer extension through the outer map, then lift
that intermediate extension through the inner map. Identity and coordinate
projections are lawful. No assertion is made that this property can be repaired
monotonically by adding more public flags.

## Why more exported information cannot repair this defect

**Corollary (extension obstruction).** If phi fails the lifting property, adding
any collection of public summary coordinates while keeping its old meanings
unchanged cannot restore implication preservation.

Proof: projection from the enlarged public cube to the old coordinates is lawful.
If the enlarged map were lawful, composing it with this projection would make
phi lawful, a contradiction. More constructively, keep the old witness S,T and
extend T by exactly the newly exported flags already true at S. This is a public
extension of the enlarged current view. Any lift would project to the forbidden
old lift. QED.

This reverses the earlier target-refinement intuition. Adding summaries can repair
exact expressibility of private consumers, but cannot repair an already broken
conditional-transport law. Even exposing every private atom does not fix duplicated
old outputs. A repair must change/remove old summaries or deliberately change the
public-world semantics; the current algebra continues to use the full public cube.
The two analyses should not be substituted for one another.

## Minimum-cost exact lifting

Given current private facts S and requested public view T containing phi(S),
find U containing S with phi(U)=T minimizing sum of prices of U minus S. Prices
are nonnegative integers; current facts are sunk and not charged again. Return
null if the request has no such U. This is a synthetic evidence acquisition plan;
it neither executes checks nor authenticates, mutates or materializes facts.

The equality phi(U)=T is essential. Merely making all requested flags true could
also enable excluded flags and would not witness the lifting theorem. A valid lift
must preserve all currently true private facts. Requests dropping an already true
public summary are invalid for this monotone-extension API.

**Theorem 2 (minimum lift).** Let C be the Boolean constraint

    (AND over d in S of d) AND
    (AND over e in T of phi_e) AND
    (AND over e outside T of NOT phi_e).

Its models are exactly the permitted lifts. A decision-DAG dynamic program gives
each low branch zero added price and each high branch the atom's price (zero for
current atoms); false is infeasible and true costs zero. Induction on the DAG
proves the minimum. Ties minimize the count of added private atoms, then prefer
the low branch in declaration order. No price is a runtime iteration count or
measured latency; semantic realizability of private Boolean valuations is assumed.

**Greedy lifting is not globally optimal, even on a lawful interface.** Expose
p:=a OR b and q:=a OR c, with prices a=3,b=2,c=2. From empty, the cheapest exact
view {p} is {b}. Extending that to {p,q} adds {c}: total 4. Lifting the final view
{p,q} directly selects {a}: total 3. Each one-step choice is locally optimal.
The interface is lawful: the private fallback b enables p without q, and c enables
q without p whenever that single flag is missing. This separates the composition
of existence proofs from the composition of optimization objectives.

## API, ownership and representation

Add two methods on a private `createEvidenceAlgebra` session:

    privateAlgebra.auditTransport(bindings)
    privateAlgebra.liftEvidence(bindings, current, requested, prices = [])

Bindings are `{atom,value}` with unique validated public names and authentic
private-owned contract handles. All public meanings are explicit. `current` is
a list of true private atom names; `requested` lists exactly the desired true
public atoms. Arrays are dense, duplicate-free and bounded. Prices are optional
`{atom,cost}` overrides for private atoms, defaulting to one; zero prices are
allowed. Each property is captured before reuse. Forged/mixed-session handles,
unknown atoms and malformed data are rejected.

The audit returns frozen JSON data `{schemaVersion:1,preservesImplication,
obstruction}`. A failure has `{current,view,requested}` witnessing one missing
public-atom extension. A positive result is an executed symbolic audit under the
written theorem, not a portable proof object or trusted authorization token.
The lift returns frozen `{facts,added,cost}` or null. Neither method allocates
nodes in or changes the original evidence session. All analysis uses an internal
ephemeral Boolean workspace; no negative contract escapes the monotone algebra.

## Symbolic audit and proof of its algorithm

Use interleaved current/future private variables (s_i,u_i), copying input DAGs
without changing the source. Let Ext(s,u) mean s subset u. For each public atom e
form the relation

    R_e(s,u) = Ext(s,u) AND phi_e(u) AND
               AND_(j != e) (phi_j(u) implies phi_j(s)).

Monotonicity and Ext ensure all old public flags stay true, so R_e says exactly
that u enables e and no other new flag. If e was already true, u=s satisfies it.
Thus Q_e(s)=exists u R_e(s,u) is identically true iff the single-atom condition
holds for that e. Check all e; a false Q_e yields a current assignment and the
failed extension phi(s) union {e}. This proves audit correctness from Theorem 1.

Combine relation factors with existential abstraction of future variables after
their last occurrence. This is sound because an eliminated variable occurs in no
later factor: (exists u C) AND H = exists u (C AND H) when u is not free in H.
The conditional relation is important: checking fibers only from the empty
assignment would test global surjectivity, not lifting from every current state.
Memoization and reduced ordered nodes avoid enumerating assignments on structured
instances; worst-case BDD size and work are still exponential [2].

Use existing session limits: 128 private atoms, at most 128 public bindings,
default 8,192/max 65,536 workspace nodes including terminals, and default
200,000/max 2,000,000 work steps per entire audit/lift. Count copying, relational
products, quantification, witnesses and minimum traversal. The interleaved audit
has at most 256 variable levels. Successful or failing calls leave source state
unchanged. Exhaustion throws rather than certifying lawfulness or infeasibility.
Source emission stays with the existing `.source` and its independent 512-node
bound. No parser, inference, ABI, staging, emitter, effects, loops, dependencies,
workflow permissions or default demand semantics change.

## Validation plan

Compare all small monotone summary maps with explicit upper-cone enumeration,
not the new BDD algorithm. Independently test residual commutation for all small
public formula pairs. Replay every failed audit's positive counterexample formulas
using old residual/substitution. Brute-force lift cost/count and exact public views
under prices including zero. Check identity, projections, constants, composition,
duplicated meanings, surjective non-lifting examples, reverse variable order,
shared inputs, greedy suboptimality, immutability and resource failures.

Execute generated public/private residuals and predicates over current inputs in
all eight lowering combinations. Preserve explicit `require`, source locations,
effects, ABI, caches, stream provenance and raw loop budgets. Run full Node and
required examples, Chromium when available, and record actual results separately.
Investigate formal verification, but do not claim a proof-assistant check unless
the tool actually executes. Keep root README and historical validation unchanged.

## Primary sources

[1] G. Grilletti and D. E. Quadrellaro. Esakia duals of regular Heyting algebras.
Algebra Universalis 85, article 5 (2024; published online November 21, 2023),
Definition 2.2 and Esakia duality. DOI 10.1007/s00012-023-00833-5.
https://link.springer.com/article/10.1007/s00012-023-00833-5
Bounded-morphism theory is prior work, not an invention of this feature.

[2] R. E. Bryant. Graph-Based Algorithms for Boolean Function Manipulation (1986).
https://doi.org/10.1109/TC.1986.1676819

[3] BuDDy documentation: bdd_appex, relational product and existential abstraction.
https://buddy.sourceforge.net/manual/group__operator_g5427238634d2289212a4bd5bf32e3dec.html
The algorithmic foundation is established; this change adds no BuDDy dependency.

Sources consulted September 11, 2026. Historical originality of the integration
is unverified. An exact Boolean guarantee does not prove equality laws, totality,
physical realizability of proposed facts, or audited security of the runtime.

## Implemented entry points

The audit and minimum lift are implemented in `src/evidence-transport.mjs` and
exposed as methods of the existing private algebra. The old source emitter and
all prior semantic operations are unchanged. Run `npm run example:evidence-transport`
and `npm run test:evidence-transport`. The
[validation report](EVIDENCE-TRANSPORT-VALIDATION.md) separates executed finite
checks, structured scale and compiler results from general proof claims.
