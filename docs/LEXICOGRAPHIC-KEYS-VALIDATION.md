# Tuple-key ordering validation

[Design and examples](LEXICOGRAPHIC-KEYS.md) · [Validation index](EVIDENCE.md)

## Revision and scope

Base: merged main `186fb5cadaf93389b060f1ae7509f15a6c443907`, tree
`79fd7f362305186a207520750614a107ffc0b00e`. PR #31's CI source archive reproduced
that exact tree. The unchanged baseline passed 1,333 Node tests. A design-only
commit precedes implementation, examples and tests.

The change extends the existing `sort_by` key representation to Num or nonempty
nested positional tuples of Num, with 16 leaves and 16 tuple levels maximum.
It changes type-constraint propagation, ordering staging/dependency discovery,
the native merge comparator and the reference model. No parser, token, builtin
name, runtime adapter, ABI version, effect grant, dependency or workflow permission
changes. The short README and historical validation reports remain unchanged.
General partition-recursion elaboration remains a proposal, not part of this PR.

## Executed local checks

September 13, 2026; Node v22.16.0, Linux x64, Chromium 144.0.7559.96.
These are local results, distinct from fresh GitHub CI.

| Check | Result |
| --- | --- |
| Unchanged baseline `npm test` | 1,333 passed; no failures/skips |
| Full `npm test` | 1,363 passed; no failures/skips |
| `npm run test:lexicographic-keys` | 26 passed |
| `npm run test:docs` | 26 passed |
| `npm run test:browser` | 1,726 core + 276 experiment checks passed |
| Host/reducer, case-study, workflow and native-ordering example runners | Passed |
| New comparison example and example build | Passed |
| Actual baseline comparison | 98 ASTs; 784 binaries, ABI objects and JTE certificates identical |
| Additional scalar-inference/key-loop compatibility | 64 binaries and ABI objects identical |
| Syntax checks and `git diff --check` | Passed |
| `npm run test:browser:http` | Attempted; `net::ERR_BLOCKED_BY_ADMINISTRATOR` |

Both browser harnesses register the new module. Only the engine bundle completed;
no browser policy was modified or bypassed. There are 56 dedicated new Chromium
assertions across all eight SIMD/fusion/memoization modes, plus eight checks from
the two new corpus entries. The existing 138 experiment cases remain. HTTP module
loading, workers, other engines and wall-clock performance remain unverified.

## Concrete source and resource improvement

The job example accepts priorities [2,1,2,3,2] and durations [9,1,4,8,4], and returns
original positions [3,2,4,0,1]. It chooses descending priority, ascending duration,
then original order. Jobs 2 and 4 have equal complete keys and retain that order.
Input lengths are checked by `zip_checked`. The example computes an ordering;
it neither executes jobs nor enforces domain-specific scheduling constraints.

The comparison runs both source forms with exact scratch/output capacities and
loop allowances. It also checks that one fewer loop unit traps:

| Metric for the five-row example | Tuple key | Two explicit scalar sorts |
| --- | ---: | ---: |
| Native ordering sites | 1 | 2 |
| Scratch bytes | 400 | 640 |
| Output bytes | 40 | 40 |
| Loop units | 34 | 63 |
| Wasm bytes with that loop allowance | 2,328 | 2,825 |

All keys, sorting and output projection execute in generated Wasm. There is no
host sorting import. These are artifact/resource measurements, not timings. The
same merge algorithm still makes multiple passes; the source change removes an
entire second ordering, not every merge pass. No automatic rewrite of chained
sorts is introduced, because their key-demand order, scratch and failure behavior
can differ. The finite total-key value equivalence is documented separately.

A deliberately packed scalar score fails a precision regression: primary keys
[1,1] with secondary keys [1,0] should order indices [1,0]. Multiplying the primary
by 2^53 and adding the secondary collapses the two scores, returning [0,1] instead.
The tuple implementation returns the correct [1,0] without encoding assumptions.

## Independent functional checks

Exhaust all 5,461 sequences through length six over the four pairs of binary
keys. Every native result is checked against a separate relational comparator
on original indices, and against two explicitly chained native stable scalar
sorts. The reference interpreter also has an independently written tuple semantic
model; it shares the parser but not JTE or Wasm comparison code.

Across eight lowering modes, 480 seeded finite pair sequences and 16 larger
opposing-priority cases agree with the independent index oracle. Other cases cover
all-equal keys, complete-key ties, signed zeros, extreme finite values, scalar and
Bool payloads. No subtraction is used by the ordering comparator or index oracle.
A twelve-component test distinguishes numeric tuple position 9 from position 10,
which ordinary alphabetical field sorting would reverse. Structural positional
records in a different construction order give the same behavior as tuple syntax.

Association tests compare `(a,b,c)`, `((a,b),c)` and `(a,(b,c))` with byte-identical
native output across eight configurations. An ordinary reusable subkey function
produces the same artifact. Singleton tuples retain the scalar-key emitted path.
These checks support the structural flattening/lexicographic proof in the design;
they are not proof-assistant verification or an independent audit of the compiler.

## Type propagation, scope and compatibility

Key restrictions are carried through variable links, record components and scheme
instantiation. This matters when a helper constructs a key tuple that is absent
from its return type: its component variables must still constrain callers.
Regression tests reject invalid keys in unused definitions and in unused callers
of generic helpers, not just when a bad key reaches Wasm emission.

Positive cases exercise polymorphic key helpers, partial application, function
fields, destructuring and reusable nested tuples. Wrong scalar types, empty keys,
named/symbol fields, noncontiguous positions, heterogeneous branch shapes,
function/stream components and unsupported ABI results are rejected. Concrete
width/depth caps are rechecked at staging after helper specialization. Monomorphic
captures, source-local diagnostics, effect rejection, ordering scope, unrelated
stream domains and unsupported differentiation remain enforced.

An exported unknown numeric key leaf defaults to Num, preserving old scalar-
inferred exports; unrelated polymorphic fields do not receive that default.
Generic helper signatures may now display a key variable rather than Num. The
existing signature printer shows the HM skeleton, not its representation predicate;
this is not a promise that arbitrary key types are accepted. User-defined ordering
instances and general qualified-type syntax are not added.

A fresh copy of the actual old compiler/source compared all 98 old corpus entries
in all eight lowering configurations. All 784 Wasm binaries, ABI objects and JTE
certificates match; all 98 parsed ASTs match. Four additional scalar-inference or
key-loop programs across eight settings with and without loop metering add 64
binary/ABI comparisons. These are finite compatibility checks, not a universal
binary-compatibility theorem. No inferred-signature identity claim is made for
newly generalized internal helpers.

## Demand, scratch and runtime checks

Every accepted row checks all key components before merging, including a trapping
or nonfinite secondary key when primary keys are unique. Count/prefix consumers
cannot bypass it. Empty input executes no key body; unselected or unused sorts
remain lazy as a whole, and an unused sort does not force scratch ABI 2.

Two per-row key reductions with 3/4, 1/2 and 2/3 iterations on inputs [3,1,2]
consume 15 key-loop units, in addition to 14 ordering units and 3 output units.
Exactly 32 succeeds and 31 traps in every lowering mode. Keys are not recomputed
during comparisons. A captured auxiliary ordering referenced only by the second
key is discovered and gets a disjoint scratch reservation. One byte less than
the combined requirement fails; empty input does not demand that auxiliary key.

Raw calls preserve chosen NaN payload bits, infinities and signed zero under
finite constant tuple keys. Sentinel bytes beyond output remain unchanged, and
scratch/input overlap is rejected without writes. The largest key width executes
with its exact 544-byte two-row capacity. Managed and prepared calls retain
input snapshots, output-copy ownership, temporary overrides, lease disposal and
post-trap reset. Prior native-ordering raw-memory and capacity tests remain intact.

## Development findings and limits

The first full implementation run failed only the orphan-document check because
the design page had not yet been linked. Navigation was completed before the
successful full run. Type-propagation review also led to explicit component
restriction propagation for generic helper calls; focused regressions cover it.
No existing test was weakened, no bounds were raised, and no historical result was
rewritten to make the new implementation pass.

Tuple keys are an established ordering technique. The contribution is a focused
source-level and native-execution integration: explicit priorities without score
packing or a repeated sort. There is no new sorting algorithm, empirical readability
study, formal proof assistant, unrestricted comparator support or universal speedup.
All key leaves must be finite Num, and tuples are fixed-shape per ordering site.
Scratch still scales with source extent and key/payload width. Key computation
can be expensive, and comparisons/row copies are bounded straight-line work rather
than separately metered instructions. General recursive decomposition, sorted-
prefix selection and scratch-lifetime optimization remain separate work.
