# Asslang — Jacob Torrang encoding, prototype 0

A small experimental functional kernel language compiling directly to WebAssembly.
The initial use case is numerical/data-processing work inside Chrome: pure pipelines,
borrowed input spans, scalar outputs, and no intermediate collection allocations.

**This is an executable research prototype, not a finished general-purpose language.**
The compiler is ordinary JavaScript. The generated kernels have no heap allocator,
reference counting, tracing collector, WasmGC objects, or runtime closure objects.
That does not make the compiler, JavaScript host, or Chrome itself GC-free.

## Try it

Node 22 or newer; no npm packages or build-tool installation required:

```sh
npm test
npm run test:browser       # installed Chrome/Chromium; CHROME_BIN can override
npm run bench
npm run build:example
npm run demo              # open the printed local address in Chrome
```

`npm run test:browser` runs compiler/Wasm engine tests in an in-memory test bundle.
`npm run test:browser:http` additionally tests HTTP module loading and the playground
worker. The latter could not be validated in the implementation environment because
Chrome's administrator policy blocks local HTTP navigation. No browser policies are
changed by the harness. The default engine suite was actually run in Chromium
144.0.7559.96; see [validation](docs/VALIDATION.md).

## A program

```text
fn square(x) = x * x;

export fn energy(samples) =
  samples |> map(square) |> sum;
```

The inferred type of `energy` is `([Num]) -> Num`. `[Num]` means a numeric stream;
it does not contain a type-level length. Here the stream is an externally supplied
span. There are no allocated list cells, iterator objects, closures, or mapped arrays
in the generated kernel.

The main experiment is an additional relational typing layer:

```text
export fn score(samples) = {
  let selected = samples |> filter(x => x > 0);
  let weighted = selected |> map(x => x * 2);
  let shifted = selected |> map(x => x + 1);
  zip(weighted, shifted, (a, b) => a * b) |> sum
};
```

JTE records that `weighted` and `shifted` describe the **same ordered iteration
events**, inherited from `selected`. The program lowers to one loop with one
filter decision and no runtime zip alignment check. Equal lengths alone would not
establish this relationship.

For independent sources, positional pairing must be explicit:

```text
export fn dot(xs, ys) =
  zip_checked(xs, ys, (x, y) => x * y) |> sum;
```

`zip_checked` checks the runtime extents before iteration, traps on mismatch, and
introduces a new positional domain. It does not claim the original inputs share
provenance. This first implementation accepts dense inputs only for checked zip.
Independently filtered streams need a future two-cursor implementation.

## Browser / JavaScript API

```js
import { compile, instantiate } from './src/compiler.mjs';

const compiled = compile(`
  export fn energy(samples) = samples |> map(x => x*x) |> sum;
`);
const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
new Float64Array(memory.buffer, 0, 4).set([1, 2, 3, 4]);

const instance = await instantiate(compiled, { memory });
console.log(instance.exports.energy(0, 4)); // 30: byte offset, element count
console.log(compiled.signatures);
console.log(compiled.certificate);
console.log(compiled.stats);
```

All span arguments are flattened into `(i32 byteOffset, i32 length)`. Memory belongs
to the caller. Alignment and memory containment are checked using overflow-safe
64-bit arithmetic before any input reads. Inputs are read-only during the call.
Shared memories are rejected; the generated code neither writes nor grows memory.
The host remains responsible for granting the intended spans and for its own memory
budget. One memory page in this example is 65,536 bytes; it is not a mandatory heap
size imposed by Asslang. A range-only module needs no linear memory at all.

For an output file and ABI sidecar:

```sh
node src/cli.mjs examples/cohort.ass -o /tmp/cohort.wasm --explain
node src/cli.mjs examples/rejected.ass --check  # intentionally fails with E_DOMAIN
```

## Language slice

`Num` is an IEEE-754 `f64`; `Bool` uses a canonical `i32` 0/1 ABI. Functions,
lexically captured lambdas, ordinary let-polymorphism, forward function references,
scalar conditionals, arithmetic, numeric comparisons, and Boolean logic are
implemented. `|>` inserts its left-hand side as the first argument.

The builtins are `range`, `map`, `filter`, `zip`, `zip_checked`, `sum`, `count`,
`fold`, `sqrt`, `abs`, `min`, and `max`. Fold is left-to-right. There is no fast-math
reassociation. Range lengths must be finite integral values from 0 through
2,147,483,647; invalid demanded extents trap, rather than silently truncate.

Types are inferred. Optional parameter/return annotations are useful at the ABI
boundary when operations do not determine a representation:

```text
fn identity(x) = x;
export fn length(xs: [Num]): Num = count(xs);
export fn number_identity(x: Num) = identity(x);
```

Exported parameters must resolve to `Num`, `Bool`, or `[Num]`; exported results
must be `Num` or `Bool`. Internal helpers may be polymorphic and higher-order,
but are staged away. Recursion, escaping closures/streams, records, variants,
user-defined effects, generic runtime ABIs, and materialized outputs are not yet
implemented.

### Evaluation is a pure demand graph, not strict ML evaluation

Bindings name computations. Only demanded scalar values execute. A stream is a
staged description, not a heap of runtime thunks. Thus `count(map(xs, f))` does not
evaluate `f`, while a filter still evaluates the predicate needed to determine its
emitted events. Dead bindings do not execute, and scalar branches short-circuit.
All source expressions are still statically typechecked. This is intentional and
must be reconsidered explicitly before adding effects; it is not claimed to
preserve arbitrary strict-language evaluation order.

## Experimental reduction cohorts (opt-in)

The JTE domain can also identify multiple observations that may share a traversal.
For example, RMS needs a sum and a count, but need not traverse the input twice:

```js
const compiled = compile(`
  export fn rms(samples) = sqrt(sum(map(samples,x=>x*x)) / count(samples));
`, { experimentalReductionFusion: true });
console.log(compiled.stats.functions[0].loops); // 1 (default: 2)
console.log(compiled.stats.functions[0].reductionFusion);
```

```sh
node src/cli.mjs examples/rms.ass --experimental-reduction-fusion --check --explain
npm run bench:fusion
```

This experiment only groups co-demanded, independent reductions with the same
certified domain and identical iteration schedules. Accumulators remain separate
and left-to-right; inactive branches and ignored mapped values stay undemanded.
Independent filters and nested/dependent reductions retain the baseline lowering.
It is **disabled by default**, with no new syntax or ABI. See the
[design, limitations and validation](docs/REDUCTION-FUSION.md) and
[paired benchmark measurements](docs/fusion-measurements.json).

## Architecture and limits

`frontend.mjs` provides parsing and conventional HM-style inference. `jte.mjs`
stages pure functions into scalar DAGs and stream plans, and checks a separate
observation certificate. `wasm.mjs` emits binary Wasm directly. The certificate
is returned as a sidecar, not embedded in the Wasm binary. There is no LLVM,
WAT-to-Wasm tool, external optimizer, or runtime library in the build path.

A compatible pipeline is lowered directly into a loop rather than constructed
as arrays and optimized afterward. By default, separate reductions may repeat
traversal. The opt-in reduction-cohort experiment below fuses eligible reductions;
there is still no materialization strategy. Staging may increase code size. There is an explicit expansion limit, not an inference timeout.
There is no per-definition incremental compilation/cache or general lifetime
inference yet. Ordinary type inference and staging have no claimed linear-time
worst-case bound.

The name **Jacob Torrang encoding** designates this project's observation-certificate
experiment. It is not a claim that stream fusion, provenance, staged compilation,
or conventional type inference were invented here. Neither global novelty nor
formal end-to-end compiler correctness is established. See the [design and research
hypotheses](docs/JTE.md), [related work](docs/RELATED-WORK.md), and
[reproducible measurements](docs/measurements.json).
