# Unsupported feature fixtures

These files intentionally do not compile today. They are registered separately
from executable examples and deliberate safety rejections. Each test asserts the
current diagnostic in all four scalar/SIMD and fused/unfused modes. Unexpected
success fails with a request to promote the example and add executable assertions.
No test is skipped or marked as passing merely because a feature is unfinished.

| Feature / source | Current code | Extension required | Useful current variant |
| --- | --- | --- | --- |
| [General recursion](recursive-functions.ass) | `E_RECURSION` | Runtime call frames, recursion types/termination and stack budgets. | Use iterate with an explicit finite work budget. |
| [Exported runtime closures](escaping-closures.ass) | `E_ABI` | Closure environments, lifetime and a function-reference ABI. | Apply closures inside the kernel; closure-factory.ass stages them away. |
| [Runtime callback parameter](runtime-callback.ass) | `E_ABI` | Typed function references and an explicit host authority boundary. | Pass a static strategy dictionary or declare a capability-backed host call. |
| [Guest array construction](array-literals.ass) | `E_PARSE` | Literal syntax plus fixed-size products or materialization/lifetime rules. | Use tuples for fixed-size products or a mapped range for numeric output. |
| [Text construction](text-concatenation.ass) | `E_TYPE` | An output text builder with capacity and encoding rules. | Return text fields separately and concatenate in the host. |
| [Exported stream of records](record-streams.ass) | `E_ABI` | Versioned record-stream layout and materialization support. | Return a record of scalar streams (structure of arrays). |
| [Growable mutable arrays](mutable-buffer.ass) | `E_NAME` | Ownership, capacity, bounds and allocation effects. | Use fixed scalar state or host-owned input/output arenas. |
| [Sorting an input stream](sort.ass) | `E_NAME` | Bounded random-write storage and a sorting primitive or library. | Sort in the host before calling a kernel. |
| [Runtime-keyed grouping](group-by.ass) | `E_NAME` | Dynamic keys, equality/hash rules and bounded dictionary storage. | Use histogram-three-bins.ass for a fixed known key set. |
| [One-to-many stream expansion](flat-map.ass) | `E_NAME` | Nested cursor scheduling, output capacity and event-provenance rules. | Use transduce for zero-or-one output per input or scalar nested reductions. |
| [Zip independently filtered streams](independent-sparse-zip.ass) | `E_DENSE` | Two-cursor sparse traversal and explicit length/domain policy. | Share one filter for static zip, or materialize both streams in the host. |
| [Asynchronous host computation](async-await.ass) | `E_NAME` | Suspension/resumption, cancellation and capability lifetime rules. | Await I/O in JavaScript and pass resolved values to a pure kernel. |
| [Regular-expression text search](regular-expressions.ass) | `E_NAME` | A bounded regex engine and Unicode/encoding semantics. | Classify ASCII bytes in a transducer, or use a host regex engine. |
| [Runtime module loading](dynamic-modules.ass) | `E_NAME` | Module resolution, permissions, linking and resource limits. | Use compileSources with an explicit finite list of source fragments. |
| [Selection between stateful stream plans](stateful-branch.ass) | `E_STATE_BRANCH` | Branch-specific causal frames and checked clocks. | Choose the source before scan, or branch inside its transition. |
| [Arbitrary-precision integers](big-integers.ass) | `E_NAME` | A distinct integer type, bounded storage and arithmetic costs. | Num is f64; use host big integers when exact large values are required. |
| [Recovering from a failed computation](recoverable-exceptions.ass) | `E_NAME` | Typed recoverable errors and demand-preserving handlers. | Use result-validation.ass for explicit result records; require traps are not caught. |
| [Public SIMD lane manipulation](explicit-lane-shuffle.ass) | `E_NAME` | First-class vector types, lane immediates and scalar fallback semantics. | Enable simd:true for supported ordinary numeric maps and sums. |

The source uses canonical syntax when the proposed feature can be expressed that
way. Array literals intentionally demonstrate missing syntax. Unknown builtins
are feature sketches, not reserved names or accepted APIs. Diagnostic codes do
not promise the eventual design will use these names.

Run `node --test test/expanded-corpus.test.mjs`. Independent sparse pairing,
stateful branch selection and runtime callbacks need real scheduling/ABI designs;
these examples are not permission to bypass provenance, capability or memory
checks. Native lane shuffles are distinct from the implemented automatic f64x2
backend for ordinary maps and ordered sums.
