# Corpus, ordered SIMD and default-cohort validation

## Source and environment

Validated on 2026-09-06, starting from `main` commit
`5b664e837d82587f2b51097d0b24a6c58cac1ed3` (tree
`da54ebabb04eb1e478decccde69fc703bedddf30`). The local source snapshot was checked
against that tree before editing. The initial [theory](EXAMPLES-SIMD.md) was
committed before implementation. This report describes this change, not a rewrite
of the historical reports or a timing benchmark.

Environment: Node v22.16.0, Linux x86_64, Chromium 144.0.7559.96.

## Executed checks

| Command | Result |
| --- | --- |
| `npm test` | 445 tests passed, 0 failures, 0 skipped (baseline: 312) |
| `npm run example:host` | Passed explicit capability/ASABI host example |
| `npm run example:reducers` | Passed existing source-linked reducer driver |
| `npm run example:case-studies` | Passed all six cases in scalar and SIMD modes (12 executions) |
| `npm run test:browser -- --output /mnt/data/final-browser-tests.json` | 1,076 Chromium checks passed; retained as `examples-simd-browser-tests.json` |
| `npm run test:browser:http` | Blocked by environment: navigation failed with `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| `git diff --check` | Passed |

The browser runner's bundle mode executes real Wasm in Chromium, but does not
validate native HTTP module loading or playground worker loading. Those two
limitations are also listed in the retained JSON. DOM/worker handler tests run in
Node, including option forwarding, but are not substitutes for native browser
worker loading. No browser benchmark or throughput comparison was run. These
results do not claim SIMD speedups.

## Corpus and application coverage

The corpus has **91 runnable exports** (48 existing + 43 new), **18 unsupported
feature fixtures**, and **3 intentionally rejected programs**. All example `.ass`
files are registered; coverage tests fail on omissions. Unsupported examples are
checked against their actual diagnostic codes, in all four compiler modes.
Unexpected success fails rather than silently skipping the fixture.

The 43 additions comprise 27 language-pattern examples, five algorithms, five
SIMD examples, and six app-like cases. Inspiration/variant notes explain which
constructs are mimicked by static functions and structural dictionaries, rather
than promising complete features from another language. The new
`lib/patterns.ass` is ordinary explicitly linked source, not a hidden builtin.

Case studies exercise telemetry validation/statistics, checkout line processing,
causal session segmentation, inventory replenishment, particle stepping, and text
log classification. Each has a concrete ABI, expected output, host instructions,
and domain limitations. Empty, invalid, misaligned, nonfinite and ownership cases
are tested where relevant. The JSON-input CLI also has tests for real caller data,
unknown case IDs, wrong argument shape, malformed JSON and its 1 MiB input bound.

## Implementation evidence

Expanded runnable examples execute against their expected answers and the
independent reference evaluator with `simd` true/false crossed with
`reductionFusion` true/false. The reference evaluator now understands canonical
currying/partial application and explicit host-call saturation. Demand behavior is
checked separately in Wasm, not inferred from the eager reference evaluator.

SIMD tests cover every emitted lane operation, empty/singleton/odd lengths,
cancellation-sensitive ordered sums, NaN/infinities/signed zero/subnormals, and
500 seeded map/checked-zip/reduction inputs. They inspect actual vectorized-loop
statistics, validate binaries, compare ABI contracts and JTE certificates, and
exercise exact output capacity, 8-byte (not necessarily 16-byte) alignment,
memory-edge tails, mismatched lengths and overlap/bounds traps. Masked, guarded,
causal and indexed computations retain scalar fallback. The zero-pair scalar-tail
cache is independent of vector-only locals. Option validation, alias normalization,
cache separation, CLI flags and unsupported-target `E_TARGET` diagnostics are
covered. SIMD instruction encodings follow the standard WebAssembly SIMD binary
encoding, not relaxed SIMD.

Chromium additionally executes all **90 pure corpus exports in both SIMD/fusion
modes**, checks all 18 unsupported diagnostics and ordered-reduction/tail cases.
Those compilations emit **38 vectorized loops** in total; this is a structural
count across compilations, not a hardware performance measurement.

## Pathology promotions and compatibility

| Original example | New location | Evidence |
| --- | --- | --- |
| `pathological/shared_reduction.ass` | `algorithms/shared_reduction.ass` | Existing demand-scoped memoization shares the reduction; regression asserts one memoized reduction rather than per-element replay (the sum and output map retain two loop sites) |
| `pathological/multi_reduction.ass` | `concepts/multi_reduction.ass` | Default compatible cohort emits one traversal; explicit fusion-off emits two |
| `pathological/scan_replay.ass` | `concepts/scan_replay.ass` | Default emits one traversal/one scan machine; explicit fusion-off emits two traversals |

The examples retain the original computations, expressed in canonical syntax.
Repeated prefixes remain quadratic; expansion still reaches the staging bound.
No historical benchmark evidence was overwritten.

Scalar emission remains the default. `simd: true`/`--simd` opts into f64x2 maps and
ordered additive reductions; no vector ABI or f32 narrowing is introduced.
Reduction cohorts now default on. `reductionFusion: false` or
`--no-reduction-fusion` restores independent traversals. The old
`experimentalReductionFusion` option remains an alias; contradictory values fail.
The browser defaults and compiler cache reflect these choices. No ASABI 1 layout,
implicit I/O or capability authority was changed.

## Remaining limits

Fusion has no profitability/register-pressure model, and takes precedence over
SIMD for multi-sink cohorts. SIMD excludes state machines, sparse streams,
random-access kernels, lane shuffles, arbitrary callbacks and explicit vector
source types. It preserves scalar addition order instead of promising maximal
reduction throughput. Floating-point NaN payload bits are not guaranteed.

The unsupported catalogue remains a roadmap with current variants, not an
implementation claim: recursion, escaping closures, dynamic collections/modules,
async effects, text construction, typed sums and other missing mechanisms require
separate design work. The apps are bounded examples, not production services;
checkout uses f64, not decimal money, and log analysis classifies UTF-8 bytes,
not Unicode graphemes. HTTP/worker loading remains unverified in this environment.
