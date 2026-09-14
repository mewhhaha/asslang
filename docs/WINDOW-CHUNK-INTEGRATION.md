# Window maps after chunk-scan integration

[Window maps](WINDOW-MAPS.md) · [Chunk scans](CHUNK-SCAN-INTEGRATION.md) · [Documentation](README.md)

## Problem and intended reconciliation

PR #36 was based on ec52b058. Merging PR #35 moved main to
26974afa2c6bf239d871a54cdac420eeddcbc712 and introduced overlapping edits in
`docs/README.md`, `examples/expanded-corpus.mjs`, and `package.json`. The changes
are additive registrations, not competing window algorithms. Taking either side
wholesale would drop documentation, commands, or example discovery for the other.
The old PR head's successful CI does not validate the updated combined source.

Merge main into the existing PR branch, preserving both parents and both feature
sets. Keep all original chunk, chunk-scan, and window example identifiers, library
links, npm scripts and guides. Keep main's compiler, browser registration, effect
rules, ABI, limits, and chunk guard/work policies byte-for-byte. Do not rewrite
history, change main, or substitute the original competing chunk implementation.
The 16-line `window_map` source library and its three kernels need no algorithm
change to resolve these registrations.

## Semantics and invariants

Windows remain complete, indexed read-only neighborhoods, not a disjoint cover.
A window callback may consume an ordinary chunk family, flatten its local scan,
and reduce that sequential result. Each callback owns its local scan state. A
window reduction used as a block scan seed retains its private loop coordinates
and executes once per visited block. Empty or unvisited blocks do not execute
seeds. Chunk structural guards retain main's separate all-block preflight policy.

Flattened scans remain sequential and cannot become indexed window sources without
an explicit materialization boundary. Reject that use rather than silently
replaying history, granting alignment, or allocating storage. No source mutation,
new scratch lifetime, numerical reassociation, or permission is introduced. Window
reductions still cost work proportional to the number of elements they visit;
composing them in a seed does not make their work free.

## Validation plan

Reconstruct both published trees and their common base, then reproduce the three
merge conflicts. Resolve their registrations additively and test that both feature
sets remain reachable from the public scripts, corpus, CLI, and documentation.
Add regressions for windows containing flattened block scans, window reductions
inside block scan seeds, and rejection of windows over sequential flattened scans.
Use independent array-based value oracles across all eight lowering modes. Check
exact shared loop allowances, empty inputs, output storage, post-trap reuse, and
stopping before an unvisited seed. Preserve every existing assertion.

Run the complete Node suite, both focused suites, documentation, host/reducer and
case-study drivers, and the available Chromium engine path. Compare old corpus
and original window-program artifacts against the actual published snapshots.
Record completed commands and any execution limits here without rewriting the
historical validation sections of either feature guide. Publish a merge commit
onto the existing PR branch with a non-forced ref update and check fresh GitHub CI.

## Executed reconciliation and validation

September 14, 2026; Node v22.16.0, Linux x64, Chromium 144.0.7559.96.
The merged-main source tree is `36051a72cbdd868d06f608291432c6e3b00e21c5`;
the original PR #36 tree is `6e6fa2654b5c5a78e3bfbdda067d2290447e94b3`.
Both were reconstructed from their GitHub CI archives and matched their published
trees. The reconstructed common base also matches tree
`877e6017f3dca0ef05798f7f23873e9abf4b72bf` exactly.

The three-way merge reproduced conflicts in exactly the three files above. All
were resolved additively. Every file under `src/` (31 files), the main browser
harnesses, original window library/examples/tests, and historical feature reports
remain unchanged relative to their respective published snapshots. There is no
algorithm fix disguised as a conflict resolution. The new regressions are in
`test/window-chunk-integration.test.mjs` and have their own npm command.

| Completed check | Result |
| --- | --- |
| Actual merged main, default `npm test` | 1,477 passed; no failures/skips |
| Combined default `npm test` | 1,508 passed; no failures/skips |
| Window tests | 21 passed |
| Chunk scan tests | 30 passed |
| Arithmetic chunk tests | 31 passed |
| Dedicated integration regressions | 4 passed |
| Documentation tests | 26 passed |
| Chromium engine | 1,962 core + 276 experiment checks passed |
| Main corpus compatibility | 109 entries x 8 modes: 872 identical binaries, ABI objects and certificates |
| Original window examples | 3 entries x 8 modes: 24 identical binaries, ABI objects and certificates |
| Host/reducer, workflow/case-study, both chunk drivers and window driver | Passed |
| Example build, syntax and diff checks | Passed |
| HTTP browser path | Attempted; blocked by `net::ERR_BLOCKED_BY_ADMINISTRATOR` |

The full combined suite includes all pre-existing tests; none were removed or
weakened. Initial synchronous baseline attempts exceeded the local command time
limit. Complete default-concurrency runs were subsequently captured to completion;
only those completed runs are reported as passes. No test-runner or production
resource limit was changed. The HTTP policy was not bypassed. The engine run is
not an HTTP/module/worker-loading test or a result for other browser engines.
Fresh remote CI and publication identifiers are recorded in the PR discussion.

## Combined-feature regressions

The public-entry regression checks both features' script names and guide links,
unique corpus identifiers, explicit window-library links, and seven actual CLI
requests covering the old arithmetic report and all six newer chunk/window tasks.
This specifically catches an accidental one-sided resolution of the shared files.

Across all eight SIMD/fusion/memoization modes, windows containing flattened
block scans on [1,2,3,4,5,6] return [14,20,26]. Each width-four window computes
width-two block prefixes before summing them. This uses two loop sites, exactly
15 shared loop units and 24 final-array bytes, with zero intermediate buffers.
One fewer unit or output byte traps. Empty input and reuse after traps work.

Window reductions used as width-three scan seeds on [1,2,3,4,5,6,7] return
[9,11,14,24,29,35,7]. An independent array oracle computes each seed from its own
block, detecting private-cursor capture or cross-block state reuse. The native
program needs exactly 19 units: seven flattened events and twelve units for the
four two-element seed windows and their dispatches. It has three loop sites,
56 final-array bytes and no intermediate buffers. Eighteen units trap.

A stopping consumer can return the first seeded result in seven units without
executing an invalid later block seed. Moving that guard onto the block stream
instead retains all-block structural preflight and rejects the bad later block.
A flattened causal scan is still rejected as a window source with E_VIEW_ACCESS.
These checks establish coexistence without changing the distinct guard, demand,
provenance or memory policies of the merged features.

Finite artifact comparisons and execution tests are not a proof of the complete
compiler, independent formal audit, empirical readability result or throughput
claim. Per-window reductions still reread overlapping input; output arrays,
descriptors and host copies still need their normal storage.

## Reproduce

```sh
npm run test:window-chunk-integration
npm run test:window-maps
npm run test:chunk-composition
npm run test:chunk-views
npm test
npm run example:window-maps
npm run example:chunk-composition
```
