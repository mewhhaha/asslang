# Source-defined alternatives: validation checkpoint

[Contract](ALTERNATIVES.md) · [Implementation](IMPLEMENTATION.md)

## Provenance and publication status — September 18, 2026

This is a **blocked checkpoint, not a publication validation report**. Fresh GitHub
reads found main at `93ee7f253b00c470a56b27091bb278764700c98f`, tree
`6e6c53b476592e88abdaeb84887bb0018bb3cc65`, with no open pull requests and a
successful exact-main GitHub Actions run `35270399166`. Its retained artifact
`10518349029` contains `validation-source.tar`; extracting it and writing a local
Git tree reproduced `6e6c53b476592e88abdaeb84887bb0018bb3cc65` exactly.
No old workspace was reused.

The theory-first remote commit object is
`5808075050192200e2146aaa7fa61c1755b34be4`, tree
`430dd505b21a10d613c35af7807c493b5c013763`. It is parented directly on the live
main commit but main was not advanced. The durable handoff branch is
`automation/source-alternatives-checkpoint-20260918`. It retains the theory,
source library, focused regression suite and executable examples, but intentionally
is not a publishable replacement for the fully integrated local candidate because
the required unsuffixed `npm test` command could not complete in this execution
environment. Per repository policy, partial test output is not relabeled as a pass
and the implementation is not published to main.

## What was implemented

`lib/alternatives.ass` adds ordinary-source `either_left`, `either_right`,
`either_match`, maps/bimap, and a `Maybe` specialization. A dynamic conditional may
select constructors with unrelated payload types, and later elimination supplies
one handler per branch. This removes placeholder success/error payloads from
kernel-local programs while reusing the compiler's existing staged callable-choice
lowering. There is no parser form, compiler primitive, runtime tag table, guest
closure allocation or ABI change; the core remains 33 compiler primitives plus
four source-prelude functions.

The fully integrated local candidate also registered both examples in the expanded
corpus, added npm scripts, documented the library in the core inventory and docs
index/implementation guide, and appended the automation journal. Its exact local
Git tree was `b35959eea3a9900cf346c337eb67610b811d1fa3`. Those integration edits are not
claimed to be present on this checkpoint branch; they must be reconstructed and
revalidated rather than treated as published source.

Experimentation found an important limit and the design must be read with this
correction: Asslang's rank-1 Hindley–Milner inference cannot express the inner
universal result type of a Church sum. A dynamic left/right conditional unifies the
callable shapes and therefore ties both handler results. A statically known
`either_left`, however, can leave the ignored right handler's result type
unconstrained. The library is therefore an eliminator-encoded kernel-local choice,
**not** a genuine algebraic sum type and not a substitute for a future native
tagged representation.

## Fresh checks that completed on the integrated candidate

Environment: Node v22.16.0, npm 10.9.2, Linux x64, Chromium
144.0.7559.96. No compiler limit, assertion or language contract was weakened.

| Command / check | Result |
| --- | --- |
| `npm run test:alternatives` | 8/8 passed |
| `node --test test/expanded-corpus.test.mjs` | 108/108 passed, including both new examples in four scalar/SIMD × fusion modes |
| `npm run example:alternatives` | Passed; outputs and resource observations below |
| `npm run example:host` | Passed |
| `npm run example:reducers` | Passed |
| `npm run example:case-studies` | Passed, including both registered alternatives examples in scalar/SIMD runs |
| `npm run test:docs` | 26/26 passed on the final local checkpoint tree |
| `npm run audit:core` | Passed; 33 compiler primitives + four source-prelude callables unchanged |
| `npm run check:prelude` | Passed |
| `npm run check:operators` | Passed |
| `npm run test:browser -- --output .../browser.json` | PASS: 2,622 core checks + 276 experiment checks / 138 experiment cases |
| `npm run test:browser:http` | Attempted; failed with `net::ERR_BLOCKED_BY_ADMINISTRATOR` |

The focused suite exercises all eight SIMD × reduction-fusion × memoization
configurations. It checks unrelated branch payloads, `Maybe`, maps/bimap, 64 seeded
oracle cases per mode, constructor/mapping reductions, selected-branch guard demand,
post-trap reuse, dynamic type mismatches inside unused definitions, source names and
offsets, ABI rejection, helper renaming, byte-identical explicit expansions, array
output capacity and exact loop budgets. All executed values come from emitted Wasm
through `createRuntime`; the JavaScript oracle only supplies expected values.

Across eight modes, a representative helper call and its explicit eliminator
expansion have identical Wasm bytes, ABI metadata and JTE certificates. Renaming all
library functions also preserves the emitted Wasm. These finite comparisons are
compatibility evidence, not a proof of contextual equivalence or parametricity.

## Required full-suite blocker

The exact repository command `npm test` was attempted repeatedly with output
retained outside the source tree. It did not report an assertion failure, but the
local Node test runner did not finish before the execution harness limits:

- a 300-second attempt reached 551 reported passing subtests;
- a 600-second attempt again reached 551 reported passing subtests;
- a final 900-second unsuffixed attempt reached 550 reported passing subtests and
  no `not ok` line before termination;
- a diagnostic run showed the test parent actively running CPU-heavy theory-test
  child processes rather than an idle deadlock.

A reduced-affinity experiment was slower and is not counted as validation. Because
`npm test` did not reach its final TAP summary, there is no full-suite pass for this
candidate. The successful historical CI for `93ee7f...` validates the base only; it
is not evidence for these changes. This missing check is the publication blocker.
No main update or fresh candidate CI is claimed.

## Resource observations

No timing benchmark was run. The scalar examples have no loops, no intermediate
buffer and no guest memory at all; their scalar arguments/results stay in the ABI
value slots.

| Resource | distinct-payload Either | Maybe |
| --- | ---: | ---: |
| Complete module bytes | 510 | 555 |
| ABI version | 1 | 1 |
| Guest memory required | no | no |
| Runtime loops / state machines | 0 / 0 | 0 / 0 |
| Intermediate guest bytes | 0 | 0 |
| Scalar graph nodes | 9 | 6 |
| Wasm locals / logical local value bytes | 9 / 64 | 5 / 36 |
| Syntax nodes / inference constraints / staging work | 275 / 339 / 123 | 203 / 267 / 158 |

A separate selected-array fixture emits one ordinary loop, zero state machines,
zero state slots and zero intermediate-buffer bytes. Four `Num` results require
exactly 32 output bytes; 31 traps. Its exact loop allowance is four visited units;
three traps. The compiled module is 1,044 bytes and requires guest memory only for
normal array output. This demonstrates that the eliminator does not hide array
materialization or work.

## Prior art, limits and next action

Böhm and Berarducci's 1985 typed-lambda encoding of term algebras is prior art for
eliminator-style representations (DOI `10.1016/0304-3975(85)90135-5`). This pass
claims no novelty. The project-specific result is narrower: existing staged
callables can remove dummy payloads for dynamic kernel-local choices without
widening the compiler core, while rank-1 inference precisely marks where the
encoding stops short of a genuine sum type.

The checkpoint must not be merged or fast-forwarded to main until a fresh execution
of the exact full Node suite completes successfully on the same implementation
content, followed by the exact-tree documentation/audit checks and normal
fast-forward publication. If that succeeds, the next design question is whether a
first-class tagged alternative type earns its core/ABI complexity from concrete
storage or stream use cases rather than from this kernel-local case alone.
