# Record updates: validation

[Contract](RECORD-UPDATES.md) · [Syntax](SYNTAX.md)

## Provenance and outcome — September 17, 2026

This pass adds immutable existing-field record updates with a preserved open row.
Base main was `c01612b13c264b51c16fe0315a4c17b6125c22ea`, tree
`f4614fcc2591f181fa835d84de13eadbe8fee78f`. A fresh GitHub read confirmed PR #42
merged, no open PRs, and successful base CI. Public Git clone failed DNS; GitHub
artifact 10507420980 supplied `validation-source.tar`. Reconstructing its complete
Git tree reproduced the base tree exactly; it was not a semantically reconstructed
compiler. The independent baseline comparisons use that unchanged source.

Theory was written before implementation and committed as remote object
`2c846a2c2f1fecdaf9240f795eac4e992a0fc49a`, tree
`42a84fe9bd94f19155dd0113c7febe19d9281478`. Main is advanced only after the complete
tree is checked. Local synthetic snapshot commits are not publication parents.
The ordinary connected GitHub tree/commit/ref flow is used; no PR, force update,
permissions change, package publication or deployment is involved.

The existing score setter manually discarded new caller fields; reading a new
`revision` field through it reproduced `E_TYPE` on the base compiler. The new
`{record with score}` helper retains that field without knowing its name. This is
an expressiveness improvement, not a repair to legacy record construction.

## Commands and results

Node v22.16.0, npm 10.9.2, Linux x64; Chromium 144.0.7559.96. Commands use
`env -u FORCE_COLOR NO_COLOR=1` to avoid the runner's forced ANSI setting; no
assertion, production limit or concurrency setting is weakened.

| Command / check | Result |
| --- | --- |
| Unchanged exact-base `npm test` | 1,830/1,830 passed |
| `npm run test:record-updates` | 28/28 passed |
| Full `npm test` | 1,862/1,862 passed; no failures, cancellations or skips |
| `npm run example:host` | Passed |
| `npm run example:reducers` | Passed |
| `npm run example:case-studies` | Passed, including both new cases in scalar/SIMD modes |
| `npm run example:record-updates` | Passed; output/resource assertions below |
| `npm run test:docs` | 26/26 passed |
| `npm run audit:core` | Passed, including the new expression entry; 33 + 4 callable names unchanged |
| `npm run check:prelude` and `npm run check:operators` | Passed |
| `npm run build:example` | Passed |
| `node --check scripts/browser-bundle.mjs` and `git diff --check` | Passed |
| `npm run test:browser -- --output .../browser-result.json` | 2,614 core checks + 276 experimental checks / 138 cases passed |
| `npm run test:browser:http` | Attempted; `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| Actual-base comparison script | 126 ASTs, 1,008 old-source artifacts, 16 migrated and 48 explicit-expansion comparisons matched |

The bundled browser suite includes 152 dedicated record-update checks in all
eight modes and both registered application sources. It runs the actual Wasm
compiler/runtime in Chromium, not a host-language replacement. HTTP module and
playground-worker loading remain unvalidated; no network policy was bypassed.
CI for the eventual published commit is separate evidence, inspected after the
normal fast-forward rather than claimed here as a local run.

## Coverage and compatibility

The focused suite covers nine shared value scenarios across all eight SIMD ×
reduction-fusion × memoization modes, plus rejection, source-location and boundary
checks. There are 256 seeded record/lens-law cases. It executes both marked
contract snippets and both registered application examples. All execution is real
emitted Wasm; the reference interpreter is a separate value oracle but shares the
parser and is not a demand or compiler-correctness proof.

Coverage includes puns, grouped bases, nested updates, tuples, static symbol labels,
`with` as an ordinary identifier, lexical source operators, simultaneous swaps,
polymorphic setters/callbacks and captured dictionaries. Missing fields, different
field types, unknown names, duplicate keys, occurs failures and invalid unused
helpers reject. Numeric-product restrictions propagate through a helper whose
updated record is consumed rather than exported.

Demand checks separate overwritten and unused fields, retained guards, empty-stream
preflight and lazy scan seeds. Shared scan identities and split/join cut witnesses
survive; unrelated equal-typed streams still fail zip and scans remain unseekable.
Ledger iteration stops before a negative unvisited suffix and obeys exact loop
budgets. AD matches analytic and finite-difference gradients, keeps floor's zero
derivative and rejects active indices. NaN, signed zero and ordered sums are tested.
Performed-call order/budget, prepared input copies/disposal, output ownership,
post-trap reuse, strict sorting/scratch capacities, cache isolation and expansion
limits are exercised. A scalar updater executes directly without any Wasm memory
or imports at a zero loop budget.

A retained external comparison script compiles **126 distinct unchanged corpus
sources** with actual old/new compilers. All 126 ASTs and **1,008** eight-mode
comparisons match Wasm bytes, ABI metadata, JTE certificates and non-timing
compiler statistics. The two migrated record-update/lens examples match their
actual old artifacts in **16** comparisons. Six representative closed expansions
(configuration, ledger, dictionary, gradient, causal sharing and ordering) match
old-compiler Wasm/ABI/JTE/function artifacts in **48** comparisons, including
ASABI 1 and 2. These finite comparisons are not a formal equivalence proof.

## Resource observations

`npm run example:record-updates` retains actual resource output for two workloads.
It separately compiles metered and unmetered modules. No timing benchmark was run.

| Resource | Configuration | Ledger |
| --- | ---: | ---: |
| Wasm bytes, unmetered / metered | 2,230 / 2,318 | 2,817 / 2,922 |
| Copied input payload bytes | 7 (4 UTF-8 + 3 Bytes) | 24 (all 3 numeric amounts) |
| Result descriptor bytes | 40 | 48 |
| Alignment padding / arena high-water bytes | 1 / 48 | 0 / 72 |
| Additional guest output / scratch / intermediate bytes | 0 / 0 / 0 | 0 / 0 / 0 |
| Emitted loops / visited loop units | 0 / 0 | 1 / 2 |
| Wasm locals / logical local value bytes | 5 / 20 | 26 / 160 |
| User syntax nodes / inference constraints / staging work | 27 / 35 / 32 | 146 / 184 / 89 |
| Scalar graph nodes | 9 | 29 |

Configuration output still creates ordinary owned host results (including a
three-byte Uint8Array and decoded text). Its guest Text/Bytes outputs borrow the
copied input spans. The ledger's explicit state has three Num leaves and one Bool
leaf (28 logical bytes, 32 bytes in its padded record layout); it is lowered into
locals, not a heap/state buffer. The local totals above also include other
bookkeeping and temporaries. Zero scan-machine `stateSlots` in this fold's compiler
statistics does **not** mean a state-free algorithm. Scalar/record input fields
travel in ABI arguments, not copied guest input buffers.

The ledger fixture visits two amounts but the host copied all three; prefix
stopping is not a zero-copy input claim. General ledger work is linear in visited
entries and bounded by the supplied stream/budget. Returned arrays still require
output materialization. The dedicated sort fixture requires 96 scratch and 24
output bytes for three numeric elements; one byte less in either capacity traps.

Shallow update staging copies the immediate field map, not nested payloads.
Updating one field in an 80-field record adds exactly 82 staging-work units in
the boundary fixture (80 copied entries plus the update/replacement expressions).
The exact expansion allowance succeeds, one less rejects with `E_LIMIT`, and
repeated wide updates cannot evade the same budget. No resource limit is raised.
Closed source expansions need not have identical frontend cost: the configuration
expansion uses 38 syntax nodes, 51 constraints and 33 staging units versus
27 / 35 / 32 for updates, while both emit 2,230 bytes. Dictionary updates instead
cost one extra staging unit. No universal zero-cost or speedup claim is made.

## Failures, limits and next priority

The first focused run had three incorrect test assumptions, not production
failures: expected zip/causal and effect-budget codes did not match the established
codes, and floor is differentiable with a specified zero tangent. Assertions were
corrected to those contracts; an actual active-index rejection was added. The
first browser invocation exposed a newline typo in the new test-bundler binding;
it was fixed before the successful browser run. Failed logs remain in the handoff.

Updates are shallow, existing-field and same-type only. Type-changing extension
would require a separate row-subtraction/lacks design. Base expressions are names
or explicitly grouped expressions. Static function/symbol records still cannot
escape the ABI, and this pass adds no general recursion, tagged variants, modules,
escaping closures or guest heap. It adds one audited expression operation, not a
callable builtin: 33 native callable names and four source-prelude names remain.

The projection/row argument in the contract and these finite tests are not a
mechanized soundness proof. Other browser engines are not tested. HTTP module and
playground-worker loading are reported separately from the bundled engine suite.
The next general-language priority is a bounded design for genuine tagged
alternatives and elimination (rather than Boolean-plus-placeholder Option/Result
records), with demand, generic constraints and ABI representation explicit.
