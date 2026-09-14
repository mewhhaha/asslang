# Old-state feedback validation

[Design and examples](MACHINE-FEEDBACK.md) · [Evidence](EVIDENCE.md)

## Source and scope

Based on merged main `d47539f51deb935cac721a92bc2ddfa0f044b763`, tree
`ae2ac25cdb1eb950b12a6bab577174b61e503262`. The source from PR #39's CI archive
reconstructed that exact tree. Its unmodified default Node suite passed 1,651
tests. A documentation-only design commit precedes implementation.

This adds one eight-line source file, `lib/machine-feedback.ass`, which keeps the
existing machine state and finish function and wires an old-state observation
into its step input. All 33 compiler modules are byte-for-byte unchanged. The
core still has 30 primitives and four prelude names. Existing libraries, limits,
ABI, effect authority, dependencies, workflows and the root README are unchanged.
Three corpus entries demonstrate quantization, independent block resets, and a
smooth numerical tracker; a named source fragment tests tracking sensitivities.

## Executed local validation

September 14, 2026: Node v22.16.0, Linux x64, Chromium 144.0.7559.96.
These completed local runs are distinct from remote GitHub CI.

| Check | Result |
| --- | --- |
| Actual baseline default `npm test` | 1,651 passed; no failures/skips |
| New default `npm test` | 1,686 passed; no failures/skips |
| `npm run test:machine-feedback` | 29 passed |
| Documentation suite | 26 passed |
| Chromium engine | 2,301 core + 276 experiment checks passed |
| Actual baseline compatibility | 119 ASTs and 952 binaries, ABI objects and certificates identical |
| Core inventory and prelude snapshot checks | Passed |
| Host/reducer, case-study, machine, sensitivity and operator drivers | Passed |
| New example and ordinary example build | Passed |
| Syntax checks and `git diff --check` | Passed |
| HTTP browser path | Attempted; `net::ERR_BLOCKED_BY_ADMINISTRATOR` |

Both browser harnesses register the new checks. The feedback browser module runs
72 assertions across all eight SIMD/fusion/memoization modes and the new corpus
entries add 12 through the existing suites. There are still 138 experiment cases.
The HTTP policy was not changed or bypassed; no HTTP/worker-loading result, other
engine support, independent audit, proof-assistant result or timing gain is claimed.

## Functional and differential evidence

All 5,461 words through length six over {-0.75,-0.25,0.25,0.75} are compared with
an independent quantizer recurrence. Every prefix checks the exact dyadic total
identity and half-unit residual range. Another 320 seeded sequences across eight
modes use signed inputs, four units and nonzero saved residuals. JSON checkpoint
splits reproduce the continuous output. Independent blocks intentionally restart
the residual and produce a different output. Caller input and prior result
storage are not reused as feedback storage.

Tests establish previous-state timing directly, including two cross-coupled lanes
which swap values simultaneously. An outer reset reads feedback from the reset
seed, while a reset inside the open body still receives the old outer feedback.
The two programs deliberately differ. Holding the complete machine does not drop
its clock. An ignored trapping observer remains lazy, but a demanded next-state
field is strict. Empty scans and stopping before an invalid feedback suffix retain
the original demand rules.

For nonlinear numeric feedback, 240 cases compare lifting the whole closed machine
with closing its lifted body, after routing both the feedback value and its
tangent. An independently written analytic recurrence and central finite
differences of its complete primal history provide separate checks. A deliberately
zeroed feedback tangent disagrees, demonstrating that feedback sensitivity is not
silently treated as a capture. Existing loop-containing derivative rejection is
retained. The quantizer itself is not claimed differentiable.

The tracking fixture at gain 0.5 has outputs [0.5,0.75,0.875,0.9375] and impulse
sensitivities [0.5,0.25,0.125,0.0625]. Value/tangent checkpoints resume exactly at
every split. These are selected numerical cases, not stability or convergence
certificates for arbitrary closed loops. The tracker expects suitably scaled
finite inputs; its bare source is not a production input-validation boundary.

## Native resource measurements

Eight inputs of 0.25, unit 1 and zero seed yield [0,1,0,0,0,1,0,0]. Independent
rounding yields eight zeros. Width-three block quantization instead returns
[0,1,0,0,1,0,0,1]. The complete driver checks those answers and the following
exact resource limits:

| Export/result | Loop sites | Recurrence slots | Loop units | Output-array bytes | Descriptor bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Quantized trace and state | 1 | 2 | 8 | 64 | 24 |
| Quantized final state only | 1 | 2 | 8 | 0 | 16 |
| Independent block quantization | 1 | 2 | 8 | 64 | 8 |
| Tracking values, tangents and state | 1 | 4 | 4 | 64 | 48 |

Every listed program has zero intermediate data buffers. The adapter does not
add fields to the body's state; observations may independently contain extra work
or nested state. With fusion disabled, the trace and checkpoint can replay the
scan: quantization uses 16 instead of 8 loop units, and the sensitivity example
uses 12 instead of 4. No unconditional fusion theorem is claimed.

Replacing the feedback constructor in the actual quantizer with explicit port
wiring gives identical Wasm. Renaming the helper and compiling in core-only mode
also preserve bytes in all eight modes. Quantizer modules contain both trace and
block exports: the measured metered module is 3,612 bytes; removing the trace from
the first export gives 3,355 bytes. The metered tracker/sensitivity module is 5,638
bytes and contains both exports. Module sizes are not single-export sizes or
timing measurements. Other Wasm locals, source arrays, compiler objects, final
storage and host snapshots are additional memory.

One fewer loop unit/output byte fails. Raw Wasm calls preserve canaries outside
the result, have no scratch ABI field and use ordinary checked frames. Prepared
calls snapshot inputs, recompute feedback per invocation, clean up after traps,
and reject expired leases. A checkpoint-only run of 4,096 events retains two
state slots and no output array. This is not constant total host memory: its input
array and descriptor still exist.

A costly feedback observer summing `range previousState` needs nine units for
three events: three outer steps plus 0+2+4 observer iterations. Eight units fail.
The adapter does not silently hoist this changing observation or call it constant
time. Compiler/type/ABI and pure host-call restrictions remain in force; performed
host results still execute once before the subsequently failing metered loop.

## Numerical and validation limits

The quantizer uses `unit*floor(corrected/unit+0.5)`. Its half-unit error argument
is over reals, not arbitrary f64 arithmetic. A concrete regression keeps the
limitation visible: for corrected value 2^52+1 at unit 1, adding 0.5 rounds up by
one, so the computed residual is -1 rather than in [-0.5,0.5). A finite result
therefore does not certify the real bound. Extreme quotients, nonfinite inputs,
invalid units and invalid saved states have separate explicit failure tests.
No rounding rule or tolerance was silently changed to manufacture conservation.

The initial focused run used a nonexistent `scratchReservationSites` statistic
for a nonsorting module. The assertion was corrected to inspect the real ABI
(no scratch field) and `intermediateBufferBytes` directly; no production code or
resource rule was changed. The external compatibility runner initially passed
`path.resolve` directly as an Array.map callback; fixing its unintended extra
arguments allowed the complete 952-build comparison to run. Only completed runs
are listed as evidence.

Old-state feedback and error-feedback quantizers have established prior art; the
design links primary sources. The contribution is a reusable source construction,
its numerical examples, and executable composition/demand/resource laws—not
unrestricted recursion, an instantaneous fixed-point solver, a novel quantizer,
a reverse-mode history derivative or worldwide priority.

## Reproduce

```sh
npm run example:machine-feedback
npm run test:machine-feedback
npm run audit:core
npm run check:prelude
npm test
npm run test:browser
```
