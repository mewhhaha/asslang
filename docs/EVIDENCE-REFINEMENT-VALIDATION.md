# Interface refinement validation

[Theory and API](EVIDENCE-REFINEMENT.md) · [Validation index](EVIDENCE.md)

## Revision and integrity

Based on main `8d7184c65315babbee252c530fc5656fd5609557`, tree
`12940fdeea79d9db020c16d95fac70e42f1b6981`. The supplied prior source archive
reconstructed that exact tree, checked against the connected repository. The
unchanged baseline passed 1,079 Node tests. The design and proofs were committed
before implementation, examples or tests. Historical reports are unchanged.

The implementation adds `.refine` and `.verifyRefinement` to the existing evidence
algebra through an internal orchestration module. It reuses the principal-interface
semantic oracle, but the cost checker does not use the planner's BDD minimizer.
No changes were made to HM inference, parser, JTE, Wasm emitter, ABI, effects,
loop accounting, existing source generation, dependencies or workflow permissions.
The root README remains unchanged; new documents are linked through docs.

## Executed local checks

Validation date: September 11, 2026. Node v22.16.0, Linux x86_64,
Chromium 144.0.7559.96. These are local execution results, not remote CI claims.

| Check | Result |
| --- | --- |
| Unchanged baseline `npm test` | 1,079 passed; no failures/skips |
| Full `npm test` | 1,109 passed; no failures/skips |
| `npm run test:evidence-refinements` | 30 passed |
| `npm run example:evidence-refinement` | Passed; shared cost 3 versus separate union cost 4 |
| Host, reducer, algebra and interface examples | All passed |
| `npm run build:example` | Passed |
| `npm run test:browser` | 1,328 core and 276 experiment checks passed (138 experiment cases) |
| `npm run test:browser:http` | Attempted; blocked by `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| Node syntax checks and `git diff --check` | Passed |

Both browser harnesses register the new checks. Only the engine bundle executed
successfully; no policy was changed or bypassed. HTTP module/worker loading,
other browser engines, throughput benchmarking, proof-assistant checking and
independent mathematical review remain unverified.

## Independent mathematical checks

All six monotone functions of two private atoms are used for each of two target
contracts, one retained summary and two candidate summaries. This exhausts 7,776
configurations. A separate oracle enumerates every private ordered pair and every
candidate subset, without calling the production abstraction or minimization
algorithms. It finds 3,536 feasible and 4,240 impossible configurations. All
minimum prices and cardinality tie-breaks match. All 8,174 produced separation
witnesses are checked against the original truth tables.

A second suite uses 250 seeded cases over three private atoms, one through three
targets, up to two retained summaries and up to six candidates. Direct enumeration
visits 5,362 candidate subsets; 46 cases are feasible. It agrees on feasibility,
price and cardinality and verifies all learned separators. Both suites use stated
deterministic nonuniform price profiles including zero, not every real-valued
price assignment. These finite tests corroborate, not replace, the proofs.

The exact-generators example checks all six positive two-generator Boolean
functions. Every resulting private composite is exactly expressible using the
selected interface. A separate counterexample proves this cannot be generalized
to Heyting residuals: exposing a and (a AND b) does not expose b, even though b is
their private residual. Adding that residual as an explicit target causes the
refiner to select its missing summary.

A directional counterexample has a satisfying private state with public view
smaller than a failing state's view. A candidate differing in the wrong direction
is correctly excluded from the separator. This distinguishes monotone exact
expressibility from merely producing unequal summary flags.

## Certificate verification

Each returned ambiguity is checked against its target, every retained summary,
and every candidate meaning. All and only candidates true on the satisfying
assignment and false on the failing assignment must appear in its separator.
The empty separator case certifies impossibility using every permitted candidate.

On complete results, a separate bounded branching algorithm rules out cheaper or
equally priced smaller covers of the learned clauses. Disjoint-clause packing
provides admissible lower bounds. Fresh `.abstract` calls recheck the selected
interface's exactness. This is not a wholly separate proof kernel: graph/contract
ownership and semantic abstraction are shared with the earlier implementation.
The candidate optimizer, its internal BDD and its metadata are not trusted by
the cost checker. No claim of an exhaustive structural repair frontier is made.

Corruption tests reject invalid schemas, prices/counts, unsupported selections,
missing necessary lower-bound clauses, false target assignments, unknown/duplicate
atoms, incomplete/forged separators and suboptimal but exact interfaces. A valid
alternative optimum passes. A zero-cost redundant summary is rejected when it
violates the secondary cardinality optimum. Repricing or changing meanings causes
old certificates to be checked against the new inputs, not accepted by identity.
Certificates survive JSON serialization. `oracleCalls` is diagnostic, not attested.

## Runtime example and compatibility

The worked component has private calibrated, leftValid and rightValid atoms, and
targets calibrated AND leftValid and calibrated AND rightValid. The existing
interface exposes leftValid/rightValid. A shared calibrated summary costs 3,
while each direct target summary costs 2. Independent choices have union cost 4.
The refiner learns separator clauses {shared,first} and {shared,second}, then
selects only shared at cost 3, after five target-oracle calls. The chosen set is
not formed by irreversibly accumulating each round's cheapest fix.

The example reconstructs the selected public vocabulary, derives its exact
public predicates and emits ordinary Asslang using the unchanged generator.
It computes actual summaries on current numeric inputs before requiring the
guards. Passing arbitrary true public flags is deliberately shown not to be
private evidence. Static schema prices are not timings, fuel units, authentication
strength or privacy scores.

All eight SIMD/fusion/memoization combinations test current-input rejection and
recovery after traps. The combined selected-interface guard produces byte-identical
Wasm to its canonical handwritten conjunction at zero loop allowance. This is a
specific compatibility result, not a universal speedup or all-program erasure proof.

Fact predicates traversing range(3) and range(4) need seven loop units: seven
succeeds and six traps, including raw Wasm. Subsequent small invocations receive
fresh allowances. Projecting the first result does not bypass sibling requirements;
unused pure guards remain lazy. Tests retain Boolean typing, source-local errors,
host-effect and callable-ABI rejection, cache snapshots, causal stream access,
event-domain separation and output storage conventions.

## Structured scale and limits

The new structured example has 96 private atoms and a target that is an OR of
48 pair conjunctions, NOT the predecessor's AND-of-choices example. The private
assignment space contains 2^96 points. Under default limits the refiner discovers
48 singleton separator clauses in 49 oracle calls and selects all 48 pair
summaries. The exact public predicate has 48 reachable decision nodes and compiles
and executes. The original private session remains at 2,402 retained nodes.
Neither private assignments nor all candidate subsets are enumerated in this run.

Other boundary tests use candidate index 63 (BigInt masks in the verifier),
24 selected billion-cost summaries with exact total 24 billion, and 128 retained
summary names. These examples do not establish a polynomial worst-case bound or
that every permitted instance completes within default budgets.

At most 64 candidates, 8 targets and 128 total summary names are accepted. The
round cap defaults to 128, with an absolute cap of 1,024; independent verification
has its own bounded work counter. All temporary BDDs use the original session's
configured node/work caps, separately for each operation, not as an aggregate
whole-refinement ceiling. Exceeding round, node, work or checking limits raises
an error; no approximate optimum or false infeasibility is returned.

Tests cover round exhaustion, independent-check exhaustion and temporary BDD
node/work failures. Neither new method changes the private session's retained
node count on success or failure. Malformed/sparse inputs, forged/mixed-session
handles, naming collisions, invalid prices and bound overruns are rejected.
Record fields changing on a second read are captured once. Returned certificates
are deeply frozen and detached; this is not a sandbox for hostile JavaScript.

The new Chromium module contributes 30 assertions for shared selection, immutable
private state, JSON certificate replay, missing lower bounds, infeasibility,
exact public predicates, projected guards, allocation counters and loop budgets.

## Interpretation

The general hitting-set and counterexample-guided frameworks are prior work.
The delivered proofs specialize them to directional separation of monotone
interfaces and show closure for positive consumer composition. Historical priority,
independent peer review, formal proof-assistant verification and new HM inference
are not claimed. Current-fact, pure-predicate and any intended equality/coherence
assumptions remain the caller's responsibility. Published tree identifiers and
remote CI results are recorded separately in the PR discussion.
