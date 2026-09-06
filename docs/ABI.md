> Subsequent stopping-kernel and source-composition changes are documented in
> [COMPOSABILITY.md](COMPOSABILITY.md), with [current validation](COMPOSABILITY-VALIDATION.md).

# ASABI 1: stable JavaScript / Wasm memory contract

Status: implemented, versioned project ABI. The version-1 layouts below are frozen;
future incompatible layouts require a different version. The adapter checks the
version inside the binary, not a mutable JavaScript sidecar. A frozen binary and
layout fixture live in `test/fixtures/asabi1-snapshot.*` and run without recompiling
source. This is **not** the WebAssembly Component Model Canonical ABI and does not
claim interoperability with a component-model toolchain.

## Values and layouts

Pointers and lengths are unsigned 32-bit quantities. Memory is little-endian.
Field names use the language's ASCII identifiers. Sizes and alignments are bytes.

| Source value | JS value | In-memory layout | Size / alignment |
| --- | --- | --- | --- |
| `Num` | `number` | IEEE-754 binary64 | 8 / 8 |
| `Bool` | `boolean` | u32, exactly 0 or 1 | 4 / 4 |
| `Text` | `string` | u32 pointer, u32 UTF-8 byte count | 8 / 4 |
| `Bytes` | `Uint8Array` | u32 pointer, u32 byte count | 8 / 4 |
| `[Num]` | `Array<number>` or `Float64Array` in; `Float64Array` out | u32 pointer, u32 element count; contiguous f64 elements | 8 / 4; elements 8 / 8 |
| `[Bool]` | `Array<boolean>` | u32 pointer, u32 element count; contiguous u32 0/1 elements | 8 / 4; elements 4 / 4 |
| Records | objects with own data properties | fields in ascending ASCII name order, each naturally aligned; final size padded to largest alignment | recursive |

A record `{ z: Bool, a: Num }` puts `a` at byte 0 and `z` at byte 8, with total
size 16 and alignment 8. Source/object insertion order does not affect layout.
Padding is ignored by consumers; it is not an additional value or a serialization
channel. The high-level runtime clears the arena between calls.

Text has no terminator. The byte count is not a character count. UTF-8 decoding is
strict; embedded NUL and an initial BOM are preserved as characters. JS strings
containing unpaired UTF-16 surrogates are rejected instead of silently replaced.
Numbers preserve negative zero and support infinities and NaNs; NaN payload bits
are not a JS round-trip guarantee. No JavaScript object pointers or GC references
occur in linear memory.

There are no runtime length indices in stream types. Lengths here are ordinary
memory bounds in a wire descriptor, not type-level arguments.

## Function calling convention

Input records flatten recursively in canonical field order. Num uses an f64
parameter, Bool uses an i32 parameter, and each span uses two i32 parameters.

Scalar-returning exports return f64 or i32 directly. Their calling convention is
compatible with the prototype-0 scalar/span convention. Composite-returning
exports append three arguments after their ordinary flattened inputs:

```text
(resultDescriptorPointer: i32, outputStart: i32, outputCapacityBytes: i32)
  -> i32 finalOutputCursor
```

The caller allocates the fixed-size result descriptor and the output-data region.
The generated function writes the descriptor and materializes returned streams
into that region. Each output array begins on an eight-byte boundary. Capacity is
checked before every element write. Record fields containing arrays are emitted
in canonical field order. Text/Bytes result descriptors may borrow input data;
returned numeric/Boolean streams currently materialize into the output region.
There is no guest heap allocator or `memory.grow` instruction.

All spans are bounds-checked at function entry with 64-bit endpoint arithmetic.
The result descriptor and output region must not overlap one another or any input
span. Empty ranges do not overlap. Output cursor endpoints must be at most
2,147,483,647, preventing wrapping cursors. Input span containment uses the whole
memory; it does not confer authority to data outside the supplied call frame.
The raw ABI caller is responsible for choosing its authorized inputs.

Invalid inputs, impossible range lengths, failed `require` contracts, invalid
indices, mismatched checked zips, and output exhaustion trap. **A trap can leave a
partially written result area.** Treat the whole result as invalid after failure.
Host side effects that already executed are not rolled back.

## The binary describes its own contract

Exactly one `asslang.abi` custom section contains UTF-8 JSON with:

```text
version, addressBits, byteOrder
host function declarations and their exact schemas
export input schemas / flattened parameter slots
export result schema / layout / output slots
ordered host-effect traces, including multiplicity
```

The JTE observation certificate remains a separate compiler result; it is not
embedded in the binary. ABI metadata adds a noticeable fixed overhead to tiny
modules, so benchmarks report `abiMetadataBytes` separately. The metadata is not
a signature and is not proof that an arbitrary binary behaves honestly.

## Recommended JS adapter

```js
import { compile } from './src/compiler.mjs';
import { createRuntime } from './src/abi.mjs';

const program = compile(`
  export fn summarize(x: { name: Text, values: [Num] }) = {
    name: x.name,
    total: sum(x.values),
    doubled: map(x.values, n => n * 2)
  };
`);
const runtime = await createRuntime(program, { pages: 2 });
const result = runtime.call('summarize', [{
  name: 'measurements',
  values: new Float64Array([1, 2, 3])
}]);
// { doubled: Float64Array([2,4,6]), name: 'measurements', total: 6 }
```

`createRuntime` also accepts .wasm bytes; source and a compiler instance are not
needed to run a previously built module. The high-level runtime owns a private,
fixed-size, unshared memory. `pages` defaults to 1; one page is 65,536 bytes.
`initial` and `maximum` are equal, and calls never grow memory. The runtime exposes
capacity/high-water counters, not its instance or memory.

Inputs are copied into a reusable frame. Outputs are copied into independently
owned JS values before the entire arena is zeroed and reset in `finally`, including
after traps or host exceptions. An earlier result therefore survives later calls.
JS arrays, records, text decoding and the compiler itself still allocate managed
objects. This design is not an end-to-end zero-GC claim.

The default output allowance is the remaining arena. A per-call `outputBytes`
option can make the budget smaller. There is no automatic retry after overflow:
retrying could duplicate an already executed host effect.

## Low-level integration

`Arena`, `lowerValue`, `prepareCall`, `liftResult`, and `readABI` are exposed for
trusted hosts. `prepareCall` can encode inputs once and supply reusable raw slots;
this is the path used in **kernel-only** benchmarks. The low-level host owns memory
lifetime, non-aliasing, exclusive access and invalid-result handling. The ordinary
`instantiate` helper rejects modules declaring host imports; use the brokered
runtime for those.

The high-level runtime intentionally does not return raw borrowed JS views.
A generation-checked borrow/lease API could reduce copies later, but simply
returning a typed array into a resettable arena would permit stale views.

Limits: at most 128 fields per record level, depth 24, and 4,096 schema nodes per
checked type; at most 128 parameters per function, 256 host declarations and 1,024
exports. The adapter's ABI metadata section is bounded to 1 MB. Arrays of records,
variants, recursive/cyclic objects, opaque host handles, newly constructed text,
and host functions returning composite values are not implemented yet.

## Relevant standards and precedents

The Component Model also defines explicit lifting/lowering of structured values:
https://github.com/WebAssembly/component-model/blob/main/design/mvp/CanonicalABI.md
ASABI uses its own layouts and lifetime rules, rather than claiming compatibility.

WebAssembly memory growth can invalidate old JS buffers/views:
https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow
The high-level runtime avoids that issue by keeping its memory fixed. Low-level
Arena views are recreated from the current memory buffer.
