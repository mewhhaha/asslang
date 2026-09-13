# Cut-cover array views: executed validation

[Design, examples and proofs](ARRAY-VIEWS.md) · [Validation index](EVIDENCE.md)

## Revision and scope

Base: merged main `f5a1c545a8c2f363234095ac171267d5ee12ab9f`, tree
`563126c210909e823702530ca75f40bc9329febd`. The supplied source archive reconstructs
that exact tree, checked against the connected repository. A design-only commit
precedes implementation and tests.

The change introduces two data-first builtins, `split_at` and `concat`, a staged
indexed-view planner, checked scalar index operations, and cut-cover observation
rules. Existing syntax, value ABI, runtime adapter, scratch lifetimes, effect
authority and compiler limits are retained. These two builtin names are newly
reserved at global function definitions. The root README, dependencies, CI
permissions and historical validation reports are unchanged.

## Commands actually completed

September 13, 2026; Node v22.16.0, Linux x64; Chromium 144.0.7559.96.
Local execution and remote GitHub CI are separate evidence.

| Check | Result |
| --- | --- |
| Unchanged baseline, `node --test --test-concurrency=2 test/*.test.mjs` | 1,363 passed, no failures/skips |
| Final `npm test -- --test-concurrency=2` | 1,404 passed, no failures/skips |
| Focused array-view suite | 35 passed |
| `npm run test:docs` | 26 passed |
| `npm run test:browser` | 1,805 core + 276 experiment checks passed |
| Host and reducer example runners | Passed |
| Case-study, workflow and new array-view runners | Passed |
| `npm run build:example` | Passed |
| Actual-baseline compatibility | 100 ASTs; 800 binaries, ABI objects and certificates identical |
| Additional scalar-inference/key-loop compatibility | 64 binaries and ABI objects identical |
| Changed JavaScript syntax and diff checks | Passed |
| `npm run test:browser:http` | Attempted; blocked by `net::ERR_BLOCKED_BY_ADMINISTRATOR` |

An earlier default-concurrency baseline `npm test` attempt hit the execution
limit before completion. The unchanged suite completed with concurrency two;
no assertion or language/resource limit was weakened. The final npm invocation
uses that same test-concurrency setting. This is not a passing default-concurrency
run claim. Both browser harnesses register the new module. Only engine-bundled
execution completed; no policy was changed or bypassed. HTTP/worker loading,
other engines and wall-clock throughput remain unverified.

## The useful composed program

The section report splits one input, maps each half with a different gain,
rejoins them, zips with the original events, and scans a record state. It returns
two array traces and final state. On [1,2,3,4] and cut=2, gains 10/100, its values
are [10,20,300,400], cumulative totals [10,30,330,730], and total correction 720.

The default build has one loop, one causal machine, zero runtime zip checks and
zero intermediate-buffer bytes. Four events need exactly four loop units and
64 bytes for the two final numeric arrays, separately from the result descriptor.
With existing fusion disabled, its three consumers use three loops/machines and
twelve units. Both produce the same results. One fewer unit traps in both modes.
The new feature enables no-buffer structural composition and recovered alignment;
the sink-sharing optimization is the existing output-fusion pass, not newly
invented here. None of these counts is a timing or universal throughput claim.

The rotation example scans [3,4,1,2] as [3,7,8,10] without resetting state at the
join. The adjacent-difference example returns [3,-1,6] from [2,5,4,10], with one
loop, no causal machine and an explicit positional zip check. Its two overlapping
views deliberately refer to different events; their equal lengths do not justify
same-domain `zip`.

A scalar lookup in a split/rotated billion-element range returns 600,000,000 at
cut 600,000,000 with zero loops and NO imported linear memory. It does not create
a billion-element array: range is a formula and only one item is requested.
Materializing such a result still needs output capacity and iteration work.
The complete driver records actual module sizes in its JSON output.

## Functional and structural checks

Every ternary-key word through length five is tested at every legal cut: 364
words and 2,005 cut cases, each checked both as identity reassembly and rotation
against independent JavaScript array semantics. All eight optimization modes
exercise the section report at boundary/interior cuts against an independently
written sequential loop and the existing reference interpreter. Another 800
seeded reports check state, traces and corrections. The interpreter remains an
allocation-heavy value oracle and shares the parser; it does not certify native
memory use, event proofs, or suffix demand.

Nested cut reassembly restores the enclosing half's witness, permitting an outer
rejoin. Maps may change values and their scalar type without changing the event
cover. Domain-preserving zips retain it. Independent cuts (even with the same
numeric cut), rotations, duplicated halves, checked positional zips, conditional
sources and sorts do not accidentally restore it. Tampering tests reject wrong
parents, missing cut obligations, swapped/duplicated sides, altered access and
invented restored domains. This checks the JTE ledger, not all emitted Wasm.

A 32-segment dispatch is inspected to have five conditional levels, not a chain
of 31. All dispatch boundaries occur in the structural scalar obligations, so
prefix sums are not recomputed inside each element lookup. Both left-associated
and balanced source trees produce the expected sequence with empty segments.
Maps invalidate stale flattened item metadata. Sixty-four direct segments and
sixty-four nested views compile; one more fails with a controlled limit error.
The existing expansion limit is enforced independently. This does not imply
constant-cost evaluation of arbitrary callbacks or of nested mapped views.

An untouched rejoin's staged item is the original load, with no dispatch branch;
the cut guard remains. Reusing parent cursor identities is tested under captured
outer loops: existing lexical renaming still prevents one iteration from reading
another's index or accumulator. Inner dynamic cuts/joins are checked in all eight
modes. Polymorphic helper functions, record/symbol payloads, partial application,
local patterns, source linking and type failures retain ordinary language rules.

## Demand, memory and runtime boundaries

Cuts include zero and the full length, accept negative zero as zero, and reject
fractions, negatives, nonfinite values and oversized cuts. Validation survives
`count`, empty views and identity reassembly. Concatenated extents reject overflow
before item addressing, including sums above INT32_MAX that would wrap in i32.

Whole unused views remain lazy. Both sides' structural guards are obligations,
including empty sides, but inactive element branches are not evaluated. A direct
raw test supplies an invalid Bool in an inactive side and confirms that no load
or Bool validation is speculated. General piecewise dispatch conservatively stays
scalar rather than vector-loading across segment boundaries. Existing consumer-
specific pure guard scheduling is retained: exact work or partial output before
failure is not a preservation guarantee, and failed raw results must be discarded.

A stopping scan consumes [2,3] and never evaluates a guarded invalid suffix in
[2,3,-99]. Separate tests cover sequential cancellation-sensitive f64 arithmetic,
NaN/infinity where accepted, signed zeros and lazy empty scan initialization.
Splitting or concatenating evolving causal streams and sparse streams fails
explicitly; there is no hidden history allocation or scan replay fallback.

Already sorted streams remain viewable, but even their empty split side retains
the existing full sorting barrier and finite-key validation. Shared sorted data
keeps one scratch reservation; tuple keys reading another sorted view still
register both sort dependencies. Exact existing scratch allowances succeed and
one byte less traps. Views add no scratch of their own or new ABI version.

Raw split results preserve eight-byte array starts after odd-length Bool outputs;
24 bytes succeeds and 23 fails in the documented five-Bool layout. Canaries,
input images and alignment padding remain intact. Raw rotated payloads preserve
chosen NaN payload bits, infinity and signed zero. Invalid descriptor overlap,
input/output overlap, pointer alignment, lengths and capacities fail without
input writes. Output results own their storage; prepared calls retain input
snapshots, scalar cut overrides, post-trap reset and lease expiry. Compiler-cache
snapshots remain independent.

Explicit host effects still require capabilities and execute in order before a
later loop-budget failure. No view hides a host invocation or grants authority.
Diagnostics retain named-source offsets. Published .ass blocks are compared with
the exact registered files, compact/CRLF layouts produce equal binaries, and the
CLI/embedding comparison runs from the tests.

## Compatibility, findings and limits

The baseline comparison imports the actual pre-change compiler from a separate
checkout. All 100 existing corpus ASTs match; all 800 old-corpus builds match
bytes, ABI and JTE certificates across eight lowering settings. Four additional
scalar-key/inference programs with and without loop metering give 64 further
binary/ABI matches. These are finite regressions, not a universal theorem.

The first focused run passed its 31 implemented behavioral tests and failed the
not-yet-inserted guide-source check. Completing the guide and driver resolved
that failure. Review also made prefix-boundary hoisting explicit and reused
certified parent cursors to expose unchanged loads. Focused, full, and browser
checks passed after those changes. The design clarifies that consumer-specific
pure guard order is not a first-trap contract.

This is a finite indexed-view mechanism, not general flatMap, variable-width
ragged arrays, arbitrary state-machine concatenation, writable slices, a guest
rope, parallel scan or efficient unrestricted recursion. A view may recompute
pure mapped values under repeated consumers unless existing memoization/fusion
applies. Guest scalar locals and compile-time metadata still exist; host input/
output copying and existing sorting buffers still cost memory. All new .ass
examples are registered in the normal corpus, and the root README stays short.

Deferred arrays and index-guided fusion are established work. The focused
contribution is composing them with checked cut-cover reassembly and Asslang's
existing causal consumer fusion. No worldwide novelty, proof-assistant check,
independent formal audit, user readability study or wall-clock speedup is claimed.
Remote publication identifiers and CI status are recorded in the PR separately.
