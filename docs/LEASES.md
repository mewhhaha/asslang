# Prepared JS input leases (ASABI 1)

`runtime.prepare(name, args, {outputBytes})` copies inputs once into private,
fixed-capacity memory and returns an exclusive prepared-call handle. The binary
layouts and version remain ASABI 1; the frozen binary compatibility test remains.

```js
const lease = runtime.prepare('smooth', [samples, 0.5]);
try {
  const a = lease.run();
  const b = lease.run({alpha: 0.25});
} finally {
  lease.dispose();
}
```

Only top-level Num/Bool parameters can be overridden, and overrides do not persist
between calls. Arrays, text and records stay at their originally encoded snapshot.
Mutating the original JS array after preparation does not change that snapshot.
Results are copied to independently owned JS values; no raw memory view escapes.

Only one lease may exist per runtime. Normal calls and a second preparation are
blocked while it is live. Private identity and generation checks reject expired
handles; the visible generation number is not a numeric authority token. Disposal
clears retained memory and invalidates the handle; repeated disposal returns false.
Losing an undisposed handle leaves that runtime reserved, so use try/finally.

Traps preserve the pinned inputs for a retry. Output descriptors and storage are
cleared after each prepared call, including failures, without clearing retained
inputs. Disposal clears the entire arena. Reentrant calls/disposal are rejected,
including attempts from Proxy traps during override inspection. Getters are not
accepted as input data properties.

Prepared calls are pure-only: effectful exports are rejected and no host broker
session is activated. Existing capability budgets, replay checks and revocation
are not bypassed. This is a runtime lifetime protocol, not source-level general
borrow inference or a transferable capability token.

These read-only input semantics assume compiler-produced kernels. ABI metadata
does not prove an arbitrary externally supplied Wasm binary will refrain from
writing its input memory. The adapter is not a binary verifier for that property.
A malicious binary can also consume CPU until terminated; memory bounds do not
provide a computation budget. The host remains responsible for accepted code,
resource limits and isolated worker cancellation.

Benchmarks measure preparation separately. Prepared-call timing includes guest
execution, result copying and clearing the output region. The ordinary adapter
additionally copies inputs and clears the full frame on every call. JS results
still allocate managed storage. See `test/leases.test.mjs` and VALIDATION.md.
