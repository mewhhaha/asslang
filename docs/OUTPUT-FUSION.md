# One-pass causal output materialization

[Practical workflows](CASE-STUDIES.md) · [Compiler architecture](IMPLEMENTATION.md)

## Problem and scope

The resumable monitor returns two arrays and its final state from one `scan`.
On merged main `a3669db6b496a4ba892b306a462d0785d9bb2e88` those three consumers
replay the same history independently: three loops, three machine frames, and
three units of iteration allowance per input sample. The unchanged baseline
passed all 1,194 Node tests. Its tree is
`d815e865d113a1e21ce01d953925e8c1666459d8`.

This change extends the existing `reductionFusion` option with a conservative
output cohort: compatible, co-demanded **dense causal** arrays and direct scalar
reductions in one returned record share a traversal. No new syntax, intrinsic,
stream object, collection API or ABI layout is needed. Disabling reduction fusion
retains the previous separate traversals. Stateless/SIMD output, sparse output,
conditional scalar results and unsupported mixtures retain their existing path.
The monitor's source and public host API need not change.

Stream fusion and stateful stream compilation are established techniques, not a
new mathematical invention. Related work includes Coutts, Leshchinskiy and
Stewart, *Stream Fusion: From Lists to Streams to Nothing at All* (ICFP 2007),
and Kiselyov, Kobayashi and Palladinos, *Complete Fusion for Stateful Streams*
(2024), https://arxiv.org/abs/2412.15768. This pass is narrower than those general
frameworks. Neither worldwide novelty nor universal profitability is claimed.

## Eligibility and demand boundary

Planning sees the already-staged exported result and its existing ASABI schema.
It flattens records in ABI field order, retaining each leaf's descriptor offset.
A cohort must contain at least one materialized stream and at least two physical
sinks (arrays plus distinct reduction nodes). All non-record leaves must be:

* Num/Bool arrays; or
* direct scalar reductions or fields of scalar-record reductions, optionally
  wrapped in a matching sequence of unconditional `require` guards.

Every sink must have the same checked JTE event domain, exact extent node,
lexical cursor identities and ordered causal-machine identities. At least one
causal machine is required. The observation must be dense and its mask absent.
The effective guard sequence (outer scalar guards, then its stream guards) must
be identical to the array guard sequence. This is deliberately stricter than
semantic equivalence of conditions. Equivalent but differently ordered guards
may miss this optimization; they do not justify guessing a common demand region.

The common guards, extent, initial values, demanded array items, fold bodies and
complete machine transitions must contain no nested reduction, bounded iteration,
stopping fold or host-call node. `if`/short-circuit/guards inside a transition or
array element keep their normal per-event semantics; a conditional scalar result
is NOT traversed to discover sinks in branches. Ignore undemanded stream items
for count/ignoring folds, exactly as the old reduction planner does.

Only co-demanded exported data are considered. Projecting the result in source
before export removes unused fields during staging; the planner cannot revive
those fields. Blobs, unrelated streams, distinct scan instances, sparse masks,
nonmatching guards, conditional scalar roots or arbitrary scalar arithmetic cause
this initial whole-record implementation to fall back. Already completed or lazy
reductions are not moved into another cohort. No optimization crosses a host
effect: existing explicit effects run in source order before output handling.

## Representation and memory safety

For dense streams, the output length is exactly the common extent, including
zero. Reserve each array's final output slice up front, in the SAME ABI field
order and with the SAME eight-byte start alignment as separate materialization.
Bool elements occupy four bytes and Num elements eight. Retain separate slices
for duplicated output fields: do not alias their raw descriptors as an optimization.
The descriptor block and field offsets stay unchanged, as does the returned end
cursor. No temporary history array or additional guest allocator is introduced.

Before advancing a cursor by `extent * stride`, compare extent with
`floor((end - alignedCursor) / stride)` using unsigned arithmetic, after checking
`alignedCursor <= end`. Entry checks already bound the output arena end to
INT32_MAX. Consequently successful reservation cannot overflow, overlap input
or descriptor storage, or exceed the caller-supplied output allowance. Empty
arrays still apply the previous alignment rule. Do not reserve the upper bound
of a filtered stream: that could reject a buffer large enough for its actual
output; such streams take the old path instead.

Emit one index loop and one shared copy of the exact causal schedule. Each
physical fold has its own seed and accumulator locals. Snapshot every next-state
component before updating any accumulator. Each array writes at its reserved
slice plus `index * stride`. When the loop finishes, cache scalar/group reduction
results and write the existing descriptors through the ordinary result writer.
No state or result cache crosses calls or lexical loop bindings.

## Correctness argument

Induct on the common input index. Before the first event, each fold has its
original initial value and the machine's lazy initialization has not occurred.
The shared schedule has exactly the same gate and prior state as each old replay.
At the next event it therefore emits the same cells and next state. Each demanded
array element is evaluated against those same cells. Each fold snapshots the same
body values from its own previous accumulator, then updates simultaneously. This
establishes identical stream elements, accumulator values and causal state at the
next index. Numeric recurrences preserve their original left-to-right f64 order;
there is no reassociation or parallel scan. Induction gives the same successful
result, including record-valued folds and empty input (which never initializes a
causal transition). The allocation formula gives identical successful array
locations and end cursor; descriptors and host lifting are unchanged.

No conditional data is newly demanded: all cohort leaves are required in the
returned record, and each per-element branch retains its original guards.
Pure work across co-demanded sinks is interleaved rather than replayed sequentially.
As with existing reduction fusion, the exact amount of work and partial output
written before a trap is NOT preserved. Up-front capacity checks can trap earlier.
Callers must discard outputs of failed raw calls; host checkpoint commits still
occur only after the whole call succeeds. Host effects already performed are not
rolled back. Success/failure from inadequate loop allowance can intentionally
change: the allowance measures emitted traversals, not source-level events or
wall-clock time.

## Diagnostics, compatibility and alternatives

Report `outputFusion` separately from reduction-only groups: enabled flag,
cohort domain, participating stream proofs/reduction IDs, shared machine count
and eliminated traversal count. Overall loop, machine, local and Wasm-byte
statistics remain real emitted counts. The existing `reductionFusion` toggle
also disables this pass; no configuration migration is required. Keeping an
old tight allowance can now succeed on an eligible optimized program, which is
consistent with the existing optimization-dependent loop-budget contract.

Alternatives include manual array-of-record output (unsupported by the current
ABI), adding a collect/scan-result intrinsic (new language surface), temporary
history materialization (extra memory/loop), and unrestricted output fusion
(unknown sparse lengths and more difficult demand ordering). A dense, identical-
schedule result cohort fixes the concrete workflow without those changes. It
still falls back for many useful but more complex shapes. Current ABI bounds
limit record depth/leaves; graph inspection is memoized and does not enumerate
input events or expand formulas. The planner adds no unbounded graph recursion
beyond the compiler's existing expression-depth constraints.

## Validation plan

Run the unchanged baseline first, then prove the monitor now has one loop and one
machine with fusion enabled and its old three loops/machines when disabled. Check
all eight SIMD/fusion/memoization modes against the JS recurrence and interpreter,
whole/chunked runs, JSON checkpoints, signed zero and trap recovery. Three samples
must need three optimized units but nine unfused units; failed chunks must not
advance the host checkpoint. Preserve exact-budget behavior of existing programs
that are deliberately ineligible.

Add array-only and array-plus-fold examples, duplicate fields, nested records,
Bool/Num strides, odd lengths, empty inputs, record-state snapshots, multiple
shared machines, and raw output-descriptor/arena tests. Include exact/short output
buffers, canaries, input/output overlap, oversized lengths and post-trap calls.
Negative cases cover sparse streams, independent domains/scans, unmatched guards,
conditional/undemanded fields, nested reductions, stopping folds, effects, causal
access and ABI rejection. Test source-local diagnostics, cache copies and leases.
Register real-browser checks in both harnesses and run all existing Node,
host/reducer/workflow examples and available Chromium validation. Keep README
short, and record only executed results in a new validation report.
