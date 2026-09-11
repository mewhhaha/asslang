# Compositional evidence algebra validation

## Revision and scope

Based on main `fa540352b762d79235c142103b49bb9c4e5291d4`, tree
`feff895e8d5f0c67fd4ab517215749280e8ce47d`. The supplied previous source archive
reconstructed that exact tree, verified against the connected repository. The
unchanged baseline passed 1,021 Node tests on Node v22.16.0. The design note was
committed locally before implementation, and updated before adding the source
factoring discovered to be necessary during experiments.

The change adds one explicit build-time evidence algebra, exported through the
compiler entry point, an executable example, theory/integration tests and engine
bundle coverage. It does not alter parser, inference, JTE, emitter, ABI, effects,
loop accounting, workflow permissions or dependencies. The short root README and
historical reports are unchanged. Primary references and the historical-novelty
boundary are in [the design note](EVIDENCE-ALGEBRA.md).

## Executed checks

Validation date: September 11, 2026. Environment: Node v22.16.0, Linux x64,
Chromium 144.0.7559.96. These are executed local results, separate from GitHub CI.

| Check | Result |
| --- | --- |
| Unchanged baseline `npm test` | 1,021 passed; no failures or skips |
| Final `npm test` | 1,051 passed; no failures or skips |
| `npm run test:evidence-algebra` | 30 passed |
| `npm run example:evidence-algebra` | Passed; guarded result `{input:3,output:9}` |
| `npm run example:host` and `npm run example:reducers` | Both passed |
| Existing evidence-residual and descent-batch examples | Both passed |
| `npm run build:example` | Passed |
| `npm run test:browser` (engine bundle) | 1,265 core + 276 experiment checks passed (138 experiment cases) |
| Node syntax checks and `git diff --check` | Passed |

The new 24 browser assertions exercise the actual compiler export, canonical
composition, substitution, residuals, witnesses and exact loop accounting across
four SIMD/fusion settings. The new algebra cases are registered in the engine
bundle, not the separate HTTP harness. HTTP module/worker loading, other browser
engines and throughput benchmarks were not run for this change. No unavailable
or historical HTTP result is described as a current pass.

## Independent mathematics and compiler checks

All 20 monotone functions on three atoms are compared with an independent truth
oracle and a separate reader of exported decision snapshots. All 400 ordered
function pairs agree on entailment and residuals; 232 non-implications yield
valid separating assignments. The residual is also checked against the previous
truth-table teaching implementation on 3,200 valuations. All 8,000 adjunction
triples pass, verifying weakestness over this entire small contract lattice.

A separate square-free prime/divisibility oracle checks 6,400 conjunction and
alternative valuations. It explicitly distinguishes reusable evidence (LCM) from
resource multiplicity (integer multiplication). Production does not use prime
arithmetic. Minimum satisfying cost and the cardinality tie-break match brute
force for every three-atom contract with four price profiles, including zero
costs and billion-unit weights.

Cross-domain substitution is checked on all six two-atom templates and all pairs
of three-atom replacement contracts: 2,400 instantiations and 19,200 valuations.
Additional tests cover simultaneous renaming, nested composition, and the strict
failure of residual preservation when distinct atoms are identified. These are
finite checks plus written proofs, not exhaustive verification of all programs.

Generated predicates are executed for all three-atom monotone truth functions.
The representative `x && (y || z)` predicate produces byte-identical Wasm to
handwritten code across all eight SIMD/fusion/memoization configurations at zero
loop allowance. Full guards are tested against false guarantees and missing facts;
projecting a guarded result does not bypass its checks. Source-local errors,
missing support fields, wrong Boolean types, host-effect rejection, compiler
cache snapshots and hygienic generated names retain existing behavior.

Two fact predicates traverse range(3) and range(4): seven loop units succeeds and
six traps, including raw Wasm invocation in all eight configurations. A smaller
subsequent call succeeds with a fresh allowance. When two abstract requirements
are instantiated with one concrete atom, its predicate executes once even with
reduction memoization disabled. Unused guards and short-circuited facts remain
undemanded; the API does not promise arbitrary original expression demand order.

Resource tests reject forged/wrong-domain handles, invalid names and prices,
sparse arrays and oversized requests. Node/work failures restore the session's
node count and leave existing handles usable. A 128-atom minimum has exact cost
128 billion. Frozen output snapshots do not freeze caller arrays or binding
objects. This validation is not a sandbox proof for hostile JavaScript proxies.

## Interpretation and limitations

The feature uses established ROBDDs and a monotone evidence lattice, not novel
prime factorization or a replacement for Hindley–Milner principal type inference.
The principal result is a weakest Boolean evidence requirement under a stated
guarantee. It must be inferred after instantiation to retain that weakestness.
No worldwide originality, proof-assistant verification or independent peer review
is claimed. The earlier separate research session's final report was unavailable;
its unseen recommendations are not attributed to this implementation.

The 96-variable structured example has 2^48 minimal supports, 96 reachable
decision nodes and 2,402 total session nodes including intermediates. Its original
naive conditional lowering hit an existing compiler resource limit. Factoring
same-success branches, with a documented case proof, lets this example compile
and execute without changing compiler limits. This does not imply every bounded
BDD compiles or that arbitrary contracts have compact diagrams. An adverse
variable order is explicitly tested to enlarge the diagram and trigger the
512-node source-generation bound rather than silently truncate it.

All facts describe current data. Imported frontiers do not become authenticated
proofs; the example verifies the descent certificate separately and rechecks the
local equations, caller guarantee and inferred residual. Atom substitution is
simultaneous and preserves conjunction/disjunction, but not arbitrary Heyting
residuals. A regression test exhibits the strict distinction. Generated truth
semantics assumes pure total facts; canonical decision order can differ from a
handwritten expression's trap demand. Lawful map-compatible equality and existing
NaN/signed-zero/partial-function limitations remain the application's responsibility.
