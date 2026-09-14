# Source machine composition and streaming sensitivities: validation

[Clocked machines](CLOCKED-MACHINES.md) · [Sensitivity lift](MACHINE-SENSITIVITY.md) · [Validation index](EVIDENCE.md)

## Revision and scope

Base: merged main `12754f5b69e297d9422205bd1205ff08b8ed142a`, tree
`de77cb80d30ada9751252a785e6b255dce6576ed`. The supplied PR #37 archive was
reconstructed and its tree matched the connected repository. The unchanged
baseline completed 1,540 Node tests. Main remained at that revision at the final
connector read. Three local theory-only commits precede implementation: the
machine protocol, shared-prefix factoring and the machine JVP lift.

Two explicit source libraries add five functions: four composition/reset/running
helpers in `lib/machines.ass` and one optional JVP adapter in
`lib/machine-differentials.ass`. Products, held updates and input/result adapters
reuse the existing reducer library. There are no changes under `src/`; all 33
core modules, the original reducer source and prelude source/snapshot remain
byte-for-byte unchanged. The inventory still has 30 compiler primitives and four
implicit source-prelude functions. The new functions require explicit linking.
Root README, historical reports, dependencies and workflow permissions are intact.

## Completed execution

September 14, 2026; Node v22.16.0, Linux x64; Chromium 144.0.7559.96.
Local checks are not remote GitHub CI or publication evidence.

| Check | Result |
| --- | --- |
| Actual unchanged baseline, default `npm test` | 1,540 passed; zero failures/skips |
| Final implementation, default `npm test` | 1,600 passed; zero failures/skips |
| Clocked-machine focused tests | 33 passed |
| Machine-differential focused tests | 19 passed |
| Documentation suite | 26 passed |
| Chromium engine | 2,145 core + 276 experiment checks passed |
| Actual-baseline compatibility | 113 ASTs and 904 binaries/ABI objects/JTE certificates identical |
| Core inventory and deterministic prelude snapshot | Passed |
| Required host and reducer runners | Passed |
| Workflow, case-study, chunk and window runners | Passed |
| Both new comparison/sensitivity drivers | Passed |
| Example build and changed-JS syntax checks | Passed |
| HTTP browser path | Attempted; `net::ERR_BLOCKED_BY_ADMINISTRATOR` |

All pre-existing tests remain. The reference interpreter has no new semantic
cases. Four ordinary `.ass` examples are registered in the corpus with explicit
library paths. The separate sensitivity kernel is a named source string with
independent derivative checks, not an AD case forced into the unsupported corpus
interpreter. Both browser paths register the new checks; only the engine path
completed. HTTP policy was not changed or bypassed. Other engines and HTTP/worker
loading are not validated by an engine-only pass.

The 68 dedicated clocked-machine browser assertions cover eight source cases in
four lowering modes and bounds/type checks. Sensitivity adds 48 assertions across
all eight modes. Four corpus examples add 16 checks. The original 138 experiment
cases still account for 276 checks. Full Node validation uses default concurrency,
not a reduced suite or relaxed production/test-runner allowance.

## Concrete native work and storage

Both drivers compile and execute actual Wasm. Exact loop and final-array
allowances succeed; one less traps. No host machine or sorting callback is used.

| Fixture, default output fusion | Loop sites | Recurrence slots | Loop units | Final array bytes | Intermediate bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Four held-channel events | 1 | 2 | 4 | 64 | 0 |
| Six reset/resume monitor events | 1 | 2 | 6 | 72 | 0 |
| Seven-event chunk cascade | 1 | 2 | 7 | 56 | 0 |
| Four-event shared-prefix report | 1 | 3 | 4 | 64 | 0 |
| Four-event value/tangent report | 1 | 4 | 4 | 64 | 0 |
| Four-event final value/tangent state only | 1 | 4 | 4 | 0 | 0 |

The final-state-only variant still has a 32-byte result descriptor, and all
variants require their ordinary input/host storage. Recurrence-slot counts are
not all Wasm locals or physical register counts. No elapsed-time claim follows
from these measurements.

Factoring one smoother before total/peak observers, rather than cloning it in
both branches, reduces recurrence slots from four to three, all emitted local-
value bytes from 288 to 224, and the four-unit module from 2,192 to 2,143 bytes.
Both forms yield totals [0,4,10,13], peaks [0,4,6,6] and summary {left:13,right:6}.
The factoring is explicit source, not automatic merging of independent histories.

A synthetic transition containing an inner reduction exposes an existing fusion
boundary. Three output consumers replay the history. The shared form requires
27 loop units and six loop sites; duplication requires 45 units and nine sites.
An initial 9/15-unit expectation incorrectly assumed one traversal; the driver
and regressions now check the ACTUAL 27/45 limits. No compiler rule was changed.
The docs preserve this counterexample to an unconditional one-pass claim.

## Stateful composition, demand and laws

The shared-prefix relation is checked on 400 seeded cases against both an
independent imperative oracle and the explicitly duplicated source. Another 320
cases compare serial association with explicit product-state reassociation.
The laws concern total pure machine transitions and matching states; they do not
merge unrelated domains, justify arbitrary effect reordering, or identify all
failure/work behavior under algebraic rewrites.

All 5,461 sequences through length six over independent left/right enable bits
are checked against a separate state oracle. Disabled lanes hold their values
on the original event clock; disabled payloads can be nonfinite because their
validation is inside the update. Enabled invalid data still fails. The inputs
are aligned by existing checked zips; holding does not invent an alignment proof
for independently filtered arrays.

There are 120 exact split/JSON monitor resumes and 400 block-cascade cases. The
reset target remains the declared zero seed after restoring another checkpoint.
Reset precedes the current transition. Reset outside hold and hold outside reset
are tested as different programs. Holding only an upstream stage still clocks
the downstream stage, while holding the whole composition freezes both states.

Tests distinguish empty-scan lazy seeds from a returned checkpoint's fallback,
strict transition state from potentially undemanded finish expressions, and lazy
pure reset predicates from mandatory guards. Stopping avoids invalid suffixes.
Typed restart uses an unused partial step solely to couple the declared seed's
shape; that check erases to the same bytes and does not run the seed. Wrong state
shapes, duplicate names, unsupported ABI escape, source-local errors, effect
invocations, causal random access, unrelated-domain zip and expansion limits
retain their existing failures. An issued host seed remains one atomic result
through multiple source resets; no new authority is supplied by a machine record.

Raw memory sentinels, snapshots, independently owned results, prepared-call
expiry, compiler caches and post-trap reuse are covered. A direct single-event
export matches the batch machine with zero loop units; it is still an ordinary
host invocation with nonzero execution overhead.

## Streaming JVP and composition evidence

The optional adapter applies the existing source `jvp` to one numeric transition
and observation. State becomes {value,tangent}; a scan carries both through the
original event sequence. The compiler is NOT asked to differentiate a scan.
The usual numeric-product and graph restrictions still reject Boolean state,
wrong tangent shape, loop-containing steps and direct pure host calls. Calling
`grad` on an unsupported scan remains rejected. Renamed adapter source and
explicit core-only prelude linking produce identical binaries to default linking.

On smoothing(alpha=0.5) followed by cumulative total, [0,8,8,0] with input direction
[1,0,0,0] gives values [0,4,10,13] and derivatives [0.5,0.75,0.875,0.9375]. The
last derivative agrees with the independent formula 1-(1-alpha)^4. The step lift
uses four recurrence slots, no tape and one loop; the full report is 4,064 Wasm
bytes. Projecting only the final checkpoint uses zero output-array bytes and a
3,081-byte module. Its storage shape remains fixed through 4,096 tested events.
The input arrays are still supplied by the host; no constant-total-memory API is
claimed. One direction per run is not the full input-history Jacobian.

Across eight lowering modes, 320 seeded cases compare with analytic propagation
AND central differences of the whole independently written primal recurrence,
including perturbed initial states. Another 240 nonlinear cases compare the
whole-composition lift, separately lifted stages under state isomorphism, and an
independent analytic derivative recurrence. The nonlinear dyadic test values give
exact equal results; the mathematical law alone does not guarantee bit equality
for arbitrary floating-point staging. There are 64 exact value/tangent checkpoint
resumes. Direction linearity and explicitly seeded parameter sensitivity are
separate tests; an unseeded captured alpha is held constant.

The sensitivity lift also composes with chunk reset and stopping. A block-local
sum-of-prefixes derivative becomes [1,3,6,1,3,6,1] at width three in one flat loop.
A stopped lifted scan avoids an invalid later event. With output fusion disabled,
the three report consumers replay the lifted scan (12 units/12 slots on four
events). No optimizer or demand contract was strengthened to make a demo pass.

## Numerical and development findings

The long checkpoint-only test initially compared with an algebraically simplified
analytic derivative using exact equality. At 4,096 events it found a real rounding
difference: `dm+0.5*(0-dm)` retains Number.MIN_VALUE once its half correction rounds
to zero; `(1-0.5)*dm` underflows to zero. The final regression asserts this specific
subnormal discrepancy, and exact agreement of the other state components, rather
than hiding it with a broad tolerance or modifying AD. Arbitrarily tiny derivative
accuracy is not established by the real chain-rule proof.

Other initial focused failures were missing documentation snippets before the
guide was populated. The initial monitor's guard wrapped each returned record
field and prevented output fusion; placing the mandatory configuration guard on
the source stream preserved empty-input checking and allowed existing fusion.
No compiler eligibility rule, old assertion, resource policy or prelude snapshot
was weakened. The library is a source-level expression of known state-machine
and forward-AD constructions, not a worldwide novelty claim.

No proof assistant, independent formal audit, human readability study or timing
benchmark was performed. Checkpoints are ordinary caller data, not authenticated
or configuration-checked artifacts. Generic machines need not validate finite
values. Statically generated AD work and library expansion still consume the
ordinary compiler budgets.

## Reproduce

```sh
npm run test:clocked-machines
npm run test:machine-differentials
npm run example:clocked-machines
npm run example:machine-sensitivity
npm run audit:core
npm run check:prelude
npm test
npm run test:browser
```

Publication state and exact patch/source-tree identifiers belong in the external
PR/delivery metadata. These local results do not imply a remote PR exists or that
GitHub CI has run on this work.
