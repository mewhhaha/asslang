> **Integration update:** reduction cohorts from PR #1 are reconciled with causal
> machines. Enable `experimentalReductionFusion: true`, the CLI flag
> `--experimental-reduction-fusion`, or the playground checkbox. Default compilation
> is unchanged. See [integration validation](docs/INTEGRATION.md).

# Asslang 0.2 — causal streams and composable scalar machines

An experimental functional language compiling directly to WebAssembly for Chrome.
Types and record rows are inferred; the Jacob Torrang encoding (JTE) additionally
checks event alignment and legal access to particular streams. Stateful pipelines
lower to loops and scalar locals rather than runtime iterator/closure objects.

**This is a tested kernel-language prototype, not a finished general-purpose
language, audited sandbox, or claim of worldwide novelty.** Generated kernels have
no guest heap allocator or collector. Inputs, materialized outputs, the compiler,
JS adapter and browser still occupy memory; JS objects still use managed storage.

## Run

Node 22 or newer, with no npm dependencies or separate Wasm toolchain:

```sh
npm test
npm run test:causal
npm run test:browser
npm run example:host
npm run bench -- --output /tmp/asslang-node.json
npm run bench:browser -- --output /tmp/asslang-chrome.json
npm run demo
```

The browser commands require installed Chrome/Chromium; `CHROME_BIN` can override
its path. The engine suite uses an in-memory bundle. The additional HTTP module
and playground-worker test (`npm run test:browser:http`) is blocked by the test
environment's browser policy and remains unvalidated end-to-end. See
[validation and measurements](docs/VALIDATION.md).

## Express recurrence, not mutable machinery

```text
export fn prefixes(xs: [Num]) =
  xs |> scan(0, (total, x) => total + x);

export fn fibonacci_history(n) =
  range(n)
  |> scan({ a: 0, b: 1 }, (s, x) => { a: s.b, b: s.a + s.b })
  |> map(s => s.a);
```

`scan` emits the new state at each input event. Record fields update simultaneously
from the old state. Both examples use one loop and fixed scalar state, not arrays
of intermediate state records. No type-level length is required.

`transduce` additionally chooses whether to emit:

```text
export fn deltas(xs: [Num]) =
  xs |> transduce({ seen: false, previous: 0 }, (s, x) => {
    state: { seen: true, previous: x },
    emit: s.seen,
    value: x - s.previous
  });
```

Machines can be ordinary inferred records of `initial` and `step`. The
[composition example](examples/concepts/machine_composition.ass) defines `connect`
in Asslang, then writes:

```text
run(xs, connect(connect(distinct(), difference()), integrate()))
```

The resulting export has one loop and five recurrence scalars. The records,
functions and captured environments are staged away. Their names are library
functions in that example, not extra compiler keywords.

## A dense stream is not necessarily seekable

A source is dense and indexable. A scan stays dense and preserves its source's
event domain, but is sequential: its values depend on previous transitions.

```text
let history = scan(xs, 0, (total, x) => total + x);
zip(xs, history, (x, total) => x + total)
```

This alignment is inferred and uses one cursor without a zip-length check.
`at(history, 4)` is instead rejected with `E_CAUSAL_ACCESS`; it does not silently
replay the prefix. Independent selection operations get fresh domains.
`zip_checked` explicitly pairs independent dense inputs after checking extents;
it does not declare their provenance equal.

`compile(source).observations` exposes these derived facts. The ordinary type is
still `[Num]`; runtime lengths remain bounds, not type parameters. See
[causal semantics and the JTE rules](docs/CAUSAL.md).

## Bounded state evolution

```text
export fn root(x: Num, tolerance: Num, budget: Num) =
  require(x >= 0 && tolerance > 0,
    iterate(1, budget, estimate => {
      let next = (estimate + x / estimate) / 2;
      { state: next, done: abs(next - estimate) <= tolerance }
    })
  );
```

`iterate` returns `{state, steps, done}`. Budget exhaustion is distinct from
convergence. Increasing the runtime budget does not unroll more source or grow
a recursive stack. A budget does not preempt an expensive individual step;
applications still need resource policies and worker cancellation.

## ASABI 1: structured JS values and explicit input lifetime

The binary interface remains **ASABI 1**, with its frozen-binary compatibility
test. It supports Num, Bool, UTF-8 Text, Bytes, numeric/Boolean arrays and nested
records. Exports embed versioned schemas in an `asslang.abi` custom section.

```js
import { compile } from './src/compiler.mjs';
import { createRuntime } from './src/abi.mjs';

const runtime = await createRuntime(compile(`
  export fn smooth(xs: [Num], alpha: Num) =
    xs |> scan(0, (mean, x) => mean + alpha * (x - mean));
`), { pages: 2 });

const prepared = runtime.prepare('smooth', [[1, 2, 3], 0.5]);
try {
  const first = prepared.run();
  const second = prepared.run({ alpha: 0.25 });
  // Inputs were copied once. Each result owns its JS storage.
} finally {
  prepared.dispose();
}
```

Normal `runtime.call` copies and clears a frame per call. Prepared calls reserve
one private runtime and retain an input snapshot; only top-level scalar arguments
may be overridden. Disposal clears memory and invalidates the handle. No borrowed
JS view escapes. Prepared calls are pure-only and cannot bypass host capabilities.
See [ASABI layouts](docs/ABI.md) and [input leases](docs/LEASES.md).

## Host authority remains explicit

```text
host fn audit(value: Num): Bool;
export fn checked_energy(xs: [Num]) = effect {
  let value = sum(map(xs, x => x * x));
  let accepted = perform audit(value);
  { value: value, accepted: accepted }
};
```

All host functions are impure. The private broker requires an explicit grant and
checks signature, sequence, budgets, revocation and non-reentrancy. Permissions
are consumed before calling the host. Neither causal transitions nor prepared
calls obtain implicit authority. Effects remain synchronous and statically
sequenced; previous effects are not rolled back after a later trap. A powerful
callback is not made safe just because it can be called once. The runnable host
example and [threat model](docs/EFFECTS.md) specify this boundary.

## Corpus, compilation and limits

There are **35 accepted exports across 33 source files and 3 rejected files**.
Every example/export is registered in one corpus used for correctness and runtime
benchmarks. New examples include segmented scans, running z-scores, rolling means,
a streaming unsigned-integer lexer, machine products and Newton iteration.
Pathological repeated prefixes and separate-consumer replay remain visible.

Ordinary pure expressions form a demand graph. Causal transitions introduce an
explicit strict scheduling boundary when traversed; empty/dead streams do not
initialize state. The exact rules are in CAUSAL.md. Helpers are still staged into
consumers: there is no per-definition incremental compilation or separately
compiled generic ABI. There is no unrestricted multi-sink fusion, SIMD,
array-valued state, arrays of records, variants, general recursion, escaping
closures, async effects, or general ownership inference yet.

The current results are **168 Node tests and 596 Chromium checks**. Benchmarks
separate compiler work, Wasm instantiation, raw reused-buffer kernels, independent
JS algorithms, copying adapter calls and prepared calls. Compilation excludes V8
machine-code generation; p95 is over batch averages, not individual-call latency.
See [current evidence](docs/VALIDATION.md), [concept mappings](docs/CONCEPTS.md),
and [publication provenance](docs/PROVENANCE.md). Older unprefixed reports are
historical ASABI evidence, not current 0.2 measurements.
