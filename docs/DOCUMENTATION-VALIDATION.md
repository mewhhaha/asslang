# Documentation and conditional evidence validation

## Revision and scope

Based on main `2b79e9919aaedecaacd01fe6fe7efd402162a5a0`, tree
`889fe8978e7611fffa3cfeb802c2b84f1eeed12f`. The supplied prior research archive
reconstructed that exact Git tree, checked against the connected repository.
The unchanged baseline passed 995 Node tests. The conditional-evidence derivation
and documentation validation plan were committed before examples or tests.

The root README was reduced from 289 to 83 lines. It now introduces the language,
runs a complete JS-to-Wasm example, demonstrates streams and gradients, and links
to task-oriented documentation. New getting-started, language and category guides
use canonical syntax. The docs index is organized by task; a separate evidence
index links historical reports without presenting their counts as current facts.
No existing technical or historical report was deleted or rewritten.

The new conditional-evidence helper lives in an executable teaching example, not
in the public compiler API. No file under `src/`, ABI layout, parser, inference,
staging, Wasm emission, host authority, workflow, dependency or browser harness
was changed. The only package-script additions run the example and focused tests.

## Executed local checks

Validation date: September 11, 2026. Environment: Node v22.16.0, Linux x64,
Chromium 144.0.7559.96. Local results are separate from remote CI status.

| Check | Result |
| --- | --- |
| Unchanged baseline `npm test` | 995 passed; zero failures/skips |
| Final `npm test` | 1,021 passed; zero failures/skips |
| `npm run test:docs` | 26 passed |
| `npm run example:evidence-residual` | Passed |
| Host, reducer, reconstruction, descent, extension, query, batch and case-study examples | All passed |
| `npm run build:example` | Passed |
| `npm run test:browser` | 1,241 core checks and 276 experiment checks passed (138 experiment cases) |
| `npm run test:browser:http` | Attempted; blocked by `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| Node syntax checks for new modules; `git diff --check` | Passed |

The HTTP attempt did not pass; no browser policy was changed or bypassed. The
browser suite is unchanged and provides regression coverage, not browser execution
of the new Node-only teaching helper. HTTP module loading, browser-worker loading,
other browser engines, throughput benchmarking, proof-assistant checking and
independent peer review were not performed successfully or claimed.

## Documentation execution and navigation

Tests extract all 14 tagged `js` and `ass` code blocks directly from the root
README and the three new tutorials; changing published code changes the tests.
Five complete JS examples run in fresh Node subprocesses with repository-root
imports. Nine Asslang blocks are checked in all eight SIMD/fusion/memoization
configurations, including the intentionally rejected causal-access example.
Positive programs are instantiated and compared with the stated outputs. The
host-effect example also checks denial without a capability and quota consumption
with an explicit grant.

The three documented getting-started CLI commands are extracted and run against
the actual code block in a temporary directory. They execute the energy export,
produce structured non-executing diagnostics, and emit valid Wasm plus metadata
containing the documented loop allowance. No shell evaluation or arbitrary
Markdown command execution is used by the harness.

Every local file/heading link in the changed entry pages and research note is
checked without network access. All 52 top-level Markdown files in docs remain
reachable from the documentation index. Documented npm commands must name real
scripts. The README has a 100-line regression ceiling so detailed explanations
remain in docs instead of accumulating release announcements at the top.

The link checker covers inline local Markdown links and headings used by these
pages, not every Markdown extension, every historical link, or the continued
availability of external websites. Clone/setup and interactive playground launch
are not executed recursively inside the test suite. The source checkout and
runtime/CLI commands themselves were tested as described above.

An initial test run caught a mistake in the new test harness: expected JS arrays
were normalized to objects, unlike actual typed-array results. The test helper
was fixed to preserve both as arrays. The published programs and compiler did not
need a workaround; the focused and full reruns passed.

## Conditional evidence checks

The teaching helper computes the internal hom of upward-closed evidence families.
For all 20 antichains on three labels, its 400 pairwise residuals agree with both
an independently implemented antichain-difference formula and direct universal
quantification over extensions (3,200 support-membership checks). All 8,000
family triples satisfy the adjunction, currying, and alternative-guarantee law.
These are finite corroborations of the written proofs, not a claim that all
categories, larger frontiers or programs were exhaustively checked.

Explicit counterexamples distinguish universal completion from picking a
convenient promised alternative, and Heyting implication from pointwise Boolean
material implication. Empty/impossible assumptions, redundant and reordered
families, malformed/sparse input, bounds and frozen snapshots are covered.
The example accepts at most eight labels and 256 supports per input family;
the largest allowed truth table is exercised without changing compiler budgets.

A real `planDescentBatch` frontier is verified with `verifyDescentBatch` before
being passed into the example. The target `[[0,1],[0,2]]` and caller guarantee
`[[1],[2]]` produce the exact additional frontier `[[0]]`. The example then runs
ordinary Asslang that rechecks the actual caller guarantee, new evidence and
supporting local equations before returning `{input:3,output:9}`.

The guard is tested under all eight lowering combinations, including all 64
Boolean flag assignments across those modes. False guarantees, missing new
evidence, stale raw values and incoherent summaries trap. A later valid call
succeeds. Zero loop allowance suffices for the scalar example; no performance
improvement is inferred from this.

## Interpretation

The new result is a specialization of established Heyting/provenance algebra to
the existing evidence model. Historical originality, equality-law verification,
and proof-assistant checking are not claimed. The helper manipulates structural
supports; it neither authenticates caller facts nor changes runtime equality.
Map-compatible equivalence, floating-point caveats, and partial-function behavior
retain their existing documented boundaries.

This change intentionally improves explanation and provides an executable
research example without adding another compiler intrinsic. Remote CI results
and published commit identifiers are recorded separately in the pull request.
