# Compositional evidence contracts

## Theory-first design

Components should describe requirements using abstract evidence atoms and
instantiate them with concrete monotone formulas. Preserve symbolic sharing
instead of enumerating every minimal sufficient support before composition.
Use explicit bounded reduced ordered binary decision diagram sessions, with
one fixed atom order and opaque session-owned contract handles.

A prime encoding is a useful semantic reference, not the production algorithm:
encode a support S by the square-free product of its atom primes. Inclusion is
divisibility and reusable conjunction uses LCM, not ordinary multiplication.
Disjunction still needs alternatives. A commutative product does not preserve
type arrows, binding, order, lexical scope or occurs checks; this proposal does
not replace Hindley–Milner inference or claim new principal type schemes.

For a monotone contract F, substitution has the semantics
sigma(F)(S)=F({e : sigma(e)(S)}). It preserves constants, conjunction, disjunction
and equivalence, and composes associatively by structural induction. Rebuild
monotone decision nodes using L or (sigma(e) and H), since L implies H; this
avoids violating the concrete variable order during cross-vocabulary composition.

Infer missing requirements with the Heyting residual:
residual(G,F)(S)=forall T containing S, G(T) implies F(T). For every monotone W,
W and G implies F iff W implies residual(G,F). This proves weakestness directly.
For arbitrary Boolean B define interior(B) by universal extension closure. At a
BDD node e with children L,H, its low child becomes interior(L) and interior(H),
and its high child becomes interior(H). Apply this to not G or F.

Substitution does not generally preserve residuals: residual(x,y)=y for independent
atoms, but identifying both with z gives residual(z,z)=true, while substituting
the old residual gives z. Infer the weakest requirement AFTER instantiation.
The substituted old residual remains sufficient by the adjunction.

## Proposed API and lowering

Add createEvidenceAlgebra(atoms, options) through src/compiler.mjs. Its methods
provide atom/all/any/fromFrontier, simultaneous substitute, equivalent/entails,
separating Boolean assignments, evaluate, residual, minimum priced satisfying
support, immutable inspect and ordinary Asslang source generation. Constants
always/never are handles. No Boolean negation escapes the monotone public API.

Generated source is a pure Boolean function of its support fields, not a proof
of runtime data. Callers explicitly require it, recheck guarantees, and establish
any local coherence/equality laws used to interpret descent frontiers. No stale
fact token or host authority is created. Canonical ordering can change which
partial predicates trap compared with a differently ordered Boolean expression.

No parser, inference, JTE, emitter, ASABI, effect, loop-budget, dependency or
workflow changes. Functions and dictionaries stage through existing machinery.
All demanded fact loops share the enclosing invocation allowance. No guest graph,
prime arithmetic, factorization, allocator or closure representation is introduced.

## Resources, alternatives and validation

Allow at most 128 named atoms. Default session capacity is 8,192 nodes, configurable
up to 65,536; default per-operation work limit is 200,000, capped at 2,000,000.
Bound lists/frontiers to 4,096 terms and generated predicates to 512 reachable
nodes. Reject overruns; roll back nodes allocated by failed operations so previous
handles remain usable. Existing compiler and ABI limits remain independent.

ROBDD sizes can be exponential and depend on variable order. Structured formulas
such as 48 interleaved binary choices may have 96 nodes despite 2^48 minimal
supports; test this instead of claiming a general polynomial improvement.
Explicit frontiers remain useful when all supports are needed; integer prime
products lose alternatives and do not improve inference simply by re-encoding it.

Baseline main fa540352b762d79235c142103b49bb9c4e5291d4 has tree
feff895e8d5f0c67fd4ab517215749280e8ce47d. Its unchanged 1,021 Node tests passed.
Validate small monotone functions against truth tables, the prior enumerative
residual helper and a separate square-free prime oracle. Check substitution,
residual adjunctions, witnesses, optimal prices, namespace hygiene, rollback,
large structured cases, generated truth/guards, source-local errors, effects,
cache isolation and raw loop budgets across all eight lowering configurations.
Run required Node, host/reducer and available browser tests before publication.
Keep the root README short and link details through docs.

## Established foundations

Randal E. Bryant, Graph-Based Algorithms for Boolean Function Manipulation (1986):
https://ieee-ceda.org/media/graph-based-algorithms-boolean-function-manipulation

Dannert, Grädel, Naaf and Tannen, Generalized Absorptive Polynomials and Provenance
Semantics for Fixed-Point Logic: https://arxiv.org/abs/1910.07910

Mathlib.Order.Heyting.Basic:
https://leanprover-community.github.io/mathlib4_docs/Mathlib/Order/Heyting/Basic.html

Damas and Milner, Principal Type-Schemes for Functional Programs (1982):
https://doi.org/10.1145/582153.582176

Historical novelty, proof-assistant verification and independent review are not
claimed. The separate research session's final report was not available; this
proposal is independently derived from the available sources and repository.
