# Old-state feedback: design before implementation

## Problem and source boundary

Merged main d47539f51deb935cac721a92bc2ddfa0f044b763 has source machine
composition but no named way to close an existing pipeline over its previous
state. Add machine_feedback in an explicitly linked source library, not a new
compiler primitive, recursive definition, runtime closure, or feedback array.
Preserve all existing compiler files, APIs, ABI layouts, effects and limits.

## Semantics and invariants

For body {initial,step,finish} and observation h, retain initial and finish and
replace its transition by step(s,a)=body.step(s,{input:a,feedback:h(s)}).
Feedback reads OLD state. Serial machine_then still passes its left stage's NEW
output into its right stage. Product lanes read one immutable old snapshot;
there is no in-place partial update or instantaneous fixed-point equation.
The initial observation is h(body.initial) only when the first event needs it.
Resume observes the supplied checkpoint; an outer reset changes that observation
before processing its current input. Resetting a stage inside an open body is
not equivalent. Held updates retain the existing clock and state.

Normal source inference checks ports, observer and state. Existing scan rules
still govern scalar-product state, strict next-state fields, lazy observations,
empty inputs and stopped suffixes. An ignored observer remains undemanded.
No new effect authority or finite-value guarantee is implicit in the adapter.

## Representation, cost and alternatives

The closed machine has exactly the body's state shape. Source staging erases the
wrapper; no extra delay field, descriptor, scratch allocation or stored trace is
needed. Observer computations can still add work, locals, nested reductions or
nested state. Compatible dense consumers may share the normal output cohort;
other consumers retain existing replay. Final arrays and host copies still use
memory. Do not claim arbitrary feedback is stable, constant-time or always fused.
An unrestricted ArrowLoop/fixed-point operation would have different semantics;
manual scan rewrites would lose reusable stages; stored feedback would duplicate
information already derivable from state. None is required for this feature.

## Proof obligations and useful applications

Substitution followed by induction proves equivalence to explicit old-state port
wiring and defines a unique finite causal prefix. For differentiable numeric F,h,
closed transition derivatives are DF(s,(a,h(s)))(ds,(da,Dh(s)ds)). Check that
lifting a closed machine agrees with closing its lifted body after product-port
reassociation; the feedback tangent must not silently become zero.

Demonstrate error-feedback quantization by composing correction and rounding
stages. Over reals, corrected=x+oldError and error=corrected-quantized imply a
telescoping prefix-total identity; the unbounded uniform quantizer bounds the
residual to half a unit. This is not a general f64 accuracy theorem, ADC hardware,
compression format, or novel quantization algorithm. Keep finite-overflow and
large-quotient limitations explicit. Use a separate smooth tracker for AD.
Show checkpoint continuation versus independent chunk resets without arrays of
blocks, and compare the source wrapper with fully expanded wiring.

## Planned validation

Test all eight lowering configurations, old-state timing, simultaneous cross
feedback, outer/inner resets, held events, unused observers, empty seeds, stopped
suffixes, bad types and source locations, core-only/renamed source, effects,
raw/managed/prepared memory, exact loop/output capacities and long final-only
execution. Exhaust small dyadic quantizer sequences and compare independent
recurrences. Check nonlinear feedback sensitivities analytically and with whole
recurrence finite differences. Retain a costly observer counterexample.
Register actual examples and browser checks. Run full Node, documentation,
required host/reducer drivers, Chromium, the core audit and prelude snapshot.
Compare current-main corpus bytes/ABI/certificates and unchanged compiler files.
Record completed results separately before publication; no proposed check is a
pass, no timing improvement or formal verification follows from finite tests.

## Prior art

Haskell Control.Arrow documents fixed-point feedback, distinct from old-state
closure: https://downloads.haskell.org/ghc/8.2.1/docs/html/libraries/base-4.10.0.0/Control-Arrow.html
Error-feedback quantization is established: https://arxiv.org/abs/1609.01383
Sources checked September 14, 2026. No worldwide novelty, unrestricted trace laws,
proof-assistant verification, human readability study or independent audit is
claimed. This document will be reconciled with implemented examples and tests.
