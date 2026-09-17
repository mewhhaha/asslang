# Byte input integrity: validation

[Contract](BYTES-INPUT-INTEGRITY.md) · [ABI](ABI.md)

## Outcome and provenance — September 17, 2026

This pass repairs Bytes input framing at the JavaScript/Wasm boundary. It does
not add a language feature, compiler primitive, ABI version, guest allocator or
resource-limit increase.

Base main was `499563c03b6054da7ec49abc2c629bd11e1f54d2`, tree
`e749665fc976eb4621766482ccebc7608e20b774`. CI source artifact 10488603385
reproduced that complete tree exactly after public Git clone was unavailable due
to DNS. PR #42 was already merged and no pull request was open. The theory object
`d5a509ab98397d7dfa1bf77fec73e3642aaf8693`, tree
`0b233f2699eb53c1b10e348f52e5e98ec0a17501`, precedes implementation object
`9d88199d5800b780046860c2d25749150912d92c`, tree
`1995bb7c268e5e4b9a653a9cba198ea789ac9275`.

An earlier normal UTF-8 blob upload was temporarily blocked because the tool could
not determine the request's safety status. No alternate encoding, transport or
permission change was used. A later retry of the same ordinary Git object flow
succeeded, so publication continued without bypassing the block.

## Confirmed defect and repair

The old Bytes branch reserved through public `byteLength`, copied through public
`length`, and advertised that second value in wire slots. A three-byte Uint8Array
with an own `byteLength: 0` therefore reserved zero bytes, copied three bytes and
could overlap a following result descriptor. A shadowed `length` could instead
produce a native RangeError; getters were observable.

The repair first requires a genuine view, then calls the already captured
`%TypedArray%.prototype.length` getter once and reuses that intrinsic element count
for reservation, typed copying and wire slots. This keeps accepted same-realm
Uint8Array subclasses and Node Buffers while rejecting proxies and plain prototype
impostors before property hooks. ECMA-262's intrinsic length, typed-array copying
and `ArrayBuffer.isView` algorithms are the standards basis; no novelty is claimed.

## Executed checks

Environment: Node v22.16.0, Linux x64, Chromium 144.0.7559.96.

| Command / check | Actual result |
| --- | --- |
| Unchanged exact-main `npm test` | 1,807/1,807 passed |
| New regressions against old adapter | 2 passed, **13 failed** as expected |
| `node --test test/bytes-input.test.mjs` against fix | **15/15 passed** |
| Bytes + ABI + lease + effect focused bundle | **53/53 passed** |
| `npm test` with the exact final production and `test/*.test.mjs` blobs | **1,822/1,822 passed**, zero failures/skips |
| Fresh later full-suite retries | execution-tool timeout after >1,600 tests with zero observed failures; not counted as fresh passes |
| `npm run example:host` | Passed |
| `npm run example:reducers` | Passed |
| `npm run example:case-studies` | Passed |
| `npm run test:docs` with color disabled | **26/26 passed** |
| `npm run audit:core` | Passed; 33 native core + 4 source-prelude names unchanged |
| `npm run check:prelude` | Passed |
| `npm run check:operators` | Passed |
| Fresh publishable-tree `npm run test:browser` | **2,454 core + 276 experimental checks / 138 cases passed** |
| Byte-specific candidate browser insertion | **64 additional checks across eight modes passed**; not retained in final harness |
| `npm run test:browser:http` | Attempted; `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| `git diff --check` | Passed |

The successful 1,822-test run used the same fixed `src/abi.mjs` blob
`9e1e605bb13bf9beb8d2e37ab35fcdc689caf11f` and the same complete
`test/*.test.mjs` set as the publishable implementation. The only removed
candidate test change was the non-Node `test/browser.mjs` insertion, so that
removal does not change what `npm test` executes. Later full-suite retries were
not relabeled as passes when the invocation tool timed out.

The final browser engine run was repeated after restoring the published harness;
it validates the actual publishable source rather than the stronger temporary
browser-test candidate. HTTP module/worker loading remains unvalidated because
navigation was blocked by environment policy. No bypass was attempted.

## Coverage and independent checks

The 15 retained Node tests include 256 seeded byte families (32 under each of the
eight SIMD × reduction-fusion × reduction-memoization configurations), independent
content and sum oracles, empty spans, subviews, subclasses, Node Buffers, false
negative/NaN/huge public sizes, and throwing metadata/iterator/constructor getters.
Proxy and prototype impostors reject with zero input-hook calls.

Raw slots, offsets and guard canaries check the reservation interval separately
from high-level round trips. Exact capacity succeeds; one byte beyond capacity
rejects before writes. Overlapping low-level spans retain typed-array copy
semantics. Prepared calls retain copied input across caller mutation, traps and
retries; returned arrays own storage and disposal invalidates the handle. Invalid
input consumes no performed-call permission. Two sequential host calls each
receive an owned copy, preserve order and consume exactly the granted calls.
Unused invalid guest types retain source locations. Both marked design snippets
are extracted and executed.

A retained comparison harness compiled four byte programs (report, selected
lookup, performed host calls and native sorting) against actual old and fixed
sources in all eight modes. **32 comparisons** matched Wasm bytes, ABI objects,
JTE certificates, function statistics and intermediate-buffer counts, covering
ASABI 1 and ASABI 2. This is representative compatibility evidence, not a full
formal equivalence proof.

## Resource observations

For:

```ass
export fn main = (data:Bytes) ->
  {data,size:byte_length data,total:sum (byte_values data)};
```

with `[10,20,30]` and a false public size, `outputBytes:0` returns
`{data:[10,20,30], size:3, total:60}`.

| Resource | Measured observation |
| --- | --- |
| Copied guest input / alignment padding / result descriptor | 3 / 5 / 24 bytes |
| Arena high-water mark | 32 bytes |
| Additional guest output data | 0 bytes; Bytes borrows input inside Wasm |
| Independently owned host byte result | 3 bytes |
| Guest scratch / intermediate buffers / machine state | 0 / 0 / 0 bytes |
| Unmetered / metered Wasm | 1,182 / 1,287 bytes; ASABI 1 |
| Emitted loops / visited loop units | 1 / 3; budget 3 succeeds, 2 traps |
| Wasm locals / logical local value bytes | 9 / 56 |
| User syntax / source-prelude nodes | 12 / 107 |
| Inference constraints / scalar nodes / staging work / proof steps | 91 / 9 / 53 / 2 |

Input copying remains linear and managed calls still scrub/reset the arena. No
timing benchmark or speedup is claimed. Matching emitted artifacts show that the
repair is host framing rather than changed guest semantics.

## Limits and next priority

This is a bounded correctness repair, not a complete adapter security audit or
formal proof. Existing same-realm classification is retained. Replaced global
intrinsics, arbitrary malicious Wasm and concurrent shared-storage mutation are
outside this result. Detached/out-of-bounds typed views still fail with the
engine's native TypeError rather than a normalized ABIError. Other browser engines
were not run.

A useful follow-up is to make detached/invalid typed-view diagnostics consistent
between `[Num]` and `Bytes` without broadening accepted realm/proxy authority.
