# Byte input span integrity

[Documentation](README.md) · [ABI](ABI.md) · [Prepared calls](LEASES.md)

## Problem and acceptance criteria — design before implementation

Base main: `499563c03b6054da7ec49abc2c629bd11e1f54d2`, tree
`e749665fc976eb4621766482ccebc7608e20b774`. Its retained CI source archive
reproduces that complete Git tree. An exploratory run on the unchanged adapter
confirmed that Bytes input framing reads ordinary, shadowable `byteLength` and
`length` properties. Allocation uses the former; copying and wire slots use the
latter. These need not describe the typed array's actual storage.

This source is already valid and needs no language change:

<!-- bytes-integrity-source -->
```ass
export fn echo = (data:Bytes) -> data;
export fn total = (data:Bytes) -> sum (byte_values data);
```

A three-byte view can carry unrelated own properties:

<!-- bytes-integrity-host -->
```js
const data = new Uint8Array([10, 20, 30]);
Object.defineProperty(data, 'byteLength', {value: 0});
const result = runtime.call('echo', [data]);
```

Before the fix, the last line traps: the adapter reserves zero input bytes,
copies three anyway, and places the result descriptor over the input. A shadowed
`length` can instead cause a native RangeError; a getter is actually called.
After the fix, the same call must return independently owned bytes `[10,20,30]`,
with three bytes reserved for the input and no invocation of metadata getters.
The unrelated property is not an authoritative size or a reason to allocate more.

Acceptance requires the actual span to determine allocation, copy length and
wire count together. Test ordinary arrays, subviews, Uint8Array subclasses,
shadowed properties/getters, empty and exact-capacity spans, invalid inputs,
prepared snapshots, effects and failure recovery. Exercise real emitted Wasm,
including all eight SIMD/fusion/memoization combinations. This is an adapter
correctness repair, not a new byte-processing primitive or a security audit.

## Semantics and invariants

For an accepted byte view with intrinsic element count `n`, `lowerValue` must
reserve exactly `n` input bytes, copy exactly those elements and return `[p,n]`.
The occupied interval is `[p,p+n)`. Subsequent allocations must start no earlier
than its end, with their normal alignment. Neither a subview's backing-buffer
size nor any user-defined `length`, `byteLength`, `byteOffset` or `buffer`
property may alter that interval. Empty views reserve zero input bytes.

Use the adapter's already captured `%TypedArray%.prototype.length` getter, as
its Float64Array path already does. Call it directly rather than looking up a
property on the input. Require `ArrayBuffer.isView` before the existing
`instanceof Uint8Array` classification; plain prototype impostors and proxies
must not fall through to array-like copying or execute proxy property hooks.
Keep same-realm Uint8Array/subclass acceptance, not a new cross-realm or generic
array-like API. Ordinary non-byte values fail with `E_ABI_VALUE`.

The intrinsic typed-array copy reads internal slots, not input iterators, length
getters or species constructors, and retains overlapping-span copy semantics for
trusted low-level hosts. Capacity must be checked before copying. Too-large real
inputs fail with `E_ARENA_FULL` even if an ordinary property advertises zero.
Detached/out-of-bounds views remain rejected by the existing native typed-array
copy checks; this pass does not normalize those engine TypeErrors into ABIError.
Concurrent mutation of shared backing storage is not an atomic-snapshot promise.

Managed calls still copy inputs, lift owned results, and scrub/reset the whole
arena in `finally`. A prepared call retains its original input snapshot across
runs and traps, clears only output/scratch until disposal, and invalidates the
handle on disposal. Host effects retain explicit capabilities, exact contracts,
performed-call order and call-budget consumption. An invalid input must not
reach guest code or consume a performed-call permission.

## Representation, compatibility and alternatives

Change only the existing Bytes marshalling branch in `src/abi.mjs`: obtain one
intrinsic length and reuse it for reservation, copy and slots. Add no compiler
rule, source name, Wasm instruction, ABI kind/version, guest allocator, dependency
or resource-limit increase. The core inventory is unchanged because this repairs
an existing representation boundary; the core/prelude/operator audits still run.
Source scope, type inference, AD, JTE, demand and lowering remain untouched.

Rejecting every view with custom properties would unnecessarily reject valid
Uint8Array subclasses and would require additional property inspection. Trusting
both public sizes but checking them for equality still accepts a consistent lie.
Cloning through iteration would invoke user code and add an unnecessary temporary
buffer. Reading intrinsic length once and using the existing typed copy is the
smallest fix for the inconsistent reservation/copy contract.

Guest input storage is `n` bytes; byte results may borrow those bytes inside Wasm
but are copied on lifting into owned JS storage. Result descriptors/alignment are
separate. There is no additional scratch, intermediate buffer or guest state.
Existing byte copying and byte reductions remain linear in visited bytes; no
wall-clock performance improvement or universal zero-allocation claim is made.

## Correctness argument and limits

The intrinsic getter supplies the same element count used by typed-array `set`.
For a valid synchronous view without concurrent backing-store changes, the
reserved destination length is therefore sufficient for the complete copy.
The allocator advances by this same count, so later descriptor/output allocations
cannot overlap its input interval. Subview offsets are handled by `set`'s internal
source span, not by caller metadata. Exact capacities and guard canaries test this
argument independently of successful high-level calls.

This argument assumes the normal JS intrinsics and compiler-produced Wasm; it is
not protection against replacement of global builtins or arbitrary malicious
Wasm. The existing realm/prototype classification is retained, not redesigned.
Finite tests are regression evidence, not a formal proof of the entire adapter.

## Primary sources and validation plan

ECMA-262, read September 17, 2026:

- `%TypedArray%.prototype.length` requires typed-array internal slots and obtains
  its count from them, rather than an own property:
  https://tc39.es/ecma262/multipage/indexed-collections.html#sec-get-%typedarray%.prototype.length
- `SetTypedArrayFromTypedArray` reads internal source/target spans and specifies
  the overlapping-buffer copy behavior:
  https://tc39.es/ecma262/multipage/indexed-collections.html#sec-settypedarrayfromtypedarray
- `ArrayBuffer.isView` checks the viewed-buffer internal slot:
  https://tc39.es/ecma262/multipage/structured-data.html#sec-arraybuffer.isview

These established JS mechanisms justify the implementation choice; no novelty is
claimed. Asslang-specific observations are the reproduced reservation mismatch
and its consequence for this adapter's result-descriptor and lease boundaries.

Run the new regressions against the exact old `src/abi.mjs`, then the fix. Include
independent byte-sum and content oracles, low-level slot/offset/canary assertions,
throwing getter and proxy counters, source-located rejection of wrong guest types,
prepared ownership/disposal/post-trap cases and capability sequencing. Extract and
execute both snippets above. Exercise the existing browser engine harness and, when
retained safely, dedicated browser adversarial cases. Compare representative
emitted Wasm/ABI/JTE artifacts with the actual baseline. Run `npm test`, required
host/reducer/case-study examples, focused ABI, lease and effect tests, docs, core
audit and prelude/operator snapshot checks. Report browser engine and HTTP loading
separately. Preserve exact commands, results, provenance and limitations in a
companion validation report and journal.

## Implemented result

The bounded marshalling repair and Node regressions are implemented. The remote
history keeps the theory object `d5a509ab98397d7dfa1bf77fec73e3642aaf8693`
ahead of implementation object `9d88199d5800b780046860c2d25749150912d92c`.
[Executed validation](BYTES-INPUT-INTEGRITY-VALIDATION.md) records the red/green
baseline, exact artifact comparisons, browser checks, resource observations and
limits. The published implementation keeps the large pre-existing browser harness
byte-identical; a stronger 64-check byte-specific browser insertion was exercised
locally but is not claimed as a retained regression. The dedicated Node suite is
the durable adversarial regression for this host-boundary bug.
