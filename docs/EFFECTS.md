# Host effects: a strict boundary around a pure demand graph

## Source-level protocol

Every declared host function is impure. There is no `pure host` escape hatch.
Host signatures must be concrete. Inputs may be Num, Bool, Text, Bytes, or records
of those types; outputs currently must be Num or Bool.

```text
host fn read_scale(key: Text): Num;
host fn audit(key: Text, value: Num): Bool;

export fn measured(key: Text, samples: [Num]) = effect {
  let scale = perform read_scale(key);
  let energy = samples |> map(x => x * x) |> sum;
  let accepted = perform audit(key, energy * scale);
  { accepted: accepted, value: energy * scale }
};
```

The `effect` block must be the complete body of an exported function. `perform`
statements execute exactly once in source order even if their results are unused.
A returned value may be reused as ordinary data without rerunning the effect.
Ordinary pure bindings retain demand-graph semantics: a pure binding is not an
implicit sequencing barrier. A host argument is evaluated before its operation.
The final result is evaluated after all performed operations.

Imported functions cannot be captured, returned, stored in dictionaries, or called
from pure expressions. Effectful exports cannot be called as pure helpers. This
small, explicitly restricted protocol avoids accidentally changing the evaluation
order of `map`, `count`, or shared reductions. Conditional/looping effects,
effectful higher-order helpers, handlers/resumptions, and async suspension need a
future effect system; they are not silently approximated here.

## Linear without exposing an easily duplicated token

Conceptually each statement transforms the invocation permission:

```text
(token_k, host argument) -> (token_(k+1), ordinary result)
```

The token is **implicit**. There is no source-level token value to duplicate,
discard, put in a record, close over, or forge. Each generated host import receives
an i32 sequence number. That integer is not a secret capability; the actual
permission is private state in the JS broker. The compiled ABI records the exact
ordered operation trace, including repeated operations.

On every imported call the broker checks an active invocation, a live grant, the
expected operation and sequence, and the remaining budgets. It then consumes the
sequence/budget **before** decoding arguments, running a policy, or invoking the
handler. A test mutates a valid Wasm body to replay sequence 0; the second call is
rejected before its handler executes. Throws do not restore spent permissions.
Each successful exported call must complete exactly its declared trace.

This is a linear invocation protocol, not a general-purpose linear type checker
for all values, and not cryptographic authentication of a Wasm program.

## Explicit host grants

```js
import { createRuntime, createCapability } from './src/abi.mjs';

const runtime = await createRuntime(compiled);
const grant = createCapability({
  read_scale: {
    parameters: ['Text'], result: 'Num',
    validate: key => key === 'demo',
    call: () => 0.5
  },
  audit: {
    parameters: ['Text', 'Num'], result: 'Bool',
    validate: (key, value) =>
      key === 'demo' && Number.isFinite(value) && value <= 1000,
    call: (key, value) => { console.log(key, value); return true; }
  }
}, { maxCalls: 2 });

const result = runtime.call('measured', ['demo', [3, 4]], {
  capability: grant,
  maxHostCalls: 2
});
grant.revoke();
```

Grants are frozen objects backed by a private WeakMap, never numeric handles in
linear memory. A fabricated look-alike object is rejected. Each operation needs
an exact matching argument/result schema, not merely a matching name. Missing
operations, insufficient budgets and mismatched signatures are rejected before
the first operation. Grants have a lifetime call budget; invocations have another
budget. The default minted budget is zero, deliberately deny-by-default.
Revocation is checked at every operation. Both same-runtime reentry and reuse of
an already-active grant across runtimes are rejected.

Policies should restrict the meaning of inputs, not just their types: a perfectly
valid Text can still name a forbidden URL or path. `validate` must synchronously
return exactly true. Arguments are copied before a handler receives them, so
retaining or mutating a Bytes argument does not expose or modify the guest arena.
Returns are checked against the declared scalar ABI.

## Threat model and limits

The intended untrusted side is source/guest code calling explicitly granted
operations. The host, compiler, broker implementation and chosen handlers remain
trusted. The runtime rejects undeclared imports and exposes no ambient filesystem,
network, clock, DOM, raw memory or JavaScript objects. Wasm code cannot obtain a
new grant through this language.

An arbitrary malicious Wasm binary can forge its own ABI metadata and choose
arguments to any operation the host has granted. The broker still bounds granted
calls and applies policies; it does not prove that the binary implements the
source or its JTE certificate. Only grant authority appropriate for the program,
and do not treat an ABI metadata section as a signature or a trust endorsement.
An import supplied manually outside this adapter bypasses this adapter's policy.

A linear token is **not** sufficient protection against a badly chosen handler.
An unrestricted `eval`, `fetch`, arbitrary path opener, or similarly powerful
callback can still misuse its authority in a single authorized call. Trusted host
callbacks may themselves access ambient JS state; this adapter does not sandbox
JavaScript handlers.

Budgets bound host-call count, not CPU time, allocation performed by a handler,
or duration of one call. Wasm computation can run for a long time without making
any imports. Run untrusted compilation/execution in a worker that can be terminated;
the playground does this. An in-thread timer cannot preempt a synchronous kernel.
The adapter is not an audited security sandbox.

AsyncFunction handlers are rejected at grant creation; an ordinary handler that
returns a Promise is rejected after invocation. Work it already started cannot be
undone. Similarly, a later trap or output overflow does not roll back earlier
external effects. There is no retry, transactional guarantee, concurrency support,
or cancellation-safe async lease protocol in this version.

WebAssembly's security model supplies isolation primitives, but host imports are
application-defined authority:
https://webassembly.org/docs/security/
