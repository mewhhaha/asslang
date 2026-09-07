# Finite callable choices: branch-specialized higher-order kernels

## Problem and experiment

Ordinary closures and partial applications already stage away, but a runtime
condition cannot select between two known functions. This prevents data-dependent
strategy dictionaries and transition policies even when the complete set of code
bodies is known. The experiment extends that finite staging domain, not the guest
heap or ASABI. Defunctionalization and specialization are established techniques;
the new integration here is with Asslang's demand graph and causal transitions.

## Semantics and invariants

`if condition then f else g` may produce a function when both branches have the
same inferred arrow type. Calling the choice distributes application into the two
known branches, then selects their results. The same rule applies to partially
applied builtins, curried helpers, and function fields in records. Lexical captures
remain separate. A result that is again a function retains a finite choice until
its eventual application. No function crosses an export boundary.

`require condition f` is a guarded callable: its guard is attached to the result
of application, including further function results. Pure demand is unchanged: an
unused function or an unused result does not check the guard, and an inactive
branch does not execute the other function's trapping scalar work. A required
scalar result checks the guard before evaluating its selected value.

Type inference still checks every branch. Dynamic host callbacks, implicit host
calls, escaping closures, and recursive definitions remain rejected. Choosing a
function that returns a stateful stream remains subject to `E_STATE_BRANCH`;
select the scalar transition function instead. Choice is not permission to fuse
different event histories or discard checked-zip obligations.

## Representation and alternatives

The staging value domain gains `callable_choice` (condition, yes, no) and
`guarded_callable` (condition, callable). Applying these nodes invokes existing
staging and existing scalar/record/stream choice or guard lowering. All such
nodes must disappear before scalar Wasm emission. No indirect call, function
table, tag buffer, closure object, or ABI version is introduced.

An explicit sum type with closure environments would support escaping functions,
but requires new runtime representation and lifetime rules. Speculatively
executing both branches is unacceptable because of guards and causal demand.
Rejecting all choices remains safe but needlessly limits finite higher-order
programs. This experiment chooses branch specialization and its code-size cost.

## Compatibility and resource bounds

Previously accepted programs retain their representation. Previously rejected
finite pure choices become accepted. Branch specialization can expand
exponentially under repeated higher-order application; every distributed invoke
is charged to the existing `maxExpansion` budget. The compiler's nesting limit
and `E_LIMIT` conversion remain active. This is not an unrestricted dynamic
function language and no throughput improvement is claimed.

## Browser evidence transport

The baseline main run `34026701816` passed 445 Node tests and all example drivers,
but timed out in `Target.createTarget` before browser checks. Browser startup and
engine evaluation need separate deadlines. The harness will allow 60 seconds for
startup/evaluation (still bounded) and retain the 10-second control-operation
limit. This does not change browser sandbox or administrator policies and is not
evidence that every startup failure is a timeout issue.

## Validation plan

Add shared Node/Chromium execution cases for both choices, partial application,
record dictionaries, nested returned functions, lexical capture, guarded
callables, and transition policies. Add regression tests for inactive traps,
empty streams, strict transitions, source-local type errors, forbidden host and
ABI escape, and bounded specialization. Compare seeded cases with independent
JavaScript under scalar/SIMD and fusion/memoization settings. Register a runnable
strategy example. Run full Node tests, host/reducer/case-study examples and the
Chromium engine suite. Preserve all historical evidence. Record actual outcomes
below before submission.

## Executed validation

Executed 2026-09-07 with Node v22.16.0 and the installed Chromium engine:

- `npm test`: 468 tests passed, zero failures (baseline 445).
- `npm run example:host`, `npm run example:reducers`, and
  `npm run example:case-studies`: all exited successfully.
- `npm run test:browser -- --output <report>`: PASS, including the eight added
  shared callable cases and the registered strategy example. HTTP module loading
  and playground worker loading were not exercised by this engine-only run.
- The new deterministic demand test performs 128 inputs in each of eight
  SIMD/fusion/memoization configurations. The 1,024 results or expected traps
  matched independent JavaScript; no throughput benchmark was run.

The implementation adds only staging values and delegates all runtime selection
to the existing lowering. State-stream choice, host authority, and ASABI escape
rejections remain intentional limits, not silently unsupported runtime paths.
