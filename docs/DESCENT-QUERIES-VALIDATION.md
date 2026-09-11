# Query-directed descent validation

## Revision and scope

Based on merged main `0a32b7607150d087237f0ca6cf6abc84b17b46bb`, tree
`01eda99467fa4c634a428dead54e41d40345562c`. The previous research source archive
reconstructed that exact tree, checked against the connected repository. The
unchanged baseline passed 936 Node tests. The theory was documented and committed
before implementation; the dual-potential contract was also documented before its
implementation. Historical reports are unchanged.

The implementation adds `src/descent-query.mjs`, four compiler exports, an interop
example, and Node/browser tests. Existing descent implementations are unchanged.
No parser, inference, JTE, Wasm emitter, ASABI, loop-accounting, host-authority,
dependency or workflow-permission change is included.

## Executed checks

Validation date: 2026-09-11. Environment: Node v22.16.0, Linux x64,
Chromium 144.0.7559.96. These are local results, separate from remote CI.

| Command | Result |
| --- | --- |
| Unchanged baseline `npm test` | 936 passed; no failures/skips |
| Final `npm test` | 965 passed; no failures/skips |
| `npm run test:descent-queries` | 29 passed |
| `npm run example:descent-query` | Passed |
| Host, reducer, reconstruction, descent, descent-extension and case-study examples | All passed |
| `npm run build:example` | Passed |
| `npm run test:browser -- --output /mnt/data/query-logs/browser.json` | 1,213 core checks and 276 experiment checks passed (138 cases) |
| `npm run test:browser:http` | Attempted; blocked by `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| Node syntax checks for added/modified modules | Passed |
| `git diff --check` | Passed |

The HTTP suite was attempted, not passed. Both harnesses register the new cases,
but HTTP module and browser-worker loading remain unverified here. No browser
policy was altered or bypassed. Other engines, throughput benchmarks, independent
peer review and proof-assistant verification were not performed.

## Mathematical checks

The restricted-evidence suite exhausts all 135 graph/cover configurations on zero
through two vertices with up to three patches, and all 4,605 assignments of each
legal comparison to retained, allowed or unavailable. Across their 22,959 distinct
pair/coordinate queries, exhaustive subset enumeration agrees with feasibility,
minimum candidate cost, and minimum candidate count among least-cost solutions.
Costs follow a bounded nonuniform profile including zero; this is not an
exhaustion of all possible real weights. A separate Boolean-adjacency/Floyd oracle
computes implications without the optimizer's paths. Every feasible result also
passes the independent transport and dual-potential verifiers.

The 2,917 impossible query cases have their returned countermodels checked:
all retained and allowed comparisons hold, every local section respects every
arrow table, and the reported disagreement is the requested goal (not a different
global failure). This is an abstract finite diagram, not execution of the user's
particular map implementations.

A second suite exhausts all 3,251 zero-to-three-coordinate covers used in the
previous development, with a deterministic partially unavailable/zero-weight
candidate profile. It checks 33,599 ordered queries, 77,281 triangle inequalities,
15,770 nonexpansive arrow inequalities, symmetry and zero diagonals. The returned
costs therefore match the stated extended pseudometric properties on these finite
instances. Written proofs establish the general properties and universal metric
construction; the tests are corroboration, not replacements for those proofs.

A separate semantic test compiles the actual support-local guard for all four
Boolean maps on a two-coordinate diagram. It evaluates all 512 combinations of
map and patch-value assignments, without assuming local coherence. The guard
accepts 32; each has the requested target equality. Sixteen accepted cases have
incoherence in an unrelated patch, demonstrating that full coherence is neither
checked nor needed. Rejection of a sufficient guard is not interpreted as
inequality: a noninjective square-map test explicitly has equal goal values but
fails the selected upstream proof.

Dual-potential tests accept shifted valid witnesses, reject malformed potentials
and violated bounds, and reject a logically sufficient but more expensive direct
proof. The optimality checker inspects a transport proof, evidence costs and local
potential inequalities; it does not call the shortest-path optimizer. It certifies
the primary cost objective only, not the secondary tie-break.

## Compiler and resource evidence

All eight SIMD/fusion/memoization settings exercise support-shaped inputs, local
incoherence rejection, selected value guards and raw loop accounting. The worked
example has a two-edge proof costing 3 versus a direct candidate costing 9, even
though global descent completion is impossible. Its generated protocol requires
only five coordinate fields from three patches; the unrelated fourth patch is
not required. These are declared evidence costs, not measured runtime savings.

For this selected example, generated checkEvidence produces byte-identical Wasm
to handwritten comparisons across all eight settings, both unlimited and at
budget zero. This does not establish all-program erasure or a general speedup.
A local transport workload performs two range(3) traversals: six units succeeds
and five traps, including raw Wasm invocation. A smaller call after the trap runs
with a fresh allowance. Product result projection still demands its guard.

Tests cover selected retained facts being rechecked, empty reflexive proofs,
reversed evidence, self-loop/repeated-path rejection, cycles, parallel arrows,
deterministic transport choices, unavailable goals, source-local diagnostics,
cache isolation, missing support fields, invalid predicate types, host-effect
rejection, protocol ABI rejection, and causal stream access. Irrelevant coordinate
traps and maps are not demanded or required by the generated protocol.

Input validation includes sparse arrays, invalid names, wrong endpoint memberships,
bad costs, over-limit lists, and graph/query/evidence accessors that change on a
second read. Output snapshots and proof data are frozen without freezing caller
records. This is not a sandbox for arbitrary JavaScript proxies.

At boundaries, a 256-coordinate chain produces and verifies a 255-edge transport
and 510 deduplicated local equations. A 4,096-candidate input across 32 patches
selects a 31-edge proof with exact total cost 31 billion; its generated scalar
selection compiles and executes. These tests do not establish that every graph or
ABI shape at all limits compiles. Existing compiler limits, including record-size
bounds, remain intact.

The new browser suite contributes 29 assertions across four SIMD/fusion settings:
query costs, transport proofs, dual lower bounds, nonoptimal-proof rejection,
goal-specific countermodels, support-only inputs, guarded selections, local loop
budgets and recovery after traps. Existing browser cases are retained.

## Interpretation limits

The mathematical model concerns a single equality and nonnegative pairwise evidence
costs. It does not optimize joint multi-goal sharing, local-coherence check count,
map evaluation cost, emitted instructions or elapsed time. Candidate-count tie
breaking is conditional on minimum cost, unlike the independent count optimum
of full descent matroid bases.

Actual equality or map-compatible equivalences are required. Approximate predicates,
NaN, signed-zero distinctions, and partial functions retain the existing equality
and trap-demand limitations. checkEvidence assumes needed local coherence; check
validates only proof support; select is guarded by check. None establishes a full
global join. Used retained evidence is always rechecked in generated methods.

Historical novelty remains unverified. Lawvere metrics, congruence explanations,
shortest paths and dual distance bounds are established foundations; the delivered
result is a proved specialization, certificate format and implementation. No
worldwide priority, proof-assistant check or independent mathematical review is
claimed. Published source identifiers and remote CI status are recorded separately
in the pull-request discussion.
