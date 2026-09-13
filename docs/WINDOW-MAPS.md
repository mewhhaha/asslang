# Neighborhoods without a window matrix

[Array views](ARRAY-VIEWS.md) · [Documentation](README.md)

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
report examples and an executable comparison with explicit indexing. Include
window source in normal corpus/browser discovery using the existing linked-source
mechanism. Keep the root README short; link this guide from the docs index.

Test independent slice-based oracles, all short binary inputs and legal small
width/stride combinations, all eight lowering modes, gaps/overlap/tails/empty,
invalid parameters, polymorphic helpers, selected late windows at INT32_MAX,
callbacks with local state and reductions, strict versus lazy demand, provenance,
source-local errors, exact loop/output budgets, raw canaries, leases and effects.
Compare f64 order and fixed-tap bytes against explicit indexing without claiming
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
- https://numpy.org/doc/stable/reference/generated/numpy.lib.stride_tricks/sliding_window_view.html

No throughput benchmark, user study, proof assistant or independent formal audit
is claimed. Complete windows are not same-sized padded convolution, and the
correlation example does not reverse coefficients as mathematical convolution does.
