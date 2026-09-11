# Implication transport validation

[Theory and API](EVIDENCE-TRANSPORT.md) · [Validation index](EVIDENCE.md)

## Revision and method

Based on merged main `4c2dbe7879341ba7d646f7eb6d56757c819704cb`, source tree
`8afa577ff371acb6531793314e03fb0ebbe4da92`. The supplied previous source archive
reconstructed exactly this Git tree, verified against the connected repository.
The unchanged baseline passed 1,109 Node tests. The initial transport/lifting
design was committed before implementation or tests; the extension-obstruction
corollary was documented before its additional test was written.

This change adds `.auditTransport` and `.liftEvidence` to the private evidence
algebra, through one internal ephemeral Boolean workspace. No existing algebra
operation or source-emitter body is changed. Parser, Hindley–Milner inference,
JTE, Wasm emission, ASABI, effects, loop accounting, dependencies and workflow
permissions are unchanged. The root README and historical validation reports
remain intact. The task index and evidence index link the new documents.

## Executed local results

Validation date: September 11, 2026. Node v22.16.0, Linux x64,
Chromium 144.0.7559.96 (Debian GNU/Linux 13). These are local results, distinct
from remote GitHub Actions results, which are recorded in the PR discussion.

| Command/check | Result |
| --- | --- |
| Unchanged baseline `npm test` | 1,109 passed; zero failures/skips |
| Final `npm test` | 1,138 passed; zero failures/skips |
| `npm run test:evidence-transport` | 29 passed |
| `npm run test:docs` | 26 passed; 144 local links and 60 reachable top-level documents |
| `npm run example:evidence-transport` | Passed; direct lift cost 3 versus sequential total 4 |
| Host, reducer, evidence-algebra, interface and refinement examples | All passed |
| `npm run build:example` | Passed |
| `npm run test:browser` | 1,359 core + 276 experiment checks passed (138 experiment cases) |
| `npm run test:browser:http` | Attempted; blocked by `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| Node syntax checks and `git diff --check` | Passed |

Both browser harnesses register the 31 new assertions. Only the engine-bundle
path executed successfully. No browser policy was altered or bypassed. HTTP
module/worker loading, other browser engines and throughput benchmarking remain
unverified. No formal proof-assistant execution or independent mathematical review
is claimed. The general proofs in the theory document are written mathematical
proofs; the JavaScript implementation is tested, not formally verified.

## Independent finite semantics

All 20 monotone functions of three private atoms are used as summary meanings.
Every ordered mapping to zero through three public atoms is checked: 8,421 maps.
A direct oracle enumerates every current private assignment and every extending
public view, then searches all extending private assignments for an exact lift.
It uses no relational BDDs, quantification, new audit code or existing abstraction
engine to determine the expected answer. The audit matches all cases: 238 preserve
implication and 8,183 do not.

Every failed result's current/view/requested lists are checked directly against
the truth tables, including that exactly one public atom was added and no private
lift exists. Each failure is also replayed using the *previous* residual and
substitution code: A is the conjunction of requested atoms, B is A conjoined with
the disjunction of excluded public atoms. At the reported current state, pulling
back A=>B is false, whereas the residual of the two pulled-back formulas is true.
This is 8,183 formula-level counterexample replays, not merely matching flags.

For every two-public-atom mapping, all pairs of the six public monotone contracts
are compared: 400 maps and 14,400 formula pairs. Universal residual commutation
agrees exactly with the audit. The unconditional one-way implication remains
valid even when the audit fails. A separate test verifies 121 compositions of
lawful two-atom maps.

Exact lift price and added-fact cardinality are compared with brute-force private
assignment enumeration for 14,916 compatible request/price-profile cases across
all 400 three-private/two-public mappings. Of these, 2,948 have no lift. Profiles
are unit costs and [0,3,2], so this is not an exhaustion of every possible price
assignment. Returned facts preserve all current private atoms and realize exactly
the requested public view, including flags that must remain false.

The extension-obstruction corollary is checked on all 6,660 ways to add one
three-atom summary to a failed two-output interface. Failure persists, and the
old witness extended by the currently true new flag remains unliftable. Another
test exposes every private atom in addition to two duplicated outputs: all six
private predicates are exactly observable, but implication transport still fails.
Thus target expressibility and residual-preserving transport are not conflated.

The explicit surjective counterexample is p:=a OR (b AND c), q:=b. All four
public views occur, but from private {c}, view {} cannot extend to {q} alone.
This catches an implementation that checks only global surjectivity or starts
only from the empty private assignment. Constants true/false and unreachable
public flags are tested separately.

These families are exhaustive only within their stated bounds. The all-vocabulary
claims follow from the written lifting theorem, its single-atom reduction and
algorithmic invariants, not from extrapolating finite test counts.

## Useful example and optimization boundary

The worked interface has p:=shared OR leftFallback and
q:=shared OR rightFallback, with private fact prices [3,2,2]. It is lawful for
all conditional contracts in this evidence semantics. The cheapest direct lift
of {p,q} is {shared}, cost 3. The cheapest exact lift of {p} must instead choose
{leftFallback}, cost 2, and extending that to {p,q} costs another 2. The example
proves existence composes but locally minimum prices do not generally compose.

The example precomputes a public residual, transports it through the audited
map, and checks equality with the independently computed private residual. It
then emits ordinary Asslang that computes summaries from current numeric inputs
and requires both the guarantee and additional condition. Correct inputs return
`{sum:1}`. Missing evidence, a false guarantee and invalid current inputs trap.
The chosen Boolean lift is a proposal, not an operation that makes facts true.
No claim is made about physical realizability, privacy, authentication, execution
latency or a new Hindley–Milner principal-type scheme.

## Generated-code and resource checks

All eight SIMD/fusion/memoization combinations test the representative transported
predicate on every three-input Boolean valuation. It emits byte-identical Wasm
to its canonical handwritten `facts.a || facts.c` counterpart at zero loop
allowance. Full guards recheck the guarantee and addition; projecting one result
cannot bypass them. Unused pure guards remain undemanded.

Two demanded fact loops traverse range(3) and range(4). Seven units succeed and
six trap, including direct Wasm calls in every lowering mode. A later smaller
call receives a fresh allowance. Typing, support-only fields, source-local
errors, host-effect rejection, callable ABI rejection, compiler cache isolation,
causal stream restrictions and event-domain separation retain their ordinary
behavior. No new guest allocator, runtime graph or emitted proof object exists.

A structured 128-private/64-public-atom interface of independent OR pairs audits
under default node/work budgets and admits a minimum full-view lift of 64 facts.
There are 2^128 possible private assignments and 2^64 minimal full-view lifts;
neither family is enumerated by the implementation. A reversed 128-by-128
identity interface also audits under explicitly configured maximum budgets.
A lift retaining one initial fact has exact added cost 127 billion under
billion-unit prices. These are structured cases, not polynomial worst-case or
all-inputs-at-the-limit guarantees. No timing claim is based on these tests.

Input tests cover authentic ownership, forged/wrong-session handles, sparse
arrays, identifier collisions/injection, unknown or repeated atoms, downward
public requests, invalid prices and bound overruns. Results survive JSON
serialization and are deeply frozen without freezing caller inputs. Accessor
fields changing on a second read are captured once. This is not a sandbox for
arbitrary JavaScript proxies.

Workspace-node and operation-work exhaustion throw rather than returning
lawfulness, an approximate lift or false infeasibility. All analysis uses a
separate temporary workspace; the original session's retained nodes stay
unchanged on success and failure. Audit relational products use at most 256
interleaved variable levels. The old source generator and compiler limits remain
independent. The new audit is not a portable independently checkable positive
proof certificate; its computation is trusted subject to these implementation
tests and the general algorithmic proof.

## Novelty and interpretation

The lifting/implication characterization is established p-morphism theory. The
contribution here is the integration into Asslang, an all-formula transport audit,
constructive failure formulas, exact priced lifting and explicit non-composition
boundaries. Historical originality of this integration is unverified. Any use of
Boolean flags as equality/coherence evidence retains the application's existing
lawfulness, totality and current-data obligations. The language's type inference
and meaning of equality have not changed.
