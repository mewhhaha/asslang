# Loop budgets and staged reconstruction integration

## Broken integration invariant

PR #14 (`ac5a5f5d981e772b00129d49c935e1034c621769`) was based on
`46296dd10de6fb80c79844dec02fc2a6298c0e88`. Main now includes PR #15 at
`9b4630fe62659224a9fa7f07409d23893bb98ed5`. The documentation index has
competing additions, while the package scripts and compiler entry point also
changed on both branches. Taking either side wholesale would drop a public
feature, its discoverability, or its example/test command.

The repair must preserve both APIs: `planReconstruction` and
`reconstructionSource` remain available through `src/compiler.mjs`, and
`maxLoopIterations` must still reach every supported compilation entry point.
This is a compatibility repair, not a new categorical result or cost model.

## Semantics and representation

Reconstruction is build-time planning plus ordinary generated Asslang source.
It does not allocate a guest graph or define another invocation boundary.
Every loop demanded by its map dictionary or explicit coherence predicates must
consume the enclosing export's existing allowance. Calling a generated protocol,
restoring another coordinate, or checking it must not reset that allowance.
Budget exhaustion remains an ordinary Wasm trap, with no partial-result guarantee.

A scalar reconstruction with no emitted loops must succeed at budget zero.
Unused restored fields and an undemanded `check` must remain lazy and spend no
units. Conversely, demanding a check is real work: loops in its arrows and
comparators must be charged. Structural source-component coverage establishes
uniqueness of coherent data, not free computation or validity of arbitrary seeds.
An explicit `require` remains necessary to demand validation at a chosen boundary.

Preserve the existing private invocation-local i32 counter, staged dictionaries,
ASABI 1 layouts, stream provenance, causal restrictions, source-local diagnostics,
and host-capability rules. The planner's 256-node/2,048-edge bounds and existing
compiler limits remain unchanged. This integration adds no imports, globals,
workflows, permissions, dependencies, or runtime abstractions.

## Alternatives and trade-offs

Resetting a counter at each generated helper would let nested source abstractions
bypass the per-invocation policy. Charging graph edges rather than emitted loops
would count unused work and give ordinary handwritten code different semantics.
Removing reconstruction exports or dropping loop-budget validation would hide
the conflict rather than resolve it. Retain both changes with a normal merge
commit; do not rewrite either feature's existing history.

Exact loop costs can differ under fusion, SIMD, and memoization. Tests should
compare generated and handwritten equivalents under each configuration, and use
independently countable workloads for exact-boundary assertions. No new promise
of optimizer-independent cost or wall-clock limitation is introduced.

## Validation plan and baseline

Before edits to implementation or tests, the unchanged PR #14 source passed
`npm test`: 845 tests, zero failures or skips, on Node v22.16.0. Source archives
were obtained from GitHub Actions. Reconstructed Git trees match the original
base (`f1c17e791122b12817f06ed49309713234e6d03e`), PR #14
(`1fcacebcfdf1dbc56c5efd428c69761be48f00c6`), and current main
(`3131ddf2b99b744497a05220567a22b2da553865`).

Resolve the index while retaining both entries; preserve both package commands
and compiler APIs. Add integration tests for zero-cost scalar restoration,
aggregate work across generated arrows and checks, demand, raw Wasm enforcement,
per-call reset, compiler-session cache isolation, and file-local diagnostics.
Exercise all eight SIMD/fusion/memoization combinations where applicable, and
include a metered generated protocol in the Chromium suite.

Run the full Node suite, focused loop-budget/reconstruction tests, host/reducer/
reconstruction/case-study examples, example build, Chromium engine tests, syntax
checks, and `git diff --check`. Record results below only after execution. Preserve
previous validation reports unchanged; they describe their own original revisions.
Remote checks for the repaired head must pass before merging PR #14.

## Executed repair validation — 2026-09-10

The three-way integration found one textual conflict, in `docs/README.md`.
Both feature entries are retained. The compiler entry point and package scripts
combined cleanly; the reconstruction exports/example and loop-budget options/test
command are all present. The focused loop-budget command now includes the new
integration suite. The original metering emitter, CLI implementation, and previous
validation reports were not changed by this repair.

Environment: Node v22.16.0, Linux x64, Chromium 144.0.7559.96.

| Command | Executed result |
| --- | --- |
| `npm test` on the original PR #14 | 845 passed; zero failures or skips |
| `npm test` on the repaired integration | 877 passed; zero failures or skips |
| `node --test test/reconstruction-loop-budgets.test.mjs` | 7 passed |
| `npm run test:loop-budgets` | 187 passed |
| `node --test test/reconstruction.test.mjs` | 25 passed |
| `npm run example:host` | Passed |
| `npm run example:reducers` | Passed |
| `npm run example:reconstruction` | Passed |
| `npm run example:case-studies` | Passed |
| `npm run build:example` | Passed |
| `npm run test:browser -- --output /mnt/data/pr14-repaired-browser.json` | 1,121 core checks and 276 experiment checks passed (138 experiment cases) |
| `node --check` for the combined compiler/browser modules and new test module | Passed |
| `git diff --check` | Passed |

The seven new Node tests exercise all eight SIMD/fusion/memoization combinations
for scalar erasure, chained arrows, explicit coherence checks, demand, and causal
streams. A two-arrow chain first sums `range 4`, obtaining 6, and then sums
`range 6`, obtaining 15. The shared allowance is exactly 10: 10 succeeds and 9
traps, including direct Wasm invocation. A separate coherence check spends four
units in its arrow and two in its equality predicate; six succeeds and five
traps. Retained conflicting coordinates produce `false`, or trap when the caller
explicitly requires validity. Unused reconstruction/check work succeeds even
with zero allowance and a large otherwise-expensive input.

Generated scalar/stream workloads produce byte-identical Wasm to their
handwritten equivalents under the tested limited and unlimited configurations.
This is narrow compatibility evidence, not a general performance claim. The
suite also covers per-call reset after traps, generated named-source compilation,
cache snapshot isolation, non-executing checks, file-local diagnostics, and
rejection of noncausal stream access.

The Chromium suite adds 16 assertions across four SIMD/fusion combinations,
using generated named sources to test the exact 10-unit boundary, exhaustion,
metadata, and fresh allowance after a trap. It retains both existing feature
suites. Validation used the engine-only bundle: HTTP module loading, browser
worker loading, other browser engines, and throughput benchmarks were not tested.
The limits are still emitted-loop counts, not elapsed-time or full-instruction
fuel; equality laws and totality remain the application's responsibility.

These are local execution results. Remote CI results and the exact published
head are recorded separately in the PR conversation after publication.
