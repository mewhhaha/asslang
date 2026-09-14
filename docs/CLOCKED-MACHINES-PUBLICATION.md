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

## Executed publication checks

September 14, 2026; Node v22.16.0, Linux x64, Chromium 144.0.7559.96.
The CI archive for PR #38 reconstructed current main's tree exactly. Applying
the prepared source change produced five additive conflicts: docs/EVIDENCE.md,
docs/README.md, examples/expanded-corpus.mjs, package.json, and test/browser.mjs.
Both sides' registrations were retained. Source libraries, examples, and tests
from the prepared machine package are unchanged. All 33 current-main compiler
modules, the root README, existing operator files and workflows are unchanged.

| Completed check | Result |
| --- | --- |
| Full `npm test` on integrated source | 1,651 passed; no failures/skips |
| Machine, sensitivity and operator focused suites | 99 passed (33 + 19 + 47) |
| Documentation suite | 26 passed |
| Chromium engine | 2,217 core + 276 experiment checks passed |
| Actual current-main compatibility | 115 ASTs; 920 binaries, ABI objects and certificates identical |
| Core audit / prelude snapshot | Passed; 30 primitives and 4 source-prelude names |
| Required host/reducer and machine/sensitivity/operator drivers | Passed |

These fresh results supersede neither feature's historical report: they validate
the combined source at this publication. In particular, the original machine
report's 1,600 tests and 2,145 browser checks are original-base results only.
The sensitivity driver now emits 3,865 bytes for the full report and 2,887 bytes
for checkpoint-only output, rather than the old-base 4,064 / 3,081 bytes. The full
report uses 344 local-value bytes. Both variants retain one loop, four recurrence
slots and a four-unit allowance. These changed byte counts come from retained
PR #38 compiler fixes, not compiler modifications by the machine library PR.
The checkpoint-only descriptor is 32 bytes; it needs zero output-array bytes.
No timing improvement or machine-checked proof follows from these measurements.

The published commit and remote CI status are recorded in the PR discussion.
No main ref update, merge, or force push is part of publication. Exact-tree
verification guards against upload transcription differences; the source tested
locally is the source intended for publication. The historical machine report's
HTTP-policy failure is not a current HTTP success, and engine tests alone do not
validate HTTP/worker loading or other browser engines.

The fresh HTTP browser attempt also failed with
`net::ERR_BLOCKED_BY_ADMINISTRATOR`. No policy was changed or bypassed.
