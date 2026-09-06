# Composable stopping kernels

This change extends the causal kernel model, not its runtime object model. JTE
still distinguishes an event domain from density and seekability. State is still
scalar or nested scalar records. Functions, reducer records, and their captures
are staged away; the guest receives loops and locals, not closures or iterators.
ASABI stays at version 1. Experimental reduction fusion stays opt-in.

## Stop a traversal deliberately

```text
export fn first_index(xs: [Num], key: Num) = {
  let r = fold_until(xs, { index: 0, found: -1 }, (s, x) => {
    state: { index: s.index + 1, found: if x == key then s.index else -1 },
    done: x == key,
  });
  { index: r.state.found, found: r.done, visited: r.steps }
};
```

`fold_until(xs, initial, step)` infers the step type
`(State, Element) -> {state: State, done: Bool}` and returns
`{state: State, steps: Num, done: Bool}`. The state representation must not change.
State can be Num, Bool, an empty record, or nested scalar records.

For every accepted event, the transition computes **all new state fields and
its done flag from the old state**, then commits them simultaneously. The event
that returns true is included. The returned step count is the number of accepted
sink events: after `filter` or `transduce`, it is not a source array index. Empty
input or a stream emitting nothing returns the initial state, zero steps and
false. `done: false` means exhaustion, not necessarily failure of the application.

No later item, filter predicate, or causal transition is evaluated after stopping.
This is observable through traps, not just a speed hint:

```text
export fn safe_prefix(xs: [Num]) = xs
  |> scan(0, (s, x) => require(x >= 0, s + x))
  |> fold_until(0, (s, x) => { state: x, done: x >= 3 });
// [1, 2, -99] -> {state: 3, steps: 2, done: true}; the suffix never transitions.
```

The sink initial value is demanded when the sink is demanded, as for `fold`.
Causal frames are not initialized if their input gate never opens. Extent and
`zip_checked` obligations are still checked before traversing, even for empty
inputs. The transition that stops is strict: an invalid new state field cannot
be hidden by projecting only `.done` from the result.

Nested traversals rename cursor/state identities, and loop-invariant stopping
reductions remain lazy-memoized. Both memoization modes and both fusion modes are
regression-tested. A stopping sink is intentionally **not** placed in a cohort
with exhaustive reductions: doing so would evaluate a suffix the sink must not
demand. A separate exhaustive consumer must still traverse its entire input.
The certificate uses the existing scalar `reduce` rule; no new domain-equality
axiom is introduced. Diagnostics add `stats.functions[].shortCircuitFolds`.

This is bounded by the finite upstream traversal, not a time quota. A single step
can still be expensive, and a predicate that never matches consumes the entire
stream. There is no arbitrary cancellation, async effect, or two-cursor zip.

## Reducers are a library, not more keywords

`lib/reducers.ass` defines the ordinary inferred protocol:

```text
{ initial: state, step: (state, item) => next_state, finish: state => result }
```

`reduce_with` returns the finished terminal state. `scan_with` finishes every new
state as it is emitted. `reducer_map_input`, `reducer_filter`, and
`reducer_map_result` compose transformations without changing the execution model.
`reducer_product` builds simultaneous product state:

```text
export fn summarize(xs: [Num]) = {
  let energy = reducer_map_input(sum_reducer(), x => x * x);
  let positive = reducer_filter(count_reducer(), x => x > 0);
  let result = reduce_with(xs, reducer_product(energy, positive));
  { energy: result.left, positive: result.right }
};
```

This is one loop even with experimental fusion disabled. This explicit product is
not a claim that the compiler fuses arbitrary separate sinks. Mean uses a zero
result for empty input; applications needing another convention can define their
own initial/finish functions. Neumaier compensated summation is separately shown
as an explicit two-scalar fold, not silently substituted for ordinary addition.

Terminal reducers use the same protocol except their steps return `{state, done}`.
`until_with` returns `{value, steps, done}`, applying `finish` to the final state.
Available examples include `first_matching`, `any_reducer`, `all_reducer`, and
`threshold_reducer`, plus `until_map_input`.

`until_both` and `until_either` compose two terminal reducers. Each completed lane
**freezes independently**: its predicate and transition are not called again.
The other lane continues until the selected completion policy stops the traversal.
The finished product includes each lane's own `done` flag, so exhaustion is not
confused with success:

```text
export fn milestones(xs: [Num]) = until_with(xs,
  until_both(first_matching(x => x > 10, -1), threshold_reducer(15))
);
// [2, 11, 3, 100] stops at step 3: first value 11, threshold sum 16.
```

For `all_reducer`, done means a counterexample stopped the traversal; its finished
Boolean is false. Empty `all` finishes true with done false. Empty `any` finishes
false with done false. Thresholds are tested after a transition, not before the
first input. Product combinators evaluate both active lanes for the current event;
`until_either` does not skip the other active lane within that same event.

These operations build on established fold, product-state and short-circuit ideas.
The project-specific contribution is their integration with inferred record
protocols, causal demand, checked observation domains, and direct scalar Wasm
lowering. This is not a claim of worldwide novelty or a new general-purpose type
system. See [the existing related-work discussion](RELATED-WORK.md).

## Source and syntax ergonomics

```sh
node src/cli.mjs examples/concepts/reducer_toolkit.ass \
  --lib lib/reducers.ass --run summarize --args '[[1,-2,3]]'
# {"energy":14,"positive":2}
```

The CLI also accepts repeated `--lib`, `--check`, `-o`, `--explain`, and the existing
fusion flag. `--pages N` sets a fixed execution arena. Both binary and sidecar paths
are checked against every source, including symlinks and hardlinks, before writing.
This is accidental-overwrite protection, not a race-proof filesystem sandbox.
`--run` supplies no capability and cannot implicitly authorize host calls. JSON
results use JSON's normal limitations: NaN and infinities serialize as null, and
negative zero loses its sign. Use the JS API for full IEEE values.

`compileSources([{name, source}, ...], options)` links up to 128 named fragments
into one inferred global namespace with a combined one-million-character limit.
No filesystem or network I/O happens in the compiler. File order need not be
dependency order; duplicate functions remain errors. There are no separate module
namespaces, imports, private declarations, or separately compiled generics.
Returned `sourceFiles` describes fragment ranges. Errors have `sourceName`,
file-local `offset`, and `absoluteOffset`; call `error.format(file.source)` to
format them. A separating newline makes end-of-file comments safe.

Pipes can call static record members or parenthesized functions:

```text
fn toolkit(scale) = { apply: x => x * scale };
export fn main(x: Num) = { let ops = toolkit(3); x |> ops.apply |> (y => y + 1) };
```

Calls, parameter lists, lambda lists, records and record annotations accept trailing
commas. Record puns allow `{value, done}`. **Compatibility detail:** `{value}` still
means the old singleton expression block. Write `{value,}` for a one-field pun.
All this syntax lowers to existing call/record nodes; no runtime dispatch is added.

## Repeated builds and native module reuse

```js
import { createCompiler } from './src/compiler.mjs';
import { createRuntime } from './src/abi.mjs';

const compiler = createCompiler({ maxEntries: 16, maxBytes: 8 * 1024 * 1024 });
const artifact = compiler.compileSources(files);
const repeated = compiler.compileSources(files); // repeated.cache.hit === true
const module = await WebAssembly.compile(artifact.bytes);
const first = await createRuntime(module, { pages: 2 });
const second = await createRuntime(module, { pages: 2 }); // independent private arena
compiler.clear();
```

The explicit LRU keys exact combined source and normalized semantic options.
It is **not per-definition incremental compilation**. Editing a fragment rebuilds
the whole program. No global cache retains source. Returned bytes, schemas,
certificates and statistics are independent snapshots; modifying one cannot corrupt
later hits. Failures and over-budget entries are not stored. Entries are bounded
by count and the measured sizes of source/binary/serialized metadata, not an exact
JavaScript heap bound. Native module objects are reusable explicitly, not cached
silently. Host capability checks still run for native-module runtimes.

`artifact.cache.elapsedMilliseconds` measures the actual session operation,
including its snapshot work. `artifact.stats.milliseconds` on a hit describes the
original build that produced the cached artifact; it is not the cache-hit latency.
`compiler.stats` reports hits, misses, entries and retainedBytes. `clear()` releases
entries and resets the counters. Long-lived callers still need lifecycle policies.

Numeric ABI transfers use intrinsic Float64Array bulk copies on little-endian
hosts, with the original per-element DataView fallback otherwise. Ordinary arrays
retain dense data-property checks; user getters/iterators are not newly trusted.
Returned arrays own their storage; prepared lease scrubbing and disposal remain
unchanged. Bulk copy does not make structured JS calls zero-copy or allocation-free.

## Evidence

[The validation and performance report](COMPOSABILITY-VALIDATION.md) gives the
actual test counts, reproduction commands, host measurements and limitations.
The .ass corpus, Node tests, browser engine checks and benchmark loader share one
library-aware source loader. The playground example selector loads registered
library sources as well, but its HTTP/worker path remains separately unvalidated
under the current browser policy.
