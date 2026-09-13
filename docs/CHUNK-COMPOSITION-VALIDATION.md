# Symbolic chunk composition: executed validation

[Design and examples](CHUNK-COMPOSITION.md) · [Validation index](EVIDENCE.md)

## Revision and scope

Base: merged main `f074696532798345c0e67c572b75652d336d469c`, tree
`e85ca6e55b54dbfb0259b3aee80fca271e4b3900`. PR #33's connected CI archive
reconstructed that exact tree. The pristine baseline passed 1,404 Node tests.
A local design-only commit precedes implementation, examples and tests.

`chunks` and `flatten` are implemented compiler builtins, not proposed syntax or
host array processing. Regular blocks are symbolic views; array-valued maps must
preserve their local event cover. Flattening substitutes coordinates and resets
local scalar machines at block boundaries. Scalar summaries use ordinary nested
loops. No block descriptors, boundary vectors or intermediate arrays are stored
in guest memory. Existing outputs and any independently required ordering scratch
retain their costs. These two builtin names become reserved global names.

The tokenizer, parser, value ABI, runtime adapter, dependencies, workflow
permissions and root README are unchanged. Historical validation reports are not
rewritten. General ragged arrays, arbitrary nested-array storage and parallel
scans are not introduced.

## Commands completed locally

September 13, 2026; Node v22.16.0, Linux x64; Chromium 144.0.7559.96.
Local runs are not remote GitHub CI results.

| Check | Result |
| --- | --- |
| Pristine baseline: `node --test --test-concurrency=2 test/*.test.mjs` | 1,404 passed; no failures/skips |
| Final full suite: `npm test -- --test-concurrency=2` | 1,443 passed; no failures/skips |
| `npm run test:chunk-composition` | 33 passed |
| `npm run test:docs` | 26 passed |
| `npm run test:browser` | 1,882 core + 276 experiment checks passed |
| Host and reducer example runners | Passed |
| Case-study/workflow runners and example build | Passed |
| New comparison, registered CLI and published source fixtures | Passed |
| Actual-baseline compatibility | 103 ASTs; 824 binaries, ABI objects and JTE certificates identical |
| Changed/new JavaScript syntax and `git diff --check` | Passed |
| `npm run test:browser:http` | Attempted; `net::ERR_BLOCKED_BY_ADMINISTRATOR` |

Both browser harnesses register the new module. The engine bundle completed;
HTTP/worker loading was blocked by browser policy, which was not changed or
bypassed. The 65 dedicated new browser assertions cover eight lowering modes;
three new corpus entries add 12 checks. Existing experiments retain 138 cases.
Other browser engines and wall-clock performance are not tested. Full-suite
results use test concurrency two, not an asserted default-concurrency run.

## Concrete source and memory results

The driver uses samples [1,2,3,4,5,6,7], width 3, exact loop allowances and exact
final-array capacities. It also checks failure with one fewer loop unit or one
fewer output byte. Keys and sorting are not involved in these three examples.

| Program | Emitted loop sites | Exact loop units | Causal machines | Intermediate buffer bytes | Final array bytes | Wasm bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Local/global block report | 1 | 7 | 2 | 0 | 112 | 2,269 |
| Per-block squared-energy sums | 2 | 10 | 0 | 0 | 24 | 1,352 |
| Remove each block's mean | 2 | 14 | 1 | 0 | 56 | 1,415 |

Wasm sizes include the respective loop allowance. Output bytes exclude result
descriptors, input storage and host copies. The first report returns local totals
[1,3,6,4,9,15,7], global totals [1,3,6,10,15,21,28], and final state
{local:7,total:28}. Its two machines have three state slots in total. A checked
block cover restores alignment with the original samples: zero runtime zip checks.
With reduction/output fusion disabled, the report has three traversals, six
machine copies and needs 21 units. Values remain unchanged. Sink sharing uses
existing output fusion; it is not a new optimization invented by this feature.

Energy summaries are [14,77,49]. They visit seven source items and dispatch three
blocks: n+B=10 units. Mean removal returns [-1,0,1,-1,0,1,0]. Its scan seed computes
each block's mean once, followed by the block's output traversal: 2n=14 units.
No means array or block array is allocated. A billion-element virtual range's last
short-block length is queried with zero loops and no linear-memory import. This
is a symbolic range calculation, not a billion-element materialization benchmark.

These are inspected native artifacts and resource boundaries, not timing claims,
zero-host-allocation claims, or a claim that every callback is linear-time.

## Independent value, state and scope checks

Exhaust all 364 words through length five over {-1,0,1}, using widths 1 through
n+2: 2,369 input/width cases. Expected results come from ordinary JavaScript
slice/scan loops. Another 800 seeded nested-block cases execute across all eight
SIMD/fusion/memoization configurations. The existing reference interpreter gains
an allocation-heavy chunks/flatten value model; it shares the parser, but not
JTE or Wasm lowering. Direct Wasm tests, rather than that eager interpreter, check
unvisited suffixes and lazy scan initialization.

Tests exercise short tails, width one and widths larger than the input, empty
inputs, chained local scans, nested blocks, outer/global scans and simultaneous
record-state swaps. Cancellation-sensitive f64 inputs, signed zeros, NaN and
infinities are checked where the program's own guards allow them. Recurrences
retain left-to-right order; no associative or parallel-prefix law is assumed.

Flattening initially exposed a real substitution bug: replacing the local input
cursor also replaced a nested reduction's own bound cursor in a scan seed. This
made a block summary behave as though it read the current item repeatedly. The
fix substitutes only free block coordinates, masks bound indices/accumulators
inside nested reductions and iterations, and gives each lexical substitution
scope its own cache. Focused regressions cover sum, fold, record fold, stopping
fold, nested range reductions, iterations and a guarded scan-containing reduction.
The corrected examples and all full-suite checks then passed.

One flattened binding retains shared machine identity across consumers. Separate
flatten invocations get distinct state/cell identities; two identical-looking
scans do not silently share state. Nested captures, helper functions, partial
applications, local patterns, record/symbol payloads and polymorphic reuse retain
ordinary scope and type behavior.

## Event covers, demand and resource boundaries

Certificate tampering tests reject altered layouts, local roots, restored domains,
access capabilities, missing obligations and wrong rule arities. The checker
reconstructs the exact block cover rather than trusting an equal length. A
same-domain local zip or certified split/map/rejoin can flatten and recover source
alignment. An enclosing cut cover can also survive. Rotated, duplicated, filtered,
unrelated, conditionally selected or merely equal-length local arrays cannot
claim this witness. Dense source and causal-access restrictions remain explicit.

Pointwise flattening stays seekable. Local scan states and block-level guards
make it sequential. A zero-state checkpoint evaluates local structural guards
when entering each visited block, including for count and ignoring folds. Early
stopping does not enter a later block or evaluate its seed/guard. Empty input
runs source/width checks but no block callback or seed. Unused families remain
lazy; count of a mapped family does not force its pure map body.

Widths zero, negative zero, negative/fractional/nonfinite values and values above
INT32_MAX trap. Width and source checks survive empty/count consumers. Exact
integer division/remainder avoids overflow in ceil division. Boundary cases use
INT32_MAX-sized symbolic ranges without allocating them. Identity flattening is
inspected to remove redundant item-coordinate routing. Ten thousand one-item
blocks require no guest block metadata. Sixty-four nested views compile, one
more fails with E_LIMIT; existing staging limits are independently enforced.

Raw calls check output canaries, input/output separation and malformed Bool
loads. Managed/prepared calls retain input snapshots, separate returned storage,
width overrides, disposal, trap cleanup and fresh invocations. Captured ordering
inside a block checkpoint is discovered and retains ASABI 2 and exact scratch
capacity. Sorting after a flattened local scan still uses its normal native
materialization barrier. Pure host calls, missing capabilities and source-local
diagnostics retain their established errors; explicit effects keep their order.

## Compatibility and interpretation

A separate pristine checkout of the actual baseline was imported alongside the
new compiler. All 103 pre-existing accepted corpus sources have identical ASTs.
Across eight lowering settings, all 824 Wasm binaries, ABI objects and JTE
certificates match. The compatibility script and JSON result are retained in the
delivery. These are finite regression checks, not a universal equivalence theorem.

All three new .ass examples are registered in normal discovery, and the guide's
source blocks must exactly match those files. Compact and CRLF forms produce
identical bytes across eight modes. The comparison driver and actual JSON CLI
execute under tests. An early working-tree full run found the design document
not yet linked; that is not the pristine-baseline run recorded above. Navigation
was completed, and final focused/full/documentation/browser checks passed.

Repeated block-wide work remains visible. Mapping every item to `sum block`
is not automatically memoized once per block and can cost O(n*width). A regression
checks 14 units for that repeated-summary shape on five items of width two, versus
10 when the summary is explicitly held in a scan seed. General block-invariant
memoization and arbitrary ragged flattening are separate work. Source access must
be indexed before chunking; no implicit history buffer is allocated for causal
or filtered inputs. Key/producer/seed computations can add their own metered work.

The mathematical argument is a checked-cover bijection and ordered reset-state
induction, not a world-first theorem or end-to-end formal proof. Segmented
flattening has substantial prior art, cited in the design. There is no proof
assistant, independent formal audit, GPU execution, user readability study,
wall-clock speedup, or audited sandbox claim.

## Publication status

At preparation time the exposed GitHub connection provided read operations but
no branch/commit/PR write operation. Direct Git fetching was also attempted and
failed to resolve github.com. The implementation and theory-first commits are
local. Applicable patches and the PR description are delivered separately; this
report does not claim a published branch, an opened PR or a fresh remote CI pass.
