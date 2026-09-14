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
