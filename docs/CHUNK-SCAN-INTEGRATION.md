# Chunk scan integration

[Chunk views](CHUNK-VIEWS.md) · [Documentation](README.md)

## Contract before implementation

Reconcile PR #35 with merged #34 (main ec52b058). Keep the arithmetic stream-family
representation, outer family zips, selected blocks, integer width checks, and
pointwise flattening semantics from main. Add flattening of a complete dense
block-local scan by resetting its scalar machine at each block boundary. No nested
array storage, descriptor buffers, new token, allocator or ABI is needed.

`xs |> chunks w |> map (b -> scan b 0 (s -> x -> s+x)) |> flatten` must execute
one flat ordered traversal with resets at positions divisible by w. Its event
domain is the source domain, but it is sequential, not randomly indexable. A
following scan remains global. Chained local scans each reset. Shared flattened
bindings share machines; separate flatten calls own distinct state.

## Reconcile policies explicitly

Retain main's metered **preflight of structural block guards** before any flattened
item is consumed. A bad guard in a later block can still fail an early consumer.
Do not import the draft's different visited-only guard policy. Scan seeds remain
lazy: an empty input invokes no seed, and a stopped traversal invokes no later
block seed. These are different, documented obligations.

Retain E_CHUNK_WORK for per-item reductions and iterations, including machine
transition/output/gate expressions. Permit such work in scan seeds, where it is
executed once per visited block, using the existing aggregate loop meter. This
supports per-block mean removal without silently approving quadratic callbacks.
Accept dense, full-cover causal scans; reject sparse/transduced or changed-cover
inner streams. Existing outer family zips and `at` selection must still work.

## Representation and proof

For a valid width w, i = floor(i/w)*w + (i mod w) determines the unique block and
local position. Replace free outer/local coordinates with those expressions.
Protect a nested reduction's bound cursor and accumulator, not its captured block
origin or extent. Use a separate substitution cache for each lexical scope.
Create fresh accumulator/cell identities per flatten, and reset each machine at
local position zero. Any nested reset is combined with this boundary.

Induction on each block's positions shows the same seed and simultaneous state
updates as the original local scan. Induction over block boundaries establishes
the concatenated result. Floating-point operation order is unchanged; no
associativity, parallel prefix, or intermediate materialization is assumed.
The verifier derives nonseekability from the inner scan proof rather than trusting
a requested indexed flag. All code that visits machine dependencies includes reset
expressions, including ordering discovery and loop-memoization planning.

## Compatibility and validation plan

Use main as the base rather than replacing its compiler with the earlier draft.
Retain all historical reports. Existing negative assertions that specifically
reject now-supported scan flattening must become positive regression coverage;
keep the remaining scope/cover/work checks. Test both implementations' useful cases,
including nested seed binders, selected causal blocks, outer family zips, strict
preflight versus lazy seeds, empty data, exact budgets, fused reports, signed zero,
source locations, borrowed memory and certificate tampering.

Run the full Node suite, host/reducer examples and available browser suite; compare
all existing corpus bytes, ABI and JTE certificates with actual main. Report results
here or in a new integration report, not as changes to historical measurements.
This is integration of segmented-state lowering, not a new mathematical algorithm
or machine-checked proof. Do not mark review-ready without successful remote CI.

## Historical design

The [original draft](CHUNK-COMPOSITION.md) and [its recorded validation](CHUNK-COMPOSITION-VALIDATION.md)
remain historical. This integration document supersedes their differing policies.

## Executed integration validation

September 13, 2026; Node v22.16.0, Chromium 144, Linux x64. Actual main snapshot:
`ec52b05814523289005cf6cd3a22f473b812ee00`, tree
`877e6017f3dca0ef05798f7f23873e9abf4b72bf`. Its unchanged full default-concurrency
suite passed 1,441 tests. The integrated tree passes **1,477 tests**, including
**30 scan-composition tests** and all **31 arithmetic-chunk tests**. Only the old
assertion that scan flattening was unsupported changes to accepted-code coverage;
all other #34 cases remain. Documentation: **26 passed**. Chromium engine:
**1,950 core checks and 276 experiment checks passed**. The host, reducer,
case-study, workflow and new chunk drivers all passed. HTTP browser navigation
was attempted and failed with `net::ERR_BLOCKED_BY_ADMINISTRATOR`; no bypass,
HTTP pass, worker-loading pass or other-browser result is claimed.

Against the actual main compiler, all **106 existing corpus sources across eight
lowering settings (848 builds)** retained identical Wasm bytes, ABI objects and
JTE certificates. New cases include 2,369 exhaustive input/width combinations,
800 seeded nested cases, chained/record/Bool scans, six forms of seed reductions,
private causal seed binders, shared versus independent flattening, raw canaries,
prepared widths, effects, sorting, selected scanned blocks, outer zips and forged
seekability certificates. Finite tests are not a complete compiler proof.

The seven-sample width-three report emits one loop, two state machines, zero
runtime zip checks and zero intermediate buffer bytes. Its exact allowance is
7 loop units and 112 final-array bytes. Block energy uses 10 units and 24 output
bytes; mean removal uses 14 units and 56 output bytes. One unit/byte less traps.
Final arrays, descriptors and host copies still occupy storage. No timing speedup
or historical novelty claim is made. Nested chunk widths can introduce an extra
preflight pass; a seven-sample nested scan costs 7+ceil(7/outerWidth) units, not 7.

During reconciliation, the earlier draft's report filename collided with main's
report fixture. The integrated examples live in `examples/case-studies/chunk-scans/`
and main's original files and CLI IDs are unchanged. Initial test failures exposed
that collision and a nested preflight budget assumption; neither was addressed
by weakening existing semantics. This report supersedes the earlier draft's guard,
work-policy, scope and publication statements.

## Run

```sh
npm run test:chunk-composition
npm run example:chunk-composition
printf '[[1,2,3,4,5,6,7],3]' | node examples/case-studies/app.mjs chunk-report
```

The full programs are [the report](../examples/case-studies/chunk-scans/block_report.ass),
[energy](../examples/case-studies/chunk-scans/block_energy.ass), and
[mean removal](../examples/case-studies/chunk-scans/block_center.ass).
