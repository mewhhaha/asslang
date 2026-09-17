# Typed-view input validity: validation

[Contract](TYPED-VIEW-INPUTS.md) · [ABI](ABI.md) · [Evidence](EVIDENCE.md)

## Outcome and provenance — September 17, 2026

This pass normalizes invalid same-realm `Uint8Array` / `Float64Array` host inputs
without changing Asslang source semantics, compiler primitives, JTE, Wasm emission,
ASABI layouts, guest allocation, dependencies or resource limits. Base main was
`e82260f398ddcc69164439ec95a475e40bd8e2ba`, tree
`d467984f3251d0b155c2c77f7afce0dbfac3e7c7`; its successful CI source artifact
10503998005 reconstructed that tree exactly. There were no open pull requests.

Theory object `3e756b5c804dcc7922ebb7d5db9a981c9a85cbf9` precedes implementation object
`7b098726dbfc17f2ecca506999b5aaf640cd6ec7`, whose tree is
`23955a5095cabbe10281b9df986cf49efb6a625d`. The GitHub tree exactly matches the
locally tested implementation tree.

## Confirmed defect and repair

A detached or resizable-buffer out-of-bounds typed view still satisfies the
existing JavaScript class check. Its intrinsic typed-array length is zero, so the
old adapter reached the copy operation and leaked an engine-native `TypeError`;
for `[Num]`, an alignment-only zero-byte allocation could occur first. Numeric
proxy classification also evaluated `instanceof Float64Array` before
`ArrayBuffer.isView`, allowing a proxy `getPrototypeOf` hook to run.

The repair captures `%TypedArray%.prototype.at` beside the existing intrinsic
length getter. After no-hook classification, one intrinsic `at(0)` call validates
the receiver and backing storage; valid empty views return `undefined`, while
detached/out-of-bounds views throw and are normalized to `ABIError` /
`E_ABI_VALUE`. Only after successful validation does allocation/copying begin.
The `[Num]` classification now checks `ArrayBuffer.isView` before `instanceof`.

ECMA-262's `%TypedArray%.prototype.at`, typed-array out-of-bounds validation and
`ArrayBuffer.isView` algorithms were checked as primary sources on September 17,
2026. This is standards-based host framing, not a novelty claim.

## Executed checks

Environment: Node v22.16.0, Linux x64, Chromium 144.0.7559.96.

| Check | Result |
| --- | --- |
| New regressions against unchanged old adapter | 2 passed, **6 failed** as expected |
| `node --test test/typed-view-inputs.test.mjs` against fix | **8/8 passed** |
| Typed views + Bytes + ABI + ergonomics + leases + effects | **77/77 passed** |
| Full `npm test` on implementation | **1,830/1,830 passed**, zero failures/skips |
| `npm run example:host` | Passed |
| `npm run example:reducers` | Passed |
| `npm run example:case-studies` | Passed |
| `npm run test:docs` | **26/26 passed** |
| `npm run audit:core` | Passed; 33 compiler callables + 4 source-prelude names unchanged |
| `npm run check:prelude` | Passed |
| `npm run check:operators` | Passed |
| Chromium engine suite | **2,454 core checks + 276 experiment checks / 138 cases passed** |
| HTTP browser mode | Attempted; `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| Representative old/new artifact comparison | **24/24 identical** across eight lowering modes |

The focused regressions cover detached and resizable-buffer out-of-bounds Bytes and
`[Num]`, valid empties, subviews, subclasses, Node Buffer, poisoned public metadata,
proxies/prototype impostors, arena canaries, managed/prepared calls, post-failure
reuse, capability sequencing and all eight SIMD × reduction-fusion ×
memoization configurations. The old adapter fails the same retained cases with
native exceptions or proxy-hook behavior, so the tests are red/green evidence
rather than merely assertions written after the fix.

The artifact comparison compiled Bytes reduction, numeric-stream reduction and an
effectful numeric-stream program with the actual old and fixed sources in all eight
lowering configurations. Wasm bytes, ABI objects, JTE certificates and non-timing
compiler statistics matched in all 24 comparisons. Timing fields were deliberately
excluded; no timing or speed claim is made.

## Resource observations

A detached `[Num]` input now reports `E_ABI_VALUE` with an arena high-water mark of
**0 bytes** when no prior valid call has occurred. Valid three-element inputs use
3 guest arena bytes for `Bytes` and 24 for `Float64Array` payloads in the measured
scalar-total kernels. Both modules remain ASABI 1, each emitted reduction has one
loop, and `intermediateBufferBytes` is zero. These are workload-specific storage
observations, not a constant-time claim.

The new preflight performs at most one intrinsic element read before the existing
linear copy. It adds no guest scratch, state or intermediate array. Managed calls
still scrub/reset their arena after completion or failure; prepared calls still own
the copied input snapshot. Invalid input is rejected before a performed host call,
so capability call counts remain unchanged.

## Limits

The adapter intentionally retains same-realm typed-array classification and does
not accept arbitrary cross-realm or array-like values. Replaced primordials before
module initialization, arbitrary malicious Wasm and concurrent shared-storage
mutation are outside this result. Only Chromium was run; the separate HTTP path
was blocked by environment policy and no bypass was attempted. Finite tests and
artifact comparisons are regression evidence, not a formal proof.
