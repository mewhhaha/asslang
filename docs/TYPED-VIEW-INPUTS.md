# Typed-view input validity

[Documentation](README.md) · [ABI](ABI.md) · [Byte integrity](BYTES-INPUT-INTEGRITY.md)

## Problem and acceptance criteria — design before implementation

Base main: `e82260f398ddcc69164439ec95a475e40bd8e2ba`, tree
`d467984f3251d0b155c2c77f7afce0dbfac3e7c7`. The preceding byte-span repair makes
`Bytes` and typed `[Num]` inputs use intrinsic typed-array lengths rather than
shadowable JavaScript metadata. One validity gap remains: a detached or
out-of-bounds typed view still reaches the intrinsic copy operation and leaks an
engine-specific `TypeError`. This happens after the arena has already reserved the
reported zero-length span. The same boundary therefore diagnoses ordinary invalid
ABI values with `ABIError`, but detached `Uint8Array` / `Float64Array` values with a
native exception whose text varies by engine.

The language source is ordinary and already valid:

```ass
export fn byte_count = (data:Bytes) -> byte_length data;
export fn numeric_count = (data:[Num]) -> count data;
```

A host can invalidate a same-realm typed view without changing its JavaScript
class:

```js
const data = new Uint8Array([10, 20, 30]);
structuredClone(data.buffer, { transfer: [data.buffer] });
runtime.call('byte_count', [data]);
```

After this change, invalid `Bytes` and typed `[Num]` views must fail before arena
allocation with `ABIError` / `E_ABI_VALUE`, while valid empty views, subviews,
subclasses, Node Buffers and ordinary `[Num]` arrays retain their existing
behavior. Rejection must not run input getters, proxy hooks, iterators, species
constructors, guest code or host effects. A failed managed or prepared call must
leave the runtime reusable and must not consume capability calls.

Resizable `ArrayBuffer` views that become out of bounds are the same semantic
case as detached views: the object remains a genuine typed-array view, but its
indexed storage is no longer a valid input span. Fixed zero-length views are
valid. The adapter must distinguish these cases without trusting public
`length`, `byteLength`, `byteOffset` or `buffer` properties.

## Semantics and invariants

Typed-array acceptance remains intentionally narrow and same-realm:

- `Bytes` accepts genuine `Uint8Array` views, including subclasses and Node
  `Buffer`, under the existing `instanceof` plus `ArrayBuffer.isView` rule.
- `[Num]` accepts ordinary dense JavaScript arrays or genuine `Float64Array`
  views under the existing rule. This pass does not add generic typed arrays,
  cross-realm acceptance or array-like coercion.
- Proxies and prototype impostors remain rejected before user hooks run.

For an accepted typed input `v`, the adapter first performs one captured intrinsic
TypedArray validation operation that does not consult user properties. Only after
that succeeds may it read the captured intrinsic typed-array length, reserve the
arena span, and copy. Invalid/detached/out-of-bounds views fail with
`E_ABI_VALUE` before allocation. Valid zero-length views pass validation and keep
length zero.

The validation step is not authority supplied by a Boolean property. It is a
non-generic ECMAScript TypedArray method whose abstract operation validates the
receiver's internal typed-array/buffer state. The adapter continues to own the
higher-level acceptance policy; the intrinsic only establishes that the already
classified view has a usable indexed span.

Arena invariants become stronger: rejected typed views leave `arena.offset` and
memory bytes unchanged. Managed-call cleanup still resets/scrubs after all call
paths. Prepared calls still copy valid inputs once and retain their snapshot until
disposal. The change does not alter source demand, JTE provenance, causal access,
capability sequencing, compiler limits or guest output ownership.

## Representation and lowering

Capture `%TypedArray%.prototype.at` beside the existing intrinsic length getter in
`src/abi.mjs`. A small helper validates by calling the captured method at index
zero, then reads the captured intrinsic length. For a valid empty view, `at(0)`
returns `undefined`; for a valid nonempty view it performs one internal indexed
read; neither path invokes user accessors or iteration. Detached or out-of-bounds
views cause the intrinsic validation to throw, which the adapter converts to its
stable `ABIError` value diagnostic.

Use the helper only after type/classification checks. For typed `[Num]`, run
`ArrayBuffer.isView` before `instanceof Float64Array`, matching the existing Bytes
order, so a proxy cannot trigger `getPrototypeOf` while merely being rejected.
Reuse the helper in both `Bytes` and typed `[Num]` lowering. Ordinary JavaScript arrays keep their existing
dense-own-data-property validation. Do not catch allocation errors, scalar-value
errors, copy-capacity errors, guest traps or host exceptions under the new
normalization; only the typed-view validity preflight maps to `E_ABI_VALUE`.

No source syntax, compiler primitive, JTE rule, Wasm instruction, ASABI layout or
version, guest allocator, dependency, default-prelude name or core-inventory entry
changes. Emitted Wasm/ABI/JTE artifacts for programs are therefore expected to be
identical to the base compiler; only host marshalling behavior for invalid JS
values changes.

## Alternatives and trade-offs

Reading intrinsic `length` alone is insufficient: current ECMAScript semantics
return zero for detached or out-of-bounds typed arrays, so they are
indistinguishable from valid empty views at that point. Public `byteLength` and
`byteOffset` have the same zero-on-out-of-bounds behavior and remain shadowable as
ordinary properties. Inspecting the backing buffer can detect detachment, but does
not in general recover an out-of-bounds view's original byte offset after a
resizable buffer shrinks.

Cloning or slicing the view to validate it would allocate and may involve species
construction. Iteration can invoke user code. Using an intrinsic mutating method
with an empty source could validate without changing bytes, but a read-only
non-generic intrinsic is easier to audit. A new host wrapper type would widen the
public API for a bounded diagnostic repair.

The intrinsic `at(0)` preflight performs at most one element read. Input copying
remains linear in the accepted span, and no guest scratch/intermediate/state
storage is added. This pass makes no timing or security-hardening claim. Replaced
primordials before module initialization, arbitrary malicious Wasm and concurrent
shared-storage mutation remain outside the adapter guarantee.

## Correctness argument

ECMAScript's `%TypedArray%.prototype.at` first validates the typed-array receiver;
a detached or out-of-bounds view cannot complete that validation. A valid empty
view completes validation and returns `undefined`, so emptiness is not confused
with invalidity. After successful validation, the captured intrinsic length is the
same internal span count used by the existing typed copy. Therefore the adapter
can reject invalid spans before allocation while preserving the prior
reservation/copy equation for valid views.

There is no asynchronous user callback between the preflight and copy in
`lowerValue`; for ordinary resizable `ArrayBuffer` storage, user code cannot shrink
it in the middle of this synchronous sequence. Growable shared buffers do not
shrink. Concurrent mutation of shared data remains an explicitly unsupported
atomic-snapshot guarantee, as before.

Finite tests are regression evidence, not a formal proof of every ECMAScript host
or all embedder behavior.

## Primary sources and validation plan

ECMA-262, checked September 17, 2026:

- `%TypedArray%.prototype.at` applies `ValidateTypedArray` before computing its
  index: https://tc39.es/ecma262/multipage/indexed-collections.html#sec-%typedarray%.prototype.at
- Typed-array out-of-bounds validation treats detached backing storage as invalid:
  https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-istypedarrayoutofbounds
- `ArrayBuffer.isView` checks the internal viewed-buffer slot and therefore remains
  a suitable no-hook classification guard:
  https://tc39.es/ecma262/multipage/structured-data.html#sec-arraybuffer.isview

Validation must reproduce the old native-TypeError behavior, then cover normalized
`Bytes` and typed `[Num]` failures for detached and resizable-buffer out-of-bounds
views. Include valid empty views, subviews, subclasses/Buffer, poisoned public
metadata and proxies; low-level arena offset/canaries; managed calls, prepared
calls, post-failure reuse and capability sequencing. Exercise all eight relevant
SIMD/reduction-fusion/memoization modes where typed stream lowering can vary.

Compare representative old/new compiler artifacts to confirm no guest-code change.
Run the full Node suite, required host/reducer/case-study examples, documentation,
core/prelude/operator audits, and Chromium engine suite when available. Treat HTTP
browser loading separately. Record exact results and limitations in a new
validation report and the append-only automation journal.
