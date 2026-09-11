# Shared descent frontier validation

## Revision and method

Based on merged main `a03652286cbb8afea042d8107e75deee8fad23fc`, tree
`eae24904757c9444cb4bd12247c748bfbff03794`. The supplied previous research bundle's
source reconstructed exactly that Git tree; this was checked against GitHub.
The unchanged baseline passed all 965 Node tests. `DESCENT-BATCHES.md` was written
and locally committed before any implementation or test changes.

The feature adds one build-time module, three compiler exports, an executable
example, Node tests and browser registration. Existing descent generators,
parser, inference, JTE, Wasm emitter, ASABI, loop accounting, effects, dependencies
and workflow permissions are unchanged. Historical reports remain untouched.

## Executed checks

Validation date: 2026-09-11. Node v22.16.0, Linux x64, Chromium 144.0.7559.96.
Local results below are distinct from remote GitHub Actions status.

| Command | Result |
| --- | --- |
| Unchanged baseline `npm test` | 965 passed; zero failures or skips |
| Final `npm test` | 995 passed; zero failures or skips |
| `npm run test:descent-batches` | 30 passed |
| `npm run example:descent-batch` | Passed; shared cost 5 versus separate-proof union cost 7 |
| Host, reducer, reconstruction, descent, descent-extension, descent-query and case-study examples | All passed |
| `npm run build:example` | Passed |
| `npm run test:browser -- --output /mnt/data/frontier-logs/browser.json` | 1,241 core checks and 276 experiment checks passed (138 experiment cases) |
| `npm run test:browser:http` | Attempted; blocked by `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| Node syntax checks and `git diff --check` | Passed |

The HTTP test was attempted, not passed. No policy was changed or bypassed.
Both test harnesses register the batch cases, but HTTP module and browser-worker
loading remain unverified here. Other browser engines, throughput benchmarks,
proof-assistant checking and independent peer review were not performed.

## Mathematical evidence

The exhaustive suite uses all 135 graph/cover configurations with zero through
two vertices, up to three successor-closed patches, and directed graphs without
self-loops. All 4,605 assignments of legal comparisons to retained, available or
unavailable are tested. For each presentation, two specified batches are used:
all legal goals, and first/last goals when there are at least two (otherwise the
empty batch). This gives 9,210 batches, not every possible goal family for every
restricted presentation.

A separate set-based fixed-point equality oracle enumerates all candidate subsets.
It agrees with both boundary antichains, selected support, exact nonnegative cost
and cardinality tie-break. Costs use a bounded nonuniform profile including zero;
not all real-valued prices are enumerated. The suite checks 8,776 minimal supports
in total, and directly checks 2,516 impossible-batch countermodels: all retained
and available comparisons hold, local sections respect every arrow, and an actual
requested goal disagrees.

A second test uses every subset of legal goals on those covers with all candidates
available: 766 batches. Antichain multiplication of independently computed single-
goal frontiers equals the produced joint frontier in every case. Separately all
20 antichains on three evidence generators are enumerated, checking identity,
idempotence, absorption, and 8,000 triples for associativity/distributivity. The
cost inequalities and failure of positive-price scalar evaluation to preserve
idempotent sharing are checked directly. These tests corroborate the general
quantale/enriched-category and frontier proofs, not replace them.

An actual generated batch guard is compiled for all four Boolean maps on a
raw-to-summary arrow and evaluated on all 512 map/value assignments, without
assuming global coherence. It accepts 32 assignments; all establish both named
goals. Sixteen accepted cases have incoherence in an unrelated patch. The guard
is sufficient, not necessary; another test shows a true output equality rejected
by a proof relying on unequal inputs to a noninjective square map.

Certificate-corruption tests remove a nonselected frontier alternative, remove
negative boundaries, add nonminimal or nonmaximal boundary sets, forge cuts,
change costs/counts, alter chosen evidence, break transports, and rename or omit
goal proofs. The verifier rejects these. In particular, correctness of the chosen
cheapest set alone cannot hide an incomplete claimed frontier.

## Compiler, sharing and demand

The example has goals a.raw=b.raw and a.summary=c.summary, with raw->summary.
Candidate prices are 4 for raw(a,b), 1 for summary(b,c), and 3 for summary(a,c).
Independent cheapest choices have union cost 7. The batch frontier is {{0,1},
{0,2}}, and the selected shared proof costs 5. Prices are supplied acquisition
estimates; this is not a timing benchmark. Repricing the direct comparison changes
the chosen set while leaving the structural frontier unchanged.

All eight SIMD/fusion/memoization configurations test atomic guarded selection,
support-local coherence, exact budgets and selected handwritten equivalents.
The chosen checkEvidence export produces byte-identical Wasm to handwritten
comparisons, with and without a zero loop allowance. This is narrow evidence of
staging erasure, not a universal code-size or performance theorem.

A shared-evidence workload uses a three-iteration predicate and a four-iteration
predicate. The first evidence label serves both goals but is emitted once: seven
units succeeds and six traps, including raw Wasm. A subsequent smaller call gets
a fresh allowance. Repeated downstream goals share two local transport equations;
two range(3) map traversals need six units, not twelve. Five traps. These checks
include modes with memoization disabled, so they do not rely on an optimizer
silently deduplicating separately generated checks.

Projecting just the first result still checks the second goal: a conflicting
second summary traps. Selected retained facts are rechecked on current pieces.
Unused fields, patches and maps remain outside the required support and demand.
Tests retain source-local diagnostics, cache snapshot isolation, map/predicate
inference, host-effect rejection, protocol ABI rejection, mixed product guards,
causal stream access, and post-trap reset. No guest graph or allocator is added.

## Resource and trust boundaries

The exact search accepts at most 16 candidate labels and eight named goals,
in addition to existing graph/cover limits. Retained plus candidate entries are
bounded to 4,096. Inputs beyond limits throw; there is no silently truncated
frontier or heuristic fallback. The general model contains Steiner forest and
can have exponentially many minimal supports, so this limit is intentional.

A 16-candidate duplicated-edge chain yields all 256 minimal supports and eight
maximal failures without truncation; its exact cost is eight billion. A 32-patch
case exercises the highest bit in independent Boolean cut validation. A 256-node
chain with eight repeated goals produces 255-edge transports but only 510 shared
local equations. Existing compiler, source and ABI limits still apply; not every
possible shape at those limits was compiled.

Input tests include malformed/sparse arrays, invalid or reserved identifiers,
unknown memberships, duplicate goal names, unsafe prices and resource overruns.
Snapshots are detached and deeply frozen. Graph/query/evidence accessors changing
on second read are covered; this is not a sandbox for arbitrary hostile proxies.

The verifier checks boundary completeness, feasibility, selected candidate indices,
primary price/cardinality fields and explicit named proofs. It does not certify
display/support metadata or runtime truth. It shares graph/cover validation with
the earlier modules but uses separate equality propagation and checks the entire
Boolean-cube partition instead of rerunning the batch enumeration.

Lawful equality and map-compatible equivalences remain assumptions. Approximate
predicates, NaN, signed zero and partial functions retain their documented limits.
Evidence sharing does not create host authority or a cross-call cache. Successful
guards prove their goals, not full gluing; failures do not prove goals false.

Historical originality is unverified. Provenance semirings, enriched categories,
antichains and Steiner optimization are established foundations. The delivered
results are a self-contained specialization, complete frontier certificate and
bounded staged implementation. Published source identifiers and fresh remote CI
results are recorded separately in the pull request.
