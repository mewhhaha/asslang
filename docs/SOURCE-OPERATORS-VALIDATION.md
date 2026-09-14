# Source operator composition: executed validation

[Design and examples](SOURCE-OPERATORS.md) · [Validation index](EVIDENCE.md)

## Revision, scope and environment

Based on merged main `12754f5b69e297d9422205bd1205ff08b8ed142a`, tree
`de77cb80d30ada9751252a785e6b255dce6576ed`. The supplied archive reproduced that tree.
The unchanged baseline passed 1,540 Node tests. Theory commits preceded the source
implementation and each of the two core repairs discovered during the experiment.

September 14, 2026: Node v22.16.0, Linux x64, Chromium 144.0.7559.96.
`lib/operators.ass` and `lib/krylov.ass` are ordinary parsed/inferred/staged source.
No builtin, parser rule, type rule, ABI, registry entry, dependency or workflow
permission is added. The callable inventory remains 30 primitives and four source
prelude functions. Three existing compiler files change: forward/reverse seed
substitution and identical-arm Wasm lowering. This is not a compiler-unchanged PR.

## Completed checks

| Check | Result |
| --- | --- |
| Unchanged merged-main baseline | 1,540 Node tests passed |
| Complete final `npm test` | 1,591 passed; zero failures/skips |
| Focused source/operator-sharing tests | 47 passed |
| Documentation tests | 26 passed |
| Chromium engine tests | 2,085 core + 276 experiment checks passed |
| Existing corpus comparison | 113 entries x eight modes: 904 byte-, ABI- and certificate-identical builds |
| Existing AD experiment comparison | 624 successful builds: all ABI/certificates and runtime results/traps match |
| Existing AD binary sizes | 48 byte-identical; 576 changed by lowering |
| Existing AD failure diagnostics | 160 identical code/phase/offset comparisons |
| Core inventory and deterministic prelude snapshot | Passed |
| Required host/reducer, case-study, workflow, chunk and window drivers | Passed |
| Source-operator driver, example build, syntax and diff checks | Passed |
| HTTP browser test | Attempted; blocked by net::ERR_BLOCKED_BY_ADMINISTRATOR |

All eight combinations of SIMD, fusion and reduction memoization are tested.
The native browser checks add 64 assertions; the two corpus entries add eight
checks through the existing browser paths. Both browser harnesses register the
feature. Only the bundled engine path completed; HTTP loading, workers and other
engines were not established. No browser policy was changed or bypassed. Fresh
GitHub CI is separate from these local runs and is recorded in the PR discussion.

No existing assertion was removed or weakened. An initial 40-test focused run
found extra nested reduction work in the solver's short-circuit validation paths.
Explicit source demand phases fixed that before the successful focused/full runs.
The final ten-unit nested-action test retains its original expected allowance.

## Measured composition failure and repair

The EXACT final calibration source plus the two libraries was supplied to both
compilers with maxLoopIterations:4. The baseline parsed/inferred/staged it, but
rejected its generated binary. Native validation reported:

    Compiling function #0 failed: local count too large

The baseline emitter produced 1,631,264 bytes, 108,365 locals and 97 loop sites from
590 scalar nodes. These are counts on a rejected module, not a working baseline
execution. The new compiler produces a valid 11,200-byte module, 514 scalar nodes,
one loop site and 4,544 bytes of declared Wasm local values. It solves the fixture
in two iterations. Its recorded compile time was about 58 ms on this one run;
this is an observation, not a benchmark distribution or throughput claim.

An earlier, less carefully phased source probe produced about 43 MB in the raw
emitter. That was a different intermediate source, not the final-source comparison
above. Both probes exposed the same expansion mechanism: AD retained primal demand
as `if condition then value else value`, and the emitter recursively duplicated
identical arms. The repair evaluates the condition, discards the Boolean, and
emits the identical scalar-node arm once. It does not drop guards or compare
expressions by guessed equality.

A separate source chain of identical-arm conditionals measures code growth:

| Nesting | Baseline bytes | New bytes |
| --- | ---: | ---: |
| 4 | 609 | 455 |
| 8 | 3,748 | 483 |
| 10 | 14,500 | 497 |
| 12 | 57,510 | 511 |

An 80-level chain compiles under the unchanged bounds. Tests cover both Boolean
values, NaN, infinity and signed zero payloads, a trapping memory read or metered
reduction in the condition, invalid raw Bool values, and distinct branches that
must keep selected-demand behavior. The mathematical justification is Boolean
case analysis with the condition's original evaluation order retained.

The other repair preserves externally supplied direction/weight graph identities
while substituting a plan's private perturbations. Previously, a saved derivative
cloned a caller's three-step iterate used as its seed; returning the step count
alongside the derivative demanded both copies and failed a three-unit allowance.
Both forward and reverse now use one loop and exactly three units, returning
steps=3,value=6. Nested derivatives still traverse those seeds: the tested outer
gradient of 2*x^3 is 6*x^2. The fix does not freeze seeds with stop_gradient.
Record seed leaves share their original group; cursor-dependent nested reductions
and captured one-call host effects retain their scopes and authority.

## Source algebra and numerical evidence

A rectangular nonlinear two-stage function is checked in 320 seeded cases against
an independently calculated dense Jacobian. Tests compare forward actions, adjoint
actions, normal actions, directional finite differences and the adjoint pairing.
They also check the nonnegative normal quadratic against the independently computed
squared forward norm. This validates finite cases; F64 arithmetic is not an exact
linear category and these are not automatic compiler rewrite laws.

Identity, transpose involution, reverse-order adjoint composition, associativity,
rectangular block products and nested product spaces are exercised. A dedicated
nonlinear case shows why the next stage must be differentiated at the first
stage's value: the correct derivative is 108, while composing two derivatives at
the unrelated original input gives 36. Arbitrary supplied dictionaries remain
unchecked mathematical contracts, not compiler-issued certificates.

The source solver is checked against 480 independently constructed SPD systems
across eight lowering modes. A larger nested four-coordinate product uses the
same generic source algorithm. Empty work, already-solved initial state, zero RHS,
iteration limit, nonpositive curvature, overflow in a trial, invalid controls,
invalid initial/final residuals, and fresh invocation budgets are covered.

The final residual is recomputed independently of the CG recurrence. On the
published product fixture, the recurrence squared residual is approximately
3.48e-31 but the true squared residual is approximately 1.26e-29. At tolerance
1e-15 the recurrence stops after two steps while the checked residual misses the
threshold. The result is correctly converged=false,breakdown=false. No tolerance
is raised and no restart is silently added. On overflow in a trial, the last
accepted finite solution is retained with breakdown=true. A trapping supplied
action or nonfinite initial/final residual still traps normally.

The calibration case solves one damped linearized correction. At x=[0,1,2],
y=[1,3,5], point=(0,0), damping=1, the independent system is
[[6,3],[3,4]] delta=[13,9], giving delta=(5/3,1). Nonzero initial parameters are
also checked against the independent 2x2 inverse. The penalty is on the correction,
not the final coefficients. A normal operator is Gauss-Newton curvature, not the
exact Hessian of an arbitrary nonlinear least-squares objective. Normal equations
can square condition numbers; this is not a generally recommended production solver.

## Exact work and storage

The driver compiles in core-only mode and supplies the source libraries explicitly.
Each case uses one loop site and zero intermediate guest buffers:

| Final fixture | Loop units | Final array bytes | Wasm bytes | Wasm local-value bytes |
| --- | ---: | ---: | ---: | ---: |
| Product normal-system solve | 2 | 0 | 5,003 | 2,012 |
| Operator inside block scans and aligned outputs | 7 | 112 | 1,712 | 148 |
| Generated-Jacobian calibration correction | 2 | 0 | 11,200 | 4,544 |

Zero final-array bytes does NOT mean zero output storage: the solver returns a
scalar record through its ABI descriptor. Input copies, descriptors, scalar locals,
compiler graphs and host objects remain. The implementation forms no Jacobian,
normal-matrix buffer, runtime operator object or iteration-history array.
No performance advantage over equivalent hand-inlined scalar source is claimed.

One-less loop allowances fail. One-less output-array capacity fails for the
chunk report; empty arrays use no output bytes. Fusion disabled uses two traversals
and fourteen units for the report. Nested action work shares the invocation meter:
a scalar solve with a three-step reduction inside its action uses exactly ten
units, comprising initial action, one iteration/search action and final action.
No solver-private unmetered loop or raised compiler budget exists.

## Compatibility and limitations

All 904 existing corpus builds preserve bytes, ABI and JTE certificates. The 98
existing AD experiment cases produce 624 successful and 160 expected-error builds
across eight modes. All successful ABIs/certificates and results or Wasm traps
match; all expected diagnostic triples match. Of the successful binaries, 576
change and 48 remain identical. A total byte-compatibility claim would be false.
Optimization-dependent budgets can become sufficient at a lower threshold after
eliminating duplicate work; no source effect or guard is skipped by that change.

Renaming every new library function produces the same Wasm: there is no privileged
operator-body recognition. Core-only linkage produces the same bytes. Existing
parser, inferred-type skeletons, ABI layouts, effect grants, source limits and
primitive inventory remain unchanged. Unsupported differentiation through array
reductions remains unsupported. Tests cover ordinary source locations, malformed
shapes, function-ABI rejection, primal guards, raw calls, cache snapshots,
prepared input leases, returned ownership and reuse after traps.

The written proofs cover the abstract operators and the two narrowly specified
core rewrites. No proof assistant, independent formal audit, universal numerical
convergence, historical novelty, human-readability study or throughput benchmark
is claimed. Matrix-free does not remove scalar-graph growth, ill-conditioning,
finite dimensional shape limits or the cost of repeated operator applications.
