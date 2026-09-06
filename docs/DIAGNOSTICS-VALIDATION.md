# Diagnostics validation — 2026-09-06

## Baseline and scope

Base: `34e9d70a08943a29e4d18dd38dfd1aa78861ae84` (`main`, after PR #4).
Direct checkout was unavailable in this environment. The successful main CI run
`34020423138` retained `validation-source.tar` in artifact `9985296900`; its
extracted tree was verified as `ec219af87190039526de417893b45edaedd243a2`, the
base commit's tree. The unmodified snapshot passed all 260 Node tests locally.

The design and documentation index were committed before implementation. This
report records the implemented diagnostic/check layer, not a language-server
implementation, parser recovery system, or performance optimization. ASABI,
language acceptance, compiler limits and capability rules are unchanged.

## Executed checks

Environment: Node v22.16.0, Linux x86-64, Chromium 144.0.7559.96
(HeadlessChrome 144.0.0.0).

| Command | Result |
| --- | --- |
| Baseline `npm test` | 260 passed, 0 failed |
| Final `npm test` | 312 passed, 0 failed; all 260 baseline tests retained |
| `npm run test:browser -- --output /mnt/data/diagnostics-browser-tests.json` | 787 checks passed; 95 additional engine checks |
| `npm run example:host` | Passed; explicit audit grant used, remaining calls 0 |
| `npm run example:reducers` | Passed; reducer output and one-loop lowering retained |
| `npm run build:example` | Passed; Wasm and metadata written to the existing /tmp target |
| `git diff --check` | Passed |
| `npm run test:browser:http` | Blocked: `net::ERR_BLOCKED_BY_ADMINISTRATOR` at HTTP navigation |

No dependencies or generated binaries are committed. Existing historical reports
are unchanged. This work does not claim a compiler or runtime speedup.

## New evidence

The 52 new Node tests cover 11 distinct language failures with fusion both off
and on; successful reports; expected-vs-unexpected exception boundaries; native
instantiation/compilation remaining untouched during checks; effectful and
trapping exports; named-source, duplicate-definition and absolute offsets;
CRLF/lone-CR/LF, EOF, tabs and UTF-16; seeded location comparisons; bounded frames
and messages; control/bidi escaping; snapshot isolation; and bounded cache reuse.

CLI tests verify single-document stdout, empty stderr in JSON mode, exit status,
linked-source diagnostics, option/I/O failures, human source frames, no new output
files and no mutation of existing binary/metadata files. JSON errors are recognized
even when an invalid option precedes the diagnostics flag.

Node invokes the real worker handler to check authority boundaries and diagnostic
transport. The Check path succeeds even when getters for runtime arguments,
export names and capability flags would throw if accessed. It rejects unknown
worker modes instead of accidentally executing. Runtime traps remain runtime
errors, without fabricated compiler ranges.

UI tests run the real `web/main.mjs` event handlers with explicit DOM/Worker test
doubles. They cover invalid argument JSON during Check, no requested grants,
caret navigation, edits during/after checks, cancelled workers and stale responses
that must not overwrite newer results. Chromium additionally exercises the
compiler diagnostics and navigation against an actual textarea with UTF-16
selection offsets.

## Limits and follow-on work

The Chromium result is the existing in-memory engine harness. Actual HTTP module
loading and playground module-worker loading were attempted but blocked by browser
policy. The HTTP suite includes new worker checks for environments that permit
navigation; they were not executed here. Node worker-handler tests and real DOM
selection tests do not substitute for this missing end-to-end coverage.

Diagnostics remain fail-fast and point-based. Display width is best-effort for
Unicode; machine offsets are UTF-16, not byte offsets or grapheme counts. Check
success proves compilation/validation, not runtime safety or termination. API
checks are synchronous and keep the compiler's existing limits; the playground
continues to enforce its existing cancellation deadline. Session checks retain
artifacts only through the existing bounded cache. No editor protocol, automatic
fixes, or multi-error recovery is claimed.
