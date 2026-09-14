# Publishing source machines after operator composition

[Machines](CLOCKED-MACHINES.md) · [Sensitivities](MACHINE-SENSITIVITY.md)

## Integration contract before edits

The prepared machine package was based on `12754f5b`, with tested tree
`5e050da84363de3208f29ab7404f8f4da5ad1759`. Main now includes PR #38 at
`4ae4c1e5e9afb3f6682abfda4bc6d58d12ccbd5f`, tree
`d976ce352e6f82fbc7e92358068aa6fb8fa02f06`.

Publish the source machine libraries on this current main, not as a conflicting
old-base branch. Preserve the operator libraries, tests, examples, registrations,
and its three compiler repairs. The machine change itself must not edit `src/`.
Combine documentation, corpus, npm scripts, and browser registrations additively.
Do not reinterpret source protocols, checkpoints, differentiation, demand, or
loop/scratch allowances. Do not change the root README or workflow permissions.

The original machine validation report remains evidence about its original base,
not a claim about the newly integrated compiler. Retain it and record fresh runs
here. Rerun both machine suites, operator suites, documentation, core/prelude audit,
required examples, full Node tests, and the browser suite when available. Check
that the published tree equals the tested integrated tree and that all main
compiler files remain byte-identical. No main ref update or force push is needed.

## Source semantics and representation

A machine is the existing reducer record {initial, step, finish}. Serial
composition stores {left,right}; one event advances left, observes its NEW state,
and uses that observation to advance right. Products and held updates reuse
reducers. A reset chooses the declared initial state before the current step;
a resume checkpoint does not change that reset target. Empty scans retain lazy
initialization. Helpers and dictionary fields stage away; recurrence fields and
requested final output arrays remain ordinary scalar state and ABI storage.

The optional numeric lift stores {value,tangent}. For s'=F(s,a), its tangent is
DF(s,a)(ds,da); observation H has tangent DH(s')ds'. Induction over events and
the chain rule justify forward sensitivity and lifting serial composition up
to product-state reassociation. Captures are constant unless explicitly seeded.
Only supported numeric per-step graphs qualify; this does not differentiate
scan in the compiler, support Boolean tangents, or create a reverse tape.
P state leaves become 2P leaves per direction, independent of prefix length.

Do not replace explicit shared-prefix construction with automatic merging of
independent histories. Do not add a rolling/reassociated floating-point rewrite.
Nested work can still prevent output fusion; checkpoint descriptors, input arrays,
requested traces, and host/compiler allocations are not zero memory. Existing
expansion, loop, effect and ABI limits continue to apply. Source dictionaries
carry ordinary values, not compiler-verified algebraic laws or authentication.
