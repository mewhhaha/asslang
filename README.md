# Asslang

A small functional language that compiles to WebAssembly. Write stream pipelines,
numerical functions, and reusable abstractions; the compiler infers types and
stages functions and dictionaries into kernels rather than runtime closures.

[Get started](docs/GETTING-STARTED.md) · [Language tour](docs/LANGUAGE-TOUR.md) ·
[Category theory in practice](docs/CATEGORY-THEORY.md) · [Practical workflows](docs/CASE-STUDIES.md) · [All docs](docs/README.md)

## Run a kernel

Use **Node 22+**. No npm dependencies or separate Wasm toolchain are needed.

```sh
git clone https://github.com/mewhhaha/asslang.git
cd asslang
```

Save this as `demo.mjs` in the repository root, then run `node demo.mjs`:

<!-- example: readme-runtime -->
```js
import { compile } from './src/compiler.mjs';
import { createRuntime } from './src/abi.mjs';

const kernel = compile(`
  export fn energy = (xs: [Num]) ->
    xs |> map (x -> x*x) |> sum;
`, { maxLoopIterations: 10_000 });

const runtime = await createRuntime(kernel);
console.log(runtime.call('energy', [[1, 2, 3]])); // 14
```

The optional loop budget limits aggregate emitted loop iterations per call,
not elapsed time. See [execution limits](docs/LOOP-BUDGETS.md).

## Small programs, useful results

Accumulate a stream, or differentiate a function of a record:

<!-- example: readme-language -->
```ass
export fn prefixes = (xs: [Num]) ->
  scan xs 0 (total -> x -> total + x);

export fn gradient = (point: {x: Num, y: Num}) ->
  grad (p -> p.x*p.x + p.y*p.y) point;
```

Call `prefixes` with `[1,2,3]` to get `[1,3,6]`, or `gradient` with `{x:3,y:4}`
to get `{x:6,y:8}` (JS values).
Functions use `x -> body`; `f x y` applies one argument at a time.
[More examples and calling conventions →](docs/LANGUAGE-TOUR.md)

## Category theory you can run

Reconstruct missing observations, join coherent partial records, or share evidence
across several equality goals. These are explicit build-time plans with checkable
certificates and ordinary generated Asslang—not implicit assumptions about data.

```sh
npm run example:descent-batch
npm run example:evidence-residual
```

The first example shares proof work; the second explores what extra evidence a
caller must provide under alternative guarantees. [Start with the guide →](docs/CATEGORY-THEORY.md)

## Develop

```sh
npm test
npm run demo
```

The playground prints its local address. Browser tests require Chrome/Chromium.
See [contributing rules](AGENTS.md), [architecture](docs/IMPLEMENTATION.md), and
[validation reports](docs/EVIDENCE.md).

**Experimental kernel-language prototype, not a general-purpose language or an
audited sandbox.** No guest heap allocator is added, but input/output storage and
the JS compiler/runtime still use memory. [Limits and safety boundaries →](docs/GETTING-STARTED.md#limits-and-safety)
