# Kernel-local alternatives: validation checkpoint

[Contract](ALTERNATIVES.md) · [Implementation](IMPLEMENTATION.md)

## Provenance and status — September 18, 2026

Fresh GitHub reads found `main` at
`93ee7f253b00c470a56b27091bb278764700c98f`, tree
`6e6c53b476592e88abdaeb84887bb0018bb3cc65`, with no open pull requests. PR #42
is merged. GitHub Actions run `35270399166` is successful for that exact main.
Its retained artifact `10518349029` supplied `validation-source.tar`; a fresh local
Git index reproduced the main tree SHA exactly before this candidate was rebuilt.
No older working directory was trusted.

This change resumes the durable branch
`automation/source-alternatives-checkpoint-20260918`. The branch already preserved
the theory-first design and source experiment after an earlier local full-suite
blocker. This pass reconciled the design with the discovered rank-1 inference limit,
registered the examples, documented the source-library/core boundary and reran the
available checks from the exact reconstructed main source.

This remains a **checkpoint, not a main publication** because the repository's
required unsuffixed `npm test` command did not complete in the available execution
environment. Main must not be advanced until that exact check reaches its final TAP
summary on the same candidate content.

## Implemented behavior

`lib/alternatives.ass` provides source-only `either_left`, `either_right`,
`either_match`, left/right maps, `either_bimap`, and a `Maybe` specialization.
Runtime selection may carry unrelated payload types without a fake payload for the
other branch, provided the dynamic elimination has one shared handler result type.
The implementation reuses ordinary staged closures and the existing conditional
callable lowering. There is no parser form, compiler primitive, runtime tag table,
guest closure allocation or ABI change; the audited callable core remains 33
compiler primitives plus four source-prelude functions.

The important limit is explicit: rank-1 inference does not make the Church result
parameter universally hidden inside a first-class `Either A B`. A statically known
constructor may erase the ignored handler's result constraint. Encoded alternatives
must be eliminated before ASABI or stream-element boundaries. This is a useful
kernel-local abstraction, not a genuine stored algebraic sum type.

## Fresh completed checks

Environment: Node v22.16.0, npm 10.9.2, Linux x64, Chromium 144.0.7559.96.
No compiler limit, assertion or production contract was relaxed.

| Command / check | Fresh result |
| --- | --- |
| `npm run test:alternatives` | 8/8 passed |
| `node --test test/expanded-corpus.test.mjs` | 108/108 passed, including both registered examples in four scalar/SIMD × fusion modes |
| `npm run example:alternatives` | Passed |
| `npm run example:host` | Passed |
| `npm run example:reducers` | Passed |
| `npm run example:case-studies` | Passed |
| `npm run build:example` | Passed; standard `energy.ass` CLI build still emits and explains Wasm |
| `npm run test:docs` | 26/26 passed |
| `npm run audit:core` | Passed; 33 compiler primitives + four source-prelude functions |
| `npm run check:prelude` | Passed |
| `npm run check:operators` | Passed |
| `npm run test:browser -- --output /mnt/data/alternatives-browser.json` | PASS: 2,622 core checks + 276 experiment checks / 138 experiment cases |
| `npm run test:browser:http` | Attempted; `net::ERR_BLOCKED_BY_ADMINISTRATOR` |

The focused suite executes emitted Wasm through `createRuntime` in all eight SIMD ×
reduction-fusion × memoization configurations. It includes a seeded 64-case value
family per mode, constructor/mapping laws, dynamic handler type rejections in unused
definitions with source locations, selected-handler guard demand and post-trap reuse,
ABI escape rejection, explicit-expansion/renaming artifact comparisons, and an
array-producing handler with exact output-capacity and loop-budget checks.

## Required full-suite blocker

The exact repository command `npm test` was attempted twice on this candidate:

- a 900-second run reached `ok 1407 - captured effects retain one issued call when
  used by shared seeds`;
- a second 1,500-second run again reached that same `ok 1407` and did not advance
  to the final TAP summary before the execution harness terminated it.

Neither retained log contains a `not ok` line, but partial output is not a pass.
The successful main CI validates only the base commit. The candidate therefore is
not eligible to advance `main` in this pass. The HTTP policy failure is reported
separately and was not bypassed.

## Resource observations

No timing or performance claim is made. The scalar executable examples use no guest
memory, loops or intermediate buffer:

| Resource | distinct-payload Either | Maybe |
| --- | ---: | ---: |
| Complete module bytes | 510 | 555 |
| ABI version | 1 | 1 |
| Runtime loops | 0 | 0 |
| Intermediate guest bytes | 0 | 0 |
| Guest memory required | no | no |
| Scalar graph nodes | 9 | 6 |
| Wasm locals / logical local bytes | 9 / 64 | 5 / 36 |
| Syntax nodes / inference constraints / staging work | 275 / 339 / 123 | 203 / 267 / 158 |

The focused array case still uses one ordinary Wasm loop and normal owned array
output; it accepts exactly 32 output bytes for four `Num` values, rejects 31, and
uses the existing loop allowance rather than hiding work in the eliminator.

## Prior art and next action

Böhm and Berarducci's 1985 typed-lambda encoding of term algebras is established
prior art (Theoretical Computer Science 39, 135–154,
DOI `10.1016/0304-3975(85)90135-5`). The University of Pisa publication record was
rechecked on September 18, 2026. No novelty claim is made.

The next action is validation, not new design: rerun the exact unsuffixed `npm test`
in an environment where it can reach its final TAP summary on this same checkpoint.
If it passes, rerun the exact-tree docs/audits and supported browser engine, re-read
main, reconcile any advance, and only then use a normal non-forced fast-forward.
A future genuine tagged alternative should be justified by concrete storage/stream
use cases and separately specify sum inference, exhaustiveness and ABI layout.
