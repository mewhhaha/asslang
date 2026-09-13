# Arithmetic chunk views: executed validation

[Design, proofs and examples](CHUNK-VIEWS.md) · [Validation index](EVIDENCE.md)

## Revision and scope

Base: merged main `f074696532798345c0e67c572b75652d336d469c`, tree
`e85ca6e55b54dbfb0259b3aee80fca271e4b3900`. PR #33's downloaded CI source archive
reconstructed that exact tree. The unchanged baseline passed 1,404 Node tests
with test concurrency two. A design-only commit precedes implementation.

`chunks` and checked `flatten` are implemented compiler operations, not host
array helpers. They add arithmetic stream views, nested-block substitution and
JTE family checking. No parser token, value ABI, runtime adapter, guest allocator,
scratch convention, dependency or workflow permission changes. The two builtin
names are newly reserved globally. The short README and historical reports remain
unchanged. General ragged flattening and persistent nested-array ABI values are
not added.

## Completed local checks

September 13, 2026; Node v22.16.0, Linux x64, Chromium 144.0.7559.96.
Remote GitHub CI is reported separately in the PR discussion.

| Command or comparison | Result |
| --- | --- |
| Unchanged baseline `npm test -- --test-concurrency=2` | 1,404 passed; zero failures/skips |
| Final `npm test -- --test-concurrency=2` | 1,441 passed; zero failures/skips |
| `npm run test:chunk-views` | 31 passed |
| `npm run test:docs` | 26 passed |
| `npm run test:browser` | 1,873 core + 276 experiment checks passed |
| `npm run test:browser:http` | Attempted; `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| Host/reducer, workflow and case-study runners; example build | Passed |
| New example driver, documentation source blocks and JSON CLI | Passed |
| Actual-baseline corpus comparison | 103 ASTs; 824 binaries, ABI objects and certificates identical |
| Changed/new JavaScript syntax and `git diff --check` | Passed |

Both browser harnesses register the new module. The engine-bundled route completed;
HTTP loading was blocked by browser policy, without changing or bypassing policy.
The 56 dedicated browser assertions run all eight SIMD/fusion/memoization modes;
three corpus entries add twelve checks through the existing paths. All 138
experiment cases remain. No HTTP/worker pass, default-concurrency local pass,
other-engine result or throughput measurement is claimed.

## Useful programs and actual storage/work

The complete driver compiles three ordinary source files, runs exact output and
loop allowances, and checks that one fewer loop unit traps. There is no sorting
or chunk-processing host import. Results are lifted through the ordinary adapter.

| Five-input task | Result | Loop sites | Exact units | Intermediate bytes | Final array bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| Block-relative readings, rejoin, zip, scan and report | Relative `[0,3,0,-2,0]`; totals `[0,3,3,1,1]` | 1 | 5 | 0 | 80 |
| Per-block sum of running totals | `[33,58,30]` | 2 | 8 | 0 | 24 |
| Dot products of paired blocks | `[8,32,30]` | 2 | 8 | 0 | 24 |

The first two use readings `[10,13,20,18,30]` and width 2. The paired-block task
uses `[1,2,3,4,5]`, `[2,3,4,5,6]` and width 2. The report's final record is
`{original:91,total:1,value:0}`. Its restored event domain permits ordinary zip
with no runtime zip check; existing output fusion shares the scan and its sinks.
With fusion disabled the report has three traversals and needs 15 rather than
five loop units. The new chunk operations do not take credit for inventing the
existing sink-fusion pass.

The two-loop cases are nested outer/inner loops, not two full replays: three
block events plus five source events cost eight units. The per-block scan resets
its seed at each block and is folded without a materialized history. A scan after
flattening instead runs continuously across the block boundaries. These are
intentionally different programs, not reassociated floating-point sums.

The driver's metered modules are respectively 2,536, 1,346 and 1,630 bytes. These
are artifact-specific measurements, not timing speedups. The final array figures
exclude result descriptors, borrowed input snapshots, compiler/host allocations
and any upstream sorting scratch. Chunk metadata is compiler-side, not a runtime
array of block descriptors. All three modules use ASABI 1 and reserve no scratch.

Counting width-three chunks of a 1,000,000,000-element virtual range returns
333,333,334 with no loop and no memory import. Additional scalar tests select a
late block and index a flattened block-local expression at large virtual extents,
including INT32_MAX. These evaluate formulas, not a billion stored values. Full
materialization still needs output memory and work.

## Independent value and algebra checks

All eight lowering combinations exercise fixed block summaries, reports,
per-block scans and exact allowances. Exhaust all 1,093 ternary words through
length six and 8,201 positive-width cases. For each, independently sliced JS block
loops supply expected block sums and flattened relative readings. Another 400
seeded reports run across the eight configurations. The reference interpreter
adds a deliberately allocation-heavy chunk/flatten model; it shares the parser,
not native staging or emission, and is not the sole expected-value oracle.

Tests distinguish restored full covers from matching lengths. Two independently
selected blocks receive distinct domains; aliasing one selected block retains its
own domain. An independent chunk family cannot supply another family's inner
cover. Different widths can each flatten their own complete source cover and
legitimately recover the same original domain, without equating their outer block
events. Inner split/rejoin and an enclosing split cover also compose. Certificate
tampering rejects wrong families, parents, obligations and forged restored domains.
The ledger checks relational facts, not every emitted instruction.

Nested map/fold uses of a shared family test lexical cursor rebinding rather than
capturing a previous outer iteration. Tests also cover dynamically sized chunks
inside existing callbacks, polymorphic helpers, partial applications, stored
function fields, Num/Bool and scalar-record payloads, simultaneous record-state
updates, filtered inner reductions and paired tails. Source-local errors retain
their named file and offset. Vertical, compact and CRLF source versions have the
same emitted bytes. Published source blocks match the exact registered files.

## Structural demand, repeated work and effects

Widths 0, negative zero, negative/fractional values, NaN, infinity and values over
INT32_MAX fail under structural demand, including on empty input. A completely
unused chunk expression stays lazy. Empty input has no block seed or block-local
guard evaluation, while upstream structural guards remain required.

Flattening preflights introduced block structural guards once per block. Tests
show that a later bad block guard can fail even a requested first flattened item,
and that three guarded blocks need three validation units. Count does not demand
an unused mapped item merely to perform structural validation. No preflight loop
is emitted when no inner structural guards were added.

A flattened item containing a block reduction or bounded iteration is rejected
with `E_CHUNK_WORK`, rather than silently repeating it for each element. Causal
inner flattening is rejected with `E_CHUNK_ACCESS`; block-local scans can still be
folded through the supported reduction path. A stopping fold within a block can
avoid an invalid suffix transition; flattening is not used to assert such a
stream is randomly accessible. These restrictions are explicit conservative
boundaries, not evidence of arbitrary efficient flat_map.

An already issued host result is atomic even when its arguments performed a
reduction. A regression passes `sum (range 3)` to one authorized host call, then
uses its result in a flattened map: exactly three argument-loop units plus two
output units succeed, and the host runs once. Missing capability remains denied.
An existing native ordering is likewise an invocation-cached dependency; its
strict key validation and exact scratch limits remain. Constructing a sort inside
a block callback still fails the existing ordering-scope rule.

## Memory, lifetime and compatibility

Raw Wasm tests check exact and short output capacity, input/output separation,
canaries, chosen NaN payload bits, infinities, signed zero and an inactive malformed
Bool tail. Odd Bool result lengths preserve the adapter's normal alignment for
subsequent arrays. Invalid spans fail rather than causing implicit buffer growth.
Managed and prepared calls preserve pinned inputs, independent owned results,
nonpersistent scalar overrides, disposal and fresh state after failure. There is
no chunk scratch pointer or borrowed nested result escaping the call.

The comparison script imports an independent checkout of the actual baseline.
All 103 pre-existing corpus ASTs and all eight builds per source match: 824
byte-identical Wasm modules, ABI objects and JTE certificates. This includes earlier
view, sorting, differentiation and causal examples where present in the corpus;
it is finite evidence, not an all-program binary-compatibility proof. No existing
test assertion, compiler bound or runtime allowance was weakened to pass.

## Limits of the result

Chunks require dense seekable inputs; chunking an evolving scan or filtered source
is not implicitly materialized. Nested chunking, exporting `[[a]]`, changing block
lengths under flatten, arbitrary ragged flattening and stream-valued record fields
remain unsupported. Flatten accepts the checked complete block cover, not every
nested array expression. It conservatively rejects some invariant reduction
expressions too; there is no profitability or block-memoization transformation.

Arithmetic views use constant-size runtime structural state for a fixed source
expression, but arbitrary callbacks retain their own work. One full fold per
block visits N elements plus C block events. A flattened bounded pointwise map is
O(N), with an optional O(C) structural preflight. A block callback can itself be
quadratic; the feature is not a universal cost inference system. Old source,
staging and 64-level view limits continue to apply.

Nested array representations and fusion have established prior art cited in the
design. The contribution is a focused native integration of arithmetic covers,
block-local computation, checked alignment restoration and explicit demand/work
limits. No worldwide novelty, general new category-theory theorem, GPU parallelism,
proof-assistant verification, independent formal audit, measured readability
improvement or wall-clock speedup is claimed.
