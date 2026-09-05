# Validation of prototype 0

Executed on 2026-09-05 in the implementation container.

## Tests actually run

`npm test`: **34 passed, 0 failed**. One test runs **250 seeded differential
program/input cases** against a separate allocation-heavy AST reference evaluator.
The reference shares the parser, but not JTE staging or Wasm code generation.

Other coverage includes ordinary type failures and the occurs check; recursion
rejection; optional ABI annotations; polymorphic helpers; invalid provenance
composition; new-domain behavior after checked zip; nested zip guards; nested
reductions/captures; non-strict demand semantics; IEEE-754 edge cases; malformed
input diagnostics; certificate tampering; and deterministic binaries.

Memory tests exercise alignment, negative/overflowing lengths, span containment,
empty zero-page spans, rejection of shared memories, input immutability, and
unchanged memory size over repeated kernel calls. They do not measure all browser
or compiler allocations.

`npm run test:browser`: **108 checks passed** in **Chromium 144.0.7559.96**, including
100 seeded differential cases, direct compiler execution in the browser engine,
Wasm validation/instantiation/execution, borrowed input spans, mismatched-length
traps, span-bound traps, and the no-memory-import range case.

The engine suite uses a fixed in-memory test bundle and DevTools' anonymous pipe.
Chrome's administrator policy blocked local HTTP navigation in this environment.
Therefore the HTTP ES-module loading and playground worker-loading path were
**not validated end-to-end here**. `npm run test:browser:http` provides that
additional test for an environment where local navigation is allowed. No browser
administrator policies were modified.

## Measurements

See `measurements.json` and rerun `npm run bench`. The recorded environment was
Node v22.16.0, Linux x64, an AMD EPYC 9V74 virtualized/container environment.
There were 30 warmup compilations and 200 measured compilations per case.

| Program | Wasm bytes | Warm compile p50 | Warm compile p95 |
| --- | ---: | ---: | ---: |
| Scalar arithmetic | 69 | 0.059 ms | 0.154 ms |
| Shared filtered cohort | 250 | 0.218 ms | 0.477 ms |
| 100 chained maps | 1,072 | 0.582 ms | 1.122 ms |

Compile timing includes parsing, ordinary inference, JTE staging/certificate
checking, direct binary emission, and `WebAssembly.validate`. It excludes V8
machine-code compilation, program execution, filesystem IO, and process startup.
Ten fresh Node processes checking the cohort source had p50 **34.50 ms** and p95
**46.11 ms**, including process startup and file reads but no output writes.

The cohort binary has one loop, no runtime zip-length check, 11 logical Wasm
locals, and no intermediate buffers. Its locals carry 80 bytes of logical scalar
payload. That last number is NOT a measurement of V8's actual register/stack
allocation, total working set, or resident memory. Caller input memory and host
objects are additional. These are single-environment microbenchmarks, not a
performance guarantee or comparison with another language.
