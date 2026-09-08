# Static record symbols: executed validation

## Scope and provenance

Executed on 2026-09-09 (Europe/Vienna; execution logs dated 2026-09-08 UTC),
using Node v22.16.0, Linux x86-64, and Chromium 144.0.7559.96. The baseline is
merged main commit `0097d229dc2749e4d40da2a4c0fede7776896854`, after PR #12,
with tree `9481fe41bf2aaf2b2c806cceeea4fd575052eab6`.

The source snapshot came from that commit's retained GitHub Actions validation
artifact. Its complete local Git tree matched upstream before editing.
[RECORD-SYMBOLS.md](RECORD-SYMBOLS.md) and its index entry were committed before
implementation or tests. Earlier validation and benchmark evidence is unchanged.

## Implemented contract

Top-level `symbol name;` declarations define static record keys in a separate
namespace. Construction, selection, canonical record patterns, and annotations
support `[name]`. Legacy construction/selection/annotations use the same keys.
Declarations resolve across the entire explicitly linked unit, independent of
file order. Duplicate declarations and unknown/computed keys are errors.

Keys lower to a disjoint compiler-only field namespace in existing records and
row types. No new staging value, backend instruction, runtime symbol, property
table, protocol registry, or guest closure is introduced. Symbol entries require
explicit values and pattern binders; dot access remains ordinary-field access.
Inferred signatures display `[name]`, not the implementation encoding.

Every ABI record boundary rejects symbol fields, including nested records and
host signatures. Users project ordinary data explicitly rather than silently
losing fields. ASABI 1 layouts and input/result lifetime rules are unchanged.
The design explains compiler metadata, scalar payloads, staged functions, span
lifetimes, and prepared-call snapshots separately. Symbols are neither ownership
tokens nor private-module keys and provide no automatic destructor or hook.

## Executed checks

| Command | Actual result |
| --- | --- |
| Unchanged baseline `npm test` | 736 passed, zero failures or skips |
| Existing suite after implementation, before new tests | 736 passed |
| Final `npm test` | 783 passed, zero failures or skips |
| `npm run test:record-symbols` | 145 passed, zero failures or skips |
| `npm run example:host` | Passed; one-call capability exhausted as expected |
| `npm run example:reducers` | Passed |
| `npm run example:case-studies` | All 12 scalar/SIMD executions passed |
| `npm run build:example` | Passed |
| Chromium engine suite | PASS: 1,096 core plus 236 experimental checks |
| `git diff --check` | Passed |

This adds 47 Node tests: 27 dedicated tests and 20 shared engine cases. The new
shared cases execute in both engines with all three optimization switches off
and all three on, adding 40 Chromium checks. Deeper execution tests cover all
eight SIMD/reduction-fusion/reduction-memoization combinations. The retained
browser report is [record-symbols-browser-tests.json](record-symbols-browser-tests.json).

## Memory, abstraction, and compatibility evidence

In all eight configurations, a symbol-keyed quadratic protocol and direct scalar
code produce byte-identical Wasm binaries. The symbol implementation has no
memory import or imported functions/tables, and 800 numeric executions match an
independent JavaScript expression. This is stronger evidence for these fixtures
than relying on the compiler's currently fixed zero-allocation statistic alone.
It is not a proof of zero compiler/host allocation or a performance benchmark.

The reducer example is extracted directly from the design document. Its binary
and JTE certificate are identical to an explicit fold in
every configuration; scalar lowering has one loop, while eligible SIMD lowering
also has its scalar remainder loop. Results match hand-computed expectations for
empty and nonempty streams. No runtime dictionary or symbol metadata appears in
these binaries. No `.ass` corpus file or independent reference evaluator changed.

An independent baseline comparison covers all 98 pre-existing shared AD cases
in two configurations. It found 156 byte-identical accepted binaries, equal
certificates and signatures, and 40 matching rejection codes/offsets. See
[record-symbols-compatibility.json](record-symbols-compatibility.json). This is
compatibility evidence for that corpus, not universal equivalence of all programs.

Prepared-call tests wrap numeric streams, Bytes, Text, and a method in symbol
fields. Mutating the original arrays does not change the pinned snapshot;
mutating a returned result does not affect a later result. Scalar overrides work,
results remain valid after disposal, stale handles fail, and a live lease still
blocks competing calls. These eight executions verify that wrappers do not
extend guest span lifetimes or expose mutable borrowed JS views.

## Type, demand, and integration coverage

Positive cases cover distinct ordinary/symbol fields, forward declarations,
separate value/key namespaces, nested patterns and annotations, chained selectors,
qualified pipes, polymorphic row helpers, finite selected dictionaries, and linked
legacy helpers. Unknown keys in unused helpers or annotations still fail checking.

Negative cases reject ordinary-field and different-symbol lookalikes, computed
keys, duplicate declarations/entries/binders, symbol puns, assignment syntax,
implicit host invocation, indirect `perform`, and symbol-keyed ABI inputs/outputs/
host signatures, including nested and empty payloads. Source-local failures
agree between `checkSources` and `compileSources`, and diagnostics do not expose
the compiler's private field encoding.

Demand tests distinguish unused guarded fields from demanded values/methods,
including guarded records and inactive callable alternatives. A symbol named
`dispose` causes no implicit execution. Wrapped streams retain event provenance
and scan seekability restrictions; independent or separately filtered streams do
not become aligned. Symbol-keyed numeric recurrence state uses two scalar state
slots without a new intermediate buffer, and empty streams avoid initialization
and callback traps.

Numeric symbol products compose with gradients, saved forward/reverse callables,
and Hessian-vector products while preserving internal key shapes. Every public
result is explicitly projected. Eight one-call-capability executions wrap and
reuse performed host values, yet each consumes exactly one allowance; effectful
exports still reject prepared calls and missing grants.

Resource tests accept 256 declarations, reject 257 at the offending declaration,
charge symbol uses against the 50,000-node syntax limit, and retain delimiter
nesting limits. Source composition and compiler sessions preserve key resolution
without cross-compilation registry leakage or mutable snapshot contamination.

## Limitations

These are executed local checks, not a statement that this PR's remote CI passed.
Remote GitHub Actions must be checked separately. HTTP module loading, playground
worker loading, other browser engines, and throughput benchmarks were not run.

Symbols are static, top-level, compilation-local declarations, not generative
runtime values. Linked source fragments share one key namespace, so libraries
must coordinate names. There is no private module boundary, dynamic key dispatch,
trait coherence checker, implicit protocol hook, ownership/borrow type system,
new allocator, or automatic cleanup mechanism. Existing guest memory and host
capability contracts remain the authority and lifetime boundaries.
