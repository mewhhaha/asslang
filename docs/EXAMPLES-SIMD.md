# Examples, extensibility, and ordered SIMD

## Problem and scope

The corpus must distinguish executable language patterns, deliberately rejected
unsafe programs, unsupported feature requests, and programs with known cost
pathologies. An aspirational example is useful evidence only when it says what
would be required to implement it and a test checks its current diagnostic. App
examples should compose several operations behind a concrete ABI and have an
independent expected answer, not merely rename a scalar arithmetic expression.

This change implements a larger canonical-syntax corpus, a small ordinary-source
pattern library, app-like case studies with a runnable host driver, ordered
WebAssembly SIMD, and default demand-scoped reduction fusion. It does not propose
a guest heap, a new ABI, implicit I/O, arbitrary recursion, or dynamic dispatch.

## Corpus contracts

* `corpus` contains runnable exports with deterministic arguments and answers.
  Every accepted export and `.ass` file is registered. Pattern examples name the
  inspiration without claiming full compatibility with another language.
* `unsupportedCorpus` contains executable *checks*, not executable applications:
  a source path, feature, current diagnostic, and implementation/alternative
  notes. Unexpected success fails the test so newly supported programs must be
  promoted and supplied with runtime assertions. These differ from `rejected/`,
  whose programs violate an intentional safety rule.
* `pathological/` retains genuinely unaddressed algorithmic or staging costs.
  Former pathologies move only with an explicit explanation and structural tests.
  Historical benchmark reports are not edited to imply new measurements.
* Case studies use explicit source linking. Filesystem access, JSON parsing,
  network access, scheduling, and persistence stay in the host. Kernels expose
  typed values, streams, records, and explicit host capabilities where relevant.

The reference interpreter must understand canonical partial application, unit,
curried callbacks, and explicit host-call saturation. It remains a separate,
allocation-heavy value oracle, not a proof of demand behavior. Wasm regression
tests separately cover branch demand, traps, boundaries, and causal scheduling.

## Default reduction cohorts

The existing demand-scoped fusion pass becomes the default in this prototype.
`reductionFusion: false` restores independent traversal. The legacy
`experimentalReductionFusion` option remains an alias; contradictory values are
API errors. CLI `--no-reduction-fusion` disables the default, while the old enable
flag remains accepted. Cache identity includes the resolved setting.

The algorithm and its restrictions remain those in REDUCTION-FUSION.md: identical
checked domains are necessary but insufficient; extents, masks, cursor identities,
guards, and ordered machine identities must also match. Independent state machines
are not merged merely because their shapes look alike. Recurrences keep their
left-to-right f64 order. Completed/lazily memoized results, conditional demand,
short-circuit folds, nested reductions, and host calls remain boundaries. A trap
can occur after different amounts of pure work; successful results and explicit
effect order must not change. There is no register-pressure profitability model.

This addresses default multi-reduction and shared-scan replay, alongside already
fixed demand-scoped shared-reduction memoization. Repeated prefix queries remain
quadratic and expanding function composition still meets the staging budget.

## SIMD semantics and eligibility

`simd: true` / CLI `--simd` opts into portable WebAssembly 128-bit SIMD; scalar
emission remains the default. The initial backend uses **f64x2**, preserving the
language's f64 `Num`, not silently narrowing to f32. No vector types cross ASABI 1.

A conservative whitelist admits dense stateless numeric maps: direct current-
cursor f64 loads from validated input spans, scalar numeric parameters/constants,
and lane-wise `+`, `-`, `*`, `/`, negation, absolute value, square root, floor,
minimum, and maximum. Guarded/random access, predicates, filtering, scans,
transducers, host calls, nested reductions, and arbitrary invariant computations
fall back to scalar lowering. Unsupported shapes are not compilation errors.

Eligible materialized maps compute/store two values per iteration and run a
scalar tail. Eligible additive reductions compute two input values together, then
add lane 0 and lane 1 to the same scalar accumulator in source order. They do NOT
use independent vector accumulators or reassociate sums. This deliberately trades
some throughput for cancellation, infinity, signed-zero, and demand compatibility.
NaN payload bits are not promised by the language or this optimization. No FMA or
relaxed SIMD instruction is introduced. Fusion has precedence over vectorization
for a multi-sink cohort; a cohort may remain scalar even with SIMD enabled.

Vector loops run only while at least two input elements remain. A v128 memory
operation uses an 8-byte alignment hint, since ASABI requires 8-byte, not 16-byte,
alignment for Num. Output capacity is checked before each pair store. There is no
out-of-span speculative load or intermediate buffer. Scalar tails use an
independent compiler cache context so locals computed only inside the vector loop
cannot appear initialized in a zero-pair path. Empty streams do not demand map
values. SIMD instructions and vectorized-loop counts are reported structurally.

SIMD requires an engine supporting the emitted Wasm instructions. The compiler
still validates its complete binary before returning it. Users targeting engines
without SIMD compile with `simd: false`; no speedup or universal availability is
claimed. `supportsSIMD()` is exported for host option selection. When emitted vector
loops require an unavailable target feature, compilation reports `E_TARGET`
with scalar-compilation guidance instead of labeling the failure a compiler bug.

## Extensibility without new runtime machinery

Ordinary curried functions and structural dictionaries can encode option/result
records, predicate composition, reader/configuration injection, lenses, reducers,
and state transitions. These are explicitly bounded variants of constructs from
other languages, not nominal enums, type classes, algebraic effects, or a module
loader. Numeric tags require caller discipline; typed sums would be a separate
language feature. Records containing functions must remain statically staged.

Unsupported examples should cover recursion, escaping closures, runtime function
arguments, runtime-sized record streams, growable state, text construction,
independent sparse joins, seeking causal histories, asynchronous effects, and
other genuinely absent mechanisms. Each entry documents a useful current variant
or the necessary runtime/type-system extension, without weakening safety checks.

## Validation strategy

Run the complete Node suite and both existing interop drivers on Node 22+, plus
the new case-study runner. Test scalar/SIMD crossed with fused/unfused lowering;
verify Wasm validation, ABI equality, certificate validity, vector instructions,
empty/singleton/odd inputs, f64 edge cases, unaligned-to-16 spans, exact output
capacity, raw memory boundary traps, and non-vectorizable demand boundaries.
Check option validation, compiler-cache separation, CLI flags, and linked source
locations. Check unsupported diagnostics and full registration. Run browser checks
when Chrome is available, recording unavailable checks explicitly. Structural
loop-count assertions, not timing thresholds, justify pathology promotion. Final
executed results and limitations belong in EXAMPLES-SIMD-VALIDATION.md.

## Executed evidence

See [EXAMPLES-SIMD-VALIDATION.md](EXAMPLES-SIMD-VALIDATION.md) for executed checks,
corpus counts, pathology promotions, browser scope and remaining limitations.
The initial theory was committed before implementation; this document now
describes the implemented scope, not the entire unsupported-feature roadmap.
