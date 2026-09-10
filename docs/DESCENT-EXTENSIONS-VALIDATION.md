# Relative descent validation

## Revision and method

Based on merged main `dc650aaee1d002ffdcf58137e272da6bb507b53e`, tree
`022c010e5b30c6d1730ec49646534f06face11aa`. The supplied prior research archive
reconstructed that exact Git tree, which was checked against the connected
repository before editing. The unchanged baseline passed all 906 Node tests.
`DESCENT-EXTENSIONS.md` was written and committed locally before implementation.
Its final revision reconciles the proof, API and experiments.

The feature introduces relative certificate planning, finite countermodel data,
and source generation. The existing descent source emitter is extracted into an
internal module shared by both APIs. Four pre-change source fixtures, recorded
from the original source revision, check that ordinary descent generation remains
byte-identical as text. The compiler entry point and browser registration expose
the new helpers; parser, inference, JTE, Wasm emission, ASABI, loop accounting,
effect authority, dependencies and workflow permissions are unchanged.

## Executed checks

Environment: Node v22.16.0, Linux x64, Chromium 144.0.7559.96. Validation date:
2026-09-11. Local results are separate from remote GitHub Actions results.

| Command | Result |
| --- | --- |
| Baseline `npm test` | 906 passed; zero failures or skips |
| Final `npm test` | 936 passed; zero failures or skips |
| `npm run test:descent-extensions` | 59 passed, including existing descent tests |
| `npm run example:descent-extension` | Passed; additional cost 3 versus fixed-star cost 17 |
| `npm run example:host` | Passed |
| `npm run example:reducers` | Passed |
| `npm run example:reconstruction` | Passed |
| `npm run example:descent` | Passed |
| `npm run example:case-studies` | Passed |
| `npm run build:example` | Passed |
| `npm run test:browser -- --output /mnt/data/descent-extension-logs/browser.json` | 1,184 core checks and 276 experiment checks passed (138 experiment cases) |
| `npm run test:browser:http` | Blocked by browser policy: `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| Node syntax checks for changed/added modules | Passed |
| `git diff --check` | Passed |

The HTTP check was attempted, not passed. The new checks are wired into both
HTTP and engine-only paths, but actual HTTP module/worker loading remains
unverified in this environment. No policy was modified or bypassed. Other browser
engines, throughput benchmarks, proof-assistant verification and independent peer
review were not performed.

## Independent mathematical checks

The exhaustive matroid suite visits all 3,251 ordered successor-closed covers
with zero through three vertices and zero through three patches, over all directed
graphs without self-loops. It enumerates 82,172 comparison subsets. A separate
Floyd-reachability/Boolean-equality oracle determines semantic completeness and
extracts inclusion-minimal complete sets without using optimizer partitions.

For every subset T, the production rank agrees with the independently calculated
maximum of |T intersection B| over these minimal complete sets B. Every such B has
the same size. All 53,204 applicable basis-exchange cases pass. For the 42,274
insufficient subsets, the returned countermodel is checked directly: arrow tables
are total and in range, local sections satisfy each edge, every supplied comparison
holds, and the reported coordinate/pair really disagrees. This is stronger than
merely comparing two booleans from graph algorithms.

A second exhaustive suite covers 135 graph/cover configurations on zero through
two vertices, assigning each legal comparison one of retained, available, or
unavailable. All 4,605 assignments are checked against subset enumeration: 3,218
are feasible and 1,387 impossible. Pair-specific costs use a nonuniform bounded
profile including zero. Both minimum new comparison counts and minimum costs
match brute force. Every impossible plan's countermodel satisfies retained facts
AND all available tests, not just the greedy forest selected before failure.

Another 567 complete retained/available/unavailable assignments cover selected
three-coordinate chain, cycle and cross-patch-transitivity examples. Their costs
and feasibility are independently checked through actual equality propagation.
Tests also show explicitly that matroid loops need not be logically true: on
x->z, a downstream test has rank zero but is not implied by no observations.

These finite families are exhaustive only within their stated bounds, not over
all categories, real weights or programs. The general representation and relative
optimality proofs are in `DESCENT-EXTENSIONS.md`. Neither those proofs nor these
tests establish historical originality.

## Runtime semantics and compatibility

The worked example has an x/alias cycle feeding a downstream summary and four
full patches. One retained equality has rank one. Permitted checks have pair-
specific costs 9, 2, 1, 8 and 0; the zero-cost downstream comparison cannot fill
an upstream requirement. The extension picks costs 1 and 2, rather than the
available fixed star's 9 and 8. These are declared static costs, not measured
execution speed or Wasm iteration units.

The source generator offers the existing full agree/check/glue/join and a clearly
conditional checkAdditional. Tests mutate a retained equality while preserving
the selected additions: checkAdditional passes, but full agree/check fail and
join traps, including projection of just one result field. Separate tests break
local coherence to demonstrate that additional agreement is not full validation.
Full checking rechecks retained facts instead of treating them as runtime tokens.

All eight SIMD/fusion/memoization configurations exercise full/conditional checks,
exact loop budgets and demand. The selected checkAdditional export is byte-identical
to handwritten Wasm in those eight modes, both unlimited and at budget zero.
Two independent comparisons each traverse range(3): allowance six succeeds and
five traps, including raw Wasm; a later smaller call succeeds after the trap.
Trapping retained comparators are skipped only by the conditional method, not
by full agreement. Existing descent golden fixtures preserve source text exactly.

Other tests cover empty diagrams, already-complete retained sets, candidate
restrictions, reversed/parallel tests, deterministic zero-cost ties, immutable
snapshots, invalid names/types/costs, sparse arrays, lexical hygiene, mixed product/
Boolean coordinates, source-local errors, cache isolation, host-effect rejection,
protocol ABI rejection, stream causal restrictions and unrelated event domains.
The inherited equality-law limitations remain explicitly documented and tested by
the existing descent suite; this feature does not infer or relax those laws.

An accessor experiment showed that delegating a graph object directly to the old
planner read its nodes property multiple times. The new entry points capture graph
properties once before delegation. Comparison names and costs are likewise captured
once; regression tests exercise values changing on a second read. These are
bounded snapshot checks, not a claim to sandbox arbitrary hostile JavaScript proxies.

At resource boundaries, 4,096 allowed candidates over 32 patches select 31 edges
and sum 31 costs of one billion without precision loss. A generated full checker
with 4,096 retained comparisons compiles and executes, while its conditional
addition list is empty. Combined over-limit inputs are rejected. Existing graph,
cover, compiler and ABI bounds remain in force; this does not show that every
possible type/graph at those limits compiles.

The new browser module adds 32 assertions to the actual engine bundle across four
SIMD/fusion modes. It exercises optimal extension, relative rank, finite
obstructions, stale retained facts, checked joins, exact allowances, and recovery
after traps. It introduces no guest graph or allocator. Remote CI results and
published source identifiers are recorded separately in the PR discussion.
