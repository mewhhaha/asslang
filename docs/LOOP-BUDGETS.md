# Per-invocation loop budgets

## Problem and public contract

Compile-time expansion limits bound staging, not the amount of work a generated
kernel does on runtime inputs. Even finite nested traversals or `iterate` calls
can run for impractically many steps. Host-call allowances do not bound pure
computation. Add an opt-in compiler policy, **`maxLoopIterations`**, which caps
aggregate emitted loop work per invocation of an export.

```js
import { compile } from './src/compiler.mjs';
import { createRuntime } from './src/abi.mjs';

const source = `
  export fn energy = (n:Num) ->
    sum (map (range n) (x -> x*x));
`;
const compiled = compile(source, { maxLoopIterations: 1000 });
const runtime = await createRuntime(compiled);
runtime.call('energy', [10]);   // 285; ten iterations
runtime.call('energy', [1001]); // throws WebAssembly.RuntimeError
runtime.call('energy', [10]);   // 285; independent fresh allowance
```

The option accepts integers from 0 through 2,147,483,647. Omission keeps the
existing unlimited behavior and binary format. Invalid API values throw
`TypeError`, as other invalid compiler options do; they are not source errors.
`compileSources`, `check`, `checkSources`, and compiler-session caches retain the
policy. Checking compiles and validates instrumentation without running a loop.
The CLI accepts `--max-loop-iterations N` for build, check, and run modes, with a
single nonnegative decimal integer in that range. There is no source directive,
new reserved identifier, or per-call override of the compiled ceiling.

## Unit, sharing, and optimization

A unit is one **scalar iteration of an emitted loop**, not an instruction, output
element, accepted filter event, byte, millisecond, or source-level callback.

- Charge one unit after a scalar loop's ordinary exit test and before its body,
  including its predicates, lazy causal initialization, and output stores.
  Rejected filter events and non-emitting transducer events still consume a unit.
- Charge two units before an f64x2 loop processes its pair; scalar remainder
  iterations cost one each. A pair reserves its entire cost before either lane
  executes. Exhaustion need not leave the same partial output prefix as scalar
  lowering; no partial-result contract is introduced.
- All loops in one export share one remaining count: scalar/record reductions,
  reduction cohorts, `fold_until`, `iterate`, stream materialization, SIMD loops,
  and nested traversals. Entering a nested loop does not reset the count.
- Empty loops and inactive branches spend no units. A successful early-exit step
  is charged, but there is no extra charge to discover that the loop has ended.
  A dense `count` that lowers to an extent query has no loop and spends nothing.

Fusion pays for its shared traversal once, not once per constituent reduction.
Memoized reductions pay only when actually forced. Therefore changing optimizer
options can change the minimum allowance, even with equal numeric results.
A limit is deterministic for a given emitted artifact and inputs, not a stable
source-language cost model across compiler versions or lowering configurations.
Existing optimization defaults and floating-point schedules are unchanged.

## Trap, demand, effects, and lifetime

Before an iteration, compare the remaining unsigned count with its cost. Trap
before the body when insufficient; otherwise subtract, without wraparound.
Exhaustion uses Wasm `unreachable`, surfaced by the JS embedding as an ordinary
`WebAssembly.RuntimeError`. This first policy does not distinguish budget traps
from existing guard/bounds traps or invent a source location for a runtime error.
The [Wasm execution specification](https://webassembly.github.io/spec/core/exec/instructions.html#exec-unreachable)
defines this trap instruction; [the security model](https://webassembly.org/docs/security/)
describes the separation of protected locals from linear memory.

Each exported invocation initializes its own private i32 local. It cannot be
refilled by source code, overwritten through linear memory, or adjusted by a
host handler. No global counter, import, callback, guest allocation, or extra ABI
argument is added. Normal and prepared calls reset the allowance on every run,
including after a previous trap. Calling another instance/export is a distinct
invocation, not an application-wide quota.

Existing entry-span checks, stream guards, and eager reduction/iteration initial
values keep their scheduling. They can execute or trap before the first budget
check. Any nested loops they execute still consume the shared allowance. Budget
zero means no loop body, **not no evaluation or no host effects**. Host effects
remain explicitly sequenced, and loops in host arguments consume the same count.
A later budget trap cannot roll back an earlier external effect. Host-call
capability checks and reentrancy rules remain independent.

Normal `createRuntime.call` retains its existing finally-based frame cleanup;
prepared calls retain their input snapshot and clear the output region before
lifting a subsequent result. No partial result is returned after a trap. Raw
ABI users must discard potentially partial output themselves. No lifetime,
borrowing, JTE event-domain, causal-access, or ASABI 1 layout rule changes.

## Representation and observability

Use one private i32 local initialized at export entry when the option is present.
Route every emitted loop header through one helper that places a budget debit
after its termination branch. The same helper counts loop sites, so future
backend loop additions have a single place to preserve this policy. Unmetered
lowering emits the existing header and no counter operations.

`compiled.executionLimits` and an optional `asslang.limits` custom section expose
`{version:1, maxLoopIterations:N, unit:"scalar-loop-iterations"}` for instrumented
artifacts. Unmetered artifacts have neither the property nor that custom section.
Per-function statistics add `loopBudget: {limit:N, sites:M}` when enabled, where
`sites` is the number of instrumented loop headers, not work consumed at runtime.
The existing `asslang.abi` section is unchanged. The limits section is descriptive
metadata, not a verifier for arbitrary third-party Wasm; the policy is enforced
by the generated code, even when instantiated directly from bytes.

The option is included in compiler-session cache keys. The CLI's sidecar and
`--explain` output retain it. There is no runtime state retained between calls,
no ability to resume a trapped computation, and no reported remaining balance.

## Bounds, alternatives, and limitations

The i32 bound permits exact checking and subtraction with existing Wasm
instructions. Instrumentation adds one local, constant-size code per loop site,
and small metadata. Parser, staging, scalar-expansion, binary validation, ABI,
output-capacity, and capability bounds remain intact.

Instrumenting every instruction would require a separate cost model and much
broader emitter changes. An imported metering callback or mutable global could
support a dynamic allowance but would add host/instance state and a new linking
contract. Worker termination is still appropriate for elapsed-time cancellation.
This change chooses a fixed artifact policy with no additional runtime imports.

**This is not a CPU-time limit, complete instruction fuel, memory quota, or
sandbox certification.** One loop body can have substantial straight-line work.
Compilation, instantiation, JS input/output copying, host-handler work, and code
outside these generated loops are not charged. Expensive host callbacks cannot
be interrupted by this counter. A host that recompiles untrusted code without
the option has not enforced the policy. Applications still need trusted compiler
settings, host budgets, memory limits, and independently terminable execution.

## Validation plan

Run the unchanged full suite first. Assert exact budget boundaries for every
emitter loop form, including nested loops, rejected events, shared reductions,
memoized traversals, early exit, SIMD pairs/remainders, and multiple outputs.
Test zero allowance, inactive branches, unchanged primal guards, and large runtime
extents with a tiny allowance without relying on timing thresholds. Compare
successful limited/unlimited results across all eight optimization combinations.

Test reset after success/trap, prepared-call snapshots and stale handles, raw
byte instantiation, one-call capabilities with loops before/after host effects,
entry checks, cache isolation, source-local compilation failures, strict API/CLI
validation, linked sources, and custom metadata. Compare unmetered binaries and
certificates against the baseline and confirm no new imports or memory storage.
Use shared Node/Chromium cases with explicit fixture compiler options. Preserve
the independent reference evaluator and historical evidence. Run the full suite,
focused tests, three example drivers, example build, browser checks, and
`git diff --check`; record actual results and unavailable checks separately.
