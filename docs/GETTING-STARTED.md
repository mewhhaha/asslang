# Getting started

[Documentation](README.md) · [Language tour](LANGUAGE-TOUR.md) · [Category guide](CATEGORY-THEORY.md)

Run commands from the repository root. Node 22 or newer is required; there are no
npm dependencies to install. Chrome/Chromium is needed only for browser tests.
Asslang is a source-checkout prototype, not a published npm package.

## Compile and run a file

Save this as `energy.ass`:

<!-- example: getting-started-energy -->
```ass
export fn energy = (xs: [Num]) ->
  xs |> map (x -> x*x) |> sum;
```

Run it directly, check it without running, or emit a Wasm binary:

```sh
node src/cli.mjs energy.ass --run energy --args '[[1,2,3]]'
node src/cli.mjs energy.ass --check --diagnostics=json
node src/cli.mjs energy.ass -o energy.wasm --max-loop-iterations 10000
```

The run prints `14`. Compilation writes `energy.wasm` and `energy.wasm.json`;
the latter describes the interface and compilation results. `--args` is a JSON
array of **export arguments**: `[[1,2,3]]` passes one stream, not three arguments.
Use `node src/cli.mjs --help` for the full driver contract.

## Call from JavaScript

Save the following as `example.mjs` in the repository root, then run
`node example.mjs`. The same compiler/runtime modules are used by the playground.

<!-- example: getting-started-runtime -->
```js
import { compile } from './src/compiler.mjs';
import { createRuntime } from './src/abi.mjs';

const compiled = compile(`
  export fn smooth = (xs: [Num]) -> (alpha: Num) ->
    scan xs 0 (mean -> x -> mean + alpha * (x - mean));
`);
const runtime = await createRuntime(compiled);
console.log(Array.from(runtime.call('smooth', [[1, 2, 3], 0.5])));
// [0.5, 1.25, 2.125]
```

Returned streams are typed arrays. Numeric records use ordinary JS objects.
Asslang tuples use `{_0: first, _1: second}` at the JS boundary; JS arrays mean
streams, not tuples. Unit `()` is passed as `{}`. See [ASABI 1](ABI.md) for
supported shapes, storage, and raw Wasm calling conventions.

To retain an input snapshot for repeated pure calls, use `runtime.prepare`,
`prepared.run`, and `prepared.dispose`. Only permitted top-level scalar arguments
can be overridden. See [input leases](LEASES.md); this does not export borrowed
JS views or grant host effects.

## Inspect diagnostics without execution

<!-- example: getting-started-diagnostics -->
```js
import { check } from './src/compiler.mjs';

const result = check(`
  export fn invalid = (xs: [Num]) ->
    at (scan xs 0 (s -> x -> s+x)) 2;
`);
console.log(result.ok);                   // false
console.log(result.diagnostics[0].code); // E_CAUSAL_ACCESS
```

A scan depends on preceding state; it cannot be indexed as though it were the
original random-access source. `check` runs through Wasm validation without
instantiating the program. `checkSources` preserves file-local diagnostics in
multi-source builds. See [structured diagnostics](DIAGNOSTICS.md).

## Link helpers explicitly

`compileSources([{name, source}, ...])` compiles named fragments in one checked
namespace. It performs no filesystem imports and does not invent a module
runtime. Generated reconstruction/descent source can be passed as another fragment.
The [category guide](CATEGORY-THEORY.md#share-evidence-between-goals) has a complete
example; [composability](COMPOSABILITY.md) covers source libraries and compiler
sessions. Duplicate definitions are errors, not overrides.

## Playground and tests

```sh
npm run demo
npm test
npm run example:host
npm run example:reducers
npm run test:browser
```

The playground defaults to port 8000 and prints its URL; `PORT` overrides it.
`CHROME_BIN` selects a Chrome/Chromium executable. The browser engine suite does
not establish HTTP module/worker-loading coverage; `npm run test:browser:http`
is a separate check and may be blocked by local browser policy. See the
[validation index](EVIDENCE.md) for revision-specific results and limitations.

## Limits and safety

This is an experimental kernel language, not a finished general-purpose language
or an audited security sandbox. In particular:

- Higher-order functions and dictionaries are staged; functions do not escape
  through the concrete ABI. General recursion and asynchronous effects are not supported.
- A generated kernel has no guest heap allocator, but inputs, materialized outputs,
  JS adapters and compilation still require memory. [Representation](IMPLEMENTATION.md).
- `maxLoopIterations` bounds aggregate emitted loop iterations, not wall time or
  every instruction. Costs can change with lowering options. [Budget contract](LOOP-BUDGETS.md).
- Host calls require explicit capability grants. Effects already performed are
  not rolled back if a later operation traps. [Authority boundary](EFFECTS.md).

Inference, staging, source size and ABI shapes have independent bounds. Numerical
results use floating-point arithmetic; category-inspired validation additionally
requires lawful, map-compatible equality. Neither the type checker nor a graph
certificate proves those application laws. [Proof versus runtime checks](CATEGORY-THEORY.md#what-a-certificate-does-not-prove).

For optimization options and existing unsupported cases, see [ordered SIMD](EXAMPLES-SIMD.md)
and the [example corpus](../examples/README.md). Older validation reports describe
their original revisions; their counts and measurements are not current guarantees.
