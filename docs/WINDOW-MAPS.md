# Neighborhoods without a window matrix

[Array views](ARRAY-VIEWS.md) · [Documentation](README.md)

## Use the neighborhood, not a matrix of copied windows

For samples `[2,4,8,4,2]`, the three-tap smoother below returns `[4.5,6,4.5]`.
For samples `[1,2,3,4,5]`, weights `[1,0,-1]` and stride 1, the correlation
returns `[-2,-2,-2]`. Width determines the neighborhood; stride determines how
far its origin moves. Windows that would run past the input are omitted.

```sh
npm run example:window-maps
npm run test:window-maps
printf '[[2,4,8,4,2]]' | node examples/case-studies/app.mjs window-smooth
```

The complete source programs are below. Embed them by passing `lib/windows.ass`
and the chosen example to `compileSources`; the registered CLI does that linking
for you. `window_map` is a source-library function, not an implicit import or
reserved intrinsic. Two checked views construct each read-only neighborhood and
stage away; overlapping windows are never copied into a matrix.

## Contract before implementation

Add a source library `window_map xs width stride f` for complete overlapping
neighborhoods of dense indexed inputs. This is ordinary Asslang, not a new builtin,
nested-array ABI, special comparator or host slice loop. A callback receives a
read-only symbolic window and returns a scalar or scalar record. Local reductions,
indexed taps, scans reduced to a summary, and checked zips are ordinary operations.

For N input events, positive integer width W and step S, the output count is
M=0 when N<W, otherwise 1+floor((N-W)/S). Window q contains source positions
q*S through q*S+W-1. No padding or partial trailing window is implicit. W and S
must be integral, positive and <=INT32_MAX, even on empty/count demand. Values
and callback results follow the existing numeric/Bool rules; finite payloads are
not required unless the callback requires them. Unused whole computations stay
lazy. A demanded count validates structural inputs but does not execute callbacks.

Each window is built by two existing checked `split_at` views inside a map over
valid start indices. There are no intermediate element arrays, window-descriptor
arrays or new scratch buffers. Source functions/views are staged; final output
arrays and the host adapter still need their usual storage. An already demanded
sort retains its own scratch cost. This project does not require the #35 scan
integration and can be reviewed against main independently.

## Safety, overlap and observation identity

For q<M, q*S<=N-W, hence both cuts are inside the source and every window position
is valid. The callback's local position j maps to q*S+j. This is an injection for
each window but NOT a disjoint cover across windows: overlap is intentional.
Consequently there is no flatten/rejoin identity or original-source zip witness.
Bind one output stream to share its event domain; independently constructed maps
or original input need explicit `zip_checked` for positional pairing.

Read-only overlapping regions are safe because no callback mutates its source.
There is no in-place update permission, alias exemption, arbitrary pointer API
or escaping borrowed window. Filtered and causal sources are rejected by the
existing indexed-view checker; an unrelated equal length does not prove alignment.
The existing 64-view-depth and staging/node bounds remain. Sort construction in
a runtime callback and unauthorized host calls retain their errors.

W, S and N are within INT32_MAX. Integer subtraction and each valid start product
are exactly representable in f64. For positive integers a<=INT32_MAX and S, the
nonintegral quotient a/S is at least 1/S from its nearest integer boundary; its
f64 rounding error is less than 2^-21/S. Thus floor((N-W)/S) does not cross a
boundary. The range and both cuts are independently checked by existing Wasm
lowering. No unsafe host-provided shape assumption removes those guards.

## Compositional laws and cost boundaries

For total pure callbacks, `map (window_map xs W S f) g` agrees in values and event
order with `window_map xs W S (window -> g (f window))`. Both lower through the
same ordinary map composition; tests compare emitted bytes for representative
programs. A single selected output can compute only its selected window. This
must not force other windows' values or change the existing source/shape guards.

A fixed T-tap callback has O(M*T) reads and one output traversal. A full reduction
per window has O(M*W) work, not O(N) merely because the windows allocate no arrays.
Its emitted loop budget is M*(W+1) without other callback/producer loops. A T-tap
callback without inner loops costs M units. Nested scans, reductions, zips and
source generation contribute their own work to the same budget. No hidden
sliding-sum recurrence or f64 reassociation is introduced. Prefix-difference sums
can disagree due to cancellation and need a separate numerical contract.

There is no general once-only evaluation of the source: overlapping windows may
read/recompute the same source position repeatedly. Shared output history and
compatible returned sinks can use existing causal output fusion. This library
is a practical test of existing composition, not a claim that all neighborhood
algorithms are optimal or that arbitrary map callbacks run in linear time.

## Implementation and validation plan

Keep `src/`, the parser, ABI, effects, compiler options, dependencies and workflow
permissions unchanged. Add the library, complete registered smoothing/correlation/
report examples and an executable driver with exact loop/output bounds. Include
window source in normal corpus/browser discovery using the existing linked-source
mechanism. Keep the root README short; link this guide from the docs index.

Test independent slice-based oracles, all short binary inputs and legal small
width/stride combinations, all eight lowering modes, gaps/overlap/tails/empty,
invalid parameters, polymorphic helpers, selected late windows at INT32_MAX,
callbacks with local state and reductions, strict versus lazy demand, provenance,
source-local errors, exact loop/output budgets, raw canaries, leases and effects.
Compare f64 order and representative map-composition bytes without claiming
universal byte equality. Run the full suite, host/reducer examples and browser
engine checks. Also test the new library atop the repaired #35 compiler locally.
Report only completed checks and preserve original benchmark/validation reports.

## Prior art

Read-only overlapping windows are established: Rust's slice `windows` and NumPy's
`sliding_window_view` provide related operations. NumPy explicitly warns that
zero-copy windows do not remove O(N*W) work. This project applies existing Asslang
staging, checked views and source composition to neighborhood kernels without a
new primitive; it does not claim a historically new window algorithm or theorem.
Sources checked September 13, 2026:

- https://doc.rust-lang.org/stable/core/primitive.slice.html#method.windows
- https://numpy.org/doc/stable/reference/generated/numpy.lib.stride_tricks.sliding_window_view.html

No throughput benchmark, user study, proof assistant or independent formal audit
is claimed. Complete windows are not same-sized padded convolution, and the
correlation example does not reverse coefficients as mathematical convolution does.

## Executable examples

<!-- window-example: smooth -->
```ass
// Three-tap smoothing on complete windows, without a window matrix.
export fn smooth = (samples:[Num]) ->
  samples
  |> window_map 3 1 (w -> (at w 0 + 2*at w 1 + at w 2)/4);
```

<!-- window-example: correlate -->
```ass
// Complete-window cross-correlation; coefficients are NOT reversed.
export fn correlate = (samples:[Num]) -> (weights:[Num]) -> (stride:Num) ->
  samples
  |> window_map (count weights) stride (w ->
    zip_checked w weights (sample -> weight -> sample*weight) |> sum);
```

<!-- window-example: neighborhood_report -->
```ass
// Compute a neighborhood slope, then share one cumulative reporting history.
export fn neighborhood_report = (samples:[Num]) -> do {
  let history =
    samples
    |> window_map 3 1 (w -> (at w 2 - at w 0)/2)
    |> scan {slope:0, total:0} (state -> slope -> {
      slope,
      total: state.total+slope,
    });
  {
    slopes: history |> map (state -> state.slope),
    totals: history |> map (state -> state.total),
    state: history |> fold {slope:0, total:0} (previous -> next -> next),
  }
};
```

## Executed validation

September 13, 2026; Node v22.16.0, Linux x64, Chromium 144. Source base is main
`ec52b05814523289005cf6cd3a22f473b812ee00`, tree
`877e6017f3dca0ef05798f7f23873e9abf4b72bf`. This source library is independent
of PR #35. No file under `src/`, runtime adapter, ABI, permission, dependency,
compiler option or historical validation report changes. The short README is
unchanged; the three examples are linked through the existing corpus registry.

| Check | Executed result |
| --- | --- |
| Full default-concurrency `npm test` | 1,468 passed; no failures/skips |
| Focused window suite | 21 passed |
| Documentation suite | 26 passed |
| Chromium engine suite | 1,885 core + 276 experiment checks passed |
| Combined checkout with repaired PR #35 | 1,504 tests passed |
| Actual-main compatibility | 848 binaries, ABI objects and certificates identical |
| Host, reducer and case-study example runners | Passed |
| HTTP browser path | Attempted; policy blocked navigation |

The existing browser corpus paths execute all three linked examples in normal,
fused and scalar/SIMD configurations, adding twelve assertions. The browser run
is not a worker/module-loading or other-engine result. HTTP navigation failed
with `net::ERR_BLOCKED_BY_ADMINISTRATOR`; no policy was changed or bypassed.
Remote CI status belongs to the PR, not this local report.

All 106 existing corpus entries retain identical Wasm, ABI objects and JTE
certificates across eight lowering configurations against the actual main compiler.
There is no core compiler change in this project.

An independent slice-based oracle covers 8,192 exhaustive input/width/stride
cases and 480 seeded cases. The focused tests exercise all eight lowering
configurations, nested window maps in chunk callbacks, local scan/stopping-fold
state, invalid parameters on empty/count demand, selected-window demand, borrowed
Bool/record rows, source-local errors, typed rejection, effect authority, native
sort scratch, cache isolation, prepared snapshots and recovery after traps.
INT32_MAX virtual-window endpoints are compared with BigInt arithmetic and execute
with zero loops or memory import; no enormous input array is allocated.

Raw tests preserve chosen signed-zero, NaN and infinity payload bits through
constant-tap reads, protect canaries and reject input/output overlap without writes.
Representative map-composition programs emit identical binaries across eight
settings; this is not an all-program optimizer proof. The library does not invent
source-alignment evidence for overlapping neighborhoods or independent maps.

On the documented fixtures, the executable driver checks these exact allowances
and verifies that one fewer unit or output byte traps:

| Kernel | Loop sites | Loop units | Intermediate buffer bytes | Final array bytes | Wasm bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Three-tap smoothing | 1 | 3 | 0 | 24 | 1,856 |
| Three-coefficient correlation | 2 | 12 | 0 | 24 | 1,858 |
| Shared slope/total report | 1 | 3 | 0 | 48 | 2,742 |

Wasm sizes include the stated loop allowance. Output bytes exclude descriptors,
input storage and host copies. The report returns slopes `[3,0,-3]`, totals
`[3,3,0]`, and final state `{slope:-3,total:0}`. Disabling output fusion retains
three traversals and nine units with the same values. This reuse belongs to the
existing compiler, not a newly introduced fusion pass.

The correlation visits three values in each of three windows plus three window
events: twelve loop units. Zero window buffers do not remove repeated reads.
A cancellation regression on `[1e16,1,1]` yields window sums `[1e16,2]`; a prefix
sum subtraction yields 0 for the second window instead. The implementation keeps
ordered per-window arithmetic rather than silently changing the numeric contract.

No throughput advantage, universal complexity inference, new window algorithm,
proof-assistant verification or independent formal audit is claimed. This project
adds a useful checked source abstraction and executable composition evidence,
not another compiler primitive or a claim of historical novelty.
