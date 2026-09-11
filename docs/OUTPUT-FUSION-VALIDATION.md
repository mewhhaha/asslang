# Causal output fusion validation

[Design and invariants](OUTPUT-FUSION.md) · [Validation index](EVIDENCE.md)

## Baseline and scope

Base: merged main `a3669db6b496a4ba892b306a462d0785d9bb2e88`, tree
`d815e865d113a1e21ce01d953925e8c1666459d8`. The supplied workflow source archive
reconstructed that exact tree, checked against the GitHub connection. The
unchanged baseline passed 1,194 Node tests. A design-only commit preceded all
implementation and test changes.

The new pass plans whole-record output cohorts and extends the Wasm writer. It
adds no syntax, intrinsic, runtime allocation service, input format or ABI layout.
The application kernel `monitor.ass` and its host API are unchanged. Existing
`reductionFusion:false` remains the opt-out. New diagnostics report output cohorts
separately from reduction-only cohorts. Existing historical validation files and
the short root README remain unchanged.

## Executed checks

Environment: Node v22.16.0, Linux x64, Chromium 144.0.7559.96.
Validation date: September 11, 2026. Local results are distinct from remote CI.

| Check | Result |
| --- | --- |
| Unchanged baseline `npm test` | 1,194 passed; zero failures/skips |
| Final `npm test` | 1,226 passed; zero failures/skips |
| `npm run test:output-fusion` | 32 passed |
| `npm run test:docs` | 26 passed |
| `npm run example:output-fusion` | Passed; identical monitor values, one versus three traversals |
| Host, reducer, workflow and existing case-study example runners | All passed |
| `npm run build:example` | Passed |
| `npm run test:browser` | 1,484 core + 276 experiment checks passed (138 experiment cases) |
| `npm run test:browser:http` | Attempted; blocked by `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| Syntax checks and `git diff --check` | Passed |
| Actual-baseline byte comparison with fusion disabled | 372/372 corpus builds byte-identical |

Both browser harnesses register the new module. Only the engine bundle completed
here; no browser policy was changed or bypassed. HTTP module/worker loading,
other engines and throughput benchmarking remain unverified. The 59 new browser
assertions cover all eight SIMD/fusion/memoization configurations, mixed output
values, state-machine counts, exact/short output buffers, empty outputs, precise
loop allowances, recovery, sparse fallback and cache isolation.

## The concrete pain point

`npm run example:output-fusion` compiles the unchanged monitor source with both
settings, SIMD disabled and `maxLoopIterations:4096` in both builds. It checks
identical application outputs and reports actual emitted statistics:

| Metric | Fusion disabled | Default fusion |
| --- | ---: | ---: |
| Loop sites | 3 | 1 |
| Causal machine copies | 3 | 1 |
| Scalar machine-state slots | 15 | 5 |
| Wasm locals | 312 | 158 |
| Wasm bytes, including ABI/limit metadata | 6,403 | 4,531 |

These are measurements of one artifact pair, not a timing or universal size
claim. The streams are still materialized into their final separate output
buffers. The change removes replay and duplicate scalar machine frames; it does
not make outputs zero-memory. It does not vectorize the causal recurrence.

The monitor requires one emitted-loop unit per sample with fusion enabled and
three with fusion disabled. All eight lowering combinations test three samples
at the exact three/nine-unit boundary and one unit below it. The host checkpoint
is unchanged after a trap and advances only on a later successful call. JSON
checkpoint resumption and the original version/configuration checks remain in
force. Existing workflow tests now exercise both scheduling choices explicitly
rather than assuming the historical three-pass default.

## Values, demand and machine state

For all eight modes, fixture outputs and every sequence split are compared to
the independent interpreter. The existing workflow suite retains its additional
100 seeded state-transition checks. Another test constructs 32 parameterized
dense output programs: across eight modes, 256 compiled programs and 2,560 input
evaluations agree with the interpreter. These are finite corroborations of the
inductive scheduling proof, not a proof-assistant verification.

Dedicated tests cover array-only cohorts, multiple chained machines, scalar and
record folds, simultaneous state swaps, counts with undemanded mapped items,
Num/Bool outputs, and duplicate/nested result fields. Cancellation-sensitive f64
sequences, signed zero, infinities and NaN are compared with the unfused result
where the source accepts them. The workflow's own finite-value guards still trap
on invalid readings and state even for empty chunks. Lazy scan initialization is
not demanded by empty output, while a strict fold initial value retains its guard.

Source projection removes unused output fields before planning. Per-element
branches remain lazy in the shared loop. Partial predicate evaluation across
co-demanded sinks may be interleaved differently; work and partial output before
a failed call are not guaranteed to match. Explicit host effects still run in
source order before materialization, require the same capability, and are not
rolled back by a later budget trap. Tests retain missing-field and source-local
diagnostics, function/stream ABI constraints, and causal random-access rejection.

## Raw memory and ownership

A mixed Bool/Num example with nested and duplicated array fields is invoked through
raw Wasm in both modes for lengths 0, 1, 2, 3, 7, 16 and 31. Complete successful
linear-memory images, descriptors, data addresses and end cursors agree byte for
byte. Duplicate nonempty fields have separate buffers. Odd Bool lengths retain
the original eight-byte alignment before the next array. Sentinel bytes outside
the result remain unchanged.

Exact-capacity buffers succeed; one-byte-short buffers trap before the new loop
writes any result data. Invalid input/output overlap, descriptor overlap, pointer
alignment, oversized input lengths and capacities retain entry checks. A
2,147,483,647-element range request into a tiny output buffer is rejected before
multiplication overflow or iteration. No large allocation is needed for this test.
Malformed raw Bool elements still trap. Prepared input snapshots, output-copy
ownership, disposal and post-trap reuse behave as before.

Up-front reservation is only for dense output. A filtered history producing no
elements still succeeds with a zero-byte output arena via the old writer. The
pass never reserves a sparse stream's input extent as if it were its output size.
The exact amount of output written before a failing raw call remains unspecified;
callers must discard failed-call results.

## Conservative compatibility

Explicit fallback tests cover sparse streams, different scan instances, distinct
input origins, unequal guards, conditional scalar results, nested reductions,
nested reduction initialization and stopping folds. Stateless SIMD arrays retain
their previous vectorized writer and byte-identical output. Machine object
identity is required in addition to matching JTE domain/cursor/extent: the planner
does not merge separately instantiated recurrences just because their IDs or
mathematical expressions look related.

In a separate checkout of the actual baseline tree, every accepted corpus source
was compiled with `reductionFusion:false`, both SIMD settings and both reduction-
memoization settings. All 93 entries × 4 configurations (372 builds) produced
identical Wasm bytes in old and new compilers. This is broader opt-out evidence
than comparing two modes of only the new compiler; it is still a finite corpus,
not a universal binary-compatibility theorem.

The initial full run detected the intended change to an old monitor budget
assertion and the not-yet-linked design document. The updated test checks both
modes and documentation is linked. The generated-program test initially omitted
parentheses around negative numeric arguments; its fixture generator was fixed
without changing parser rules. Subsequent focused and full runs passed.

## Remaining limitations

The first implementation requires the whole returned record to be eligible. It
does not form subcohorts around unrelated leaves, fuse sparse output, coalesce
independently built scans, or fuse stateless SIMD output with scalar reductions.
It has no register-pressure/profitability model. Output arrays still occupy their
normal final arena slices, and existing compiler/ABI bounds apply. A successful
optimization can make an old tight loop allowance succeed, consistently with
optimization-dependent loop accounting. No wall-clock speedup, universal fusion,
worldwide novelty, independent formal review or proof-assistant check is claimed.
