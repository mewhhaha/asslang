# Structured diagnostics and non-executing checks

## Problem and contract

Before this change, the compiler exposed an error code and a source offset, but
the compact formatter and playground worker reduced them to a string. Callers
had to parse human text to locate a problem, and checking an effectful export
in the playground attempted execution. The next developer-facing layer
must preserve compiler facts without changing which programs compile or which
capabilities authorize execution.

The implementation adds `CompileError.toDiagnostic(source)`,
`formatDiagnostic(diagnostic)`, `check(source, options)` and
`checkSources(files, options)`. Compiler sessions expose the same check methods.
Existing `compile`, `compileSources`, exception codes, compact `error.format`,
ASABI 1, and optimization defaults remain compatible.

## Representation and semantics

A check uses the **entire existing compile pipeline**, including staging, JTE,
Wasm emission and binary validation. Success is not merely a parser/typechecker
result. It never instantiates a runtime, executes an export, or invokes a host.
It returns a versioned, JSON-serializable report containing `ok`, `diagnostics`,
and, on success, export signatures and export descriptions. Wasm bytes, timing
measurements and source text are not retained in successful reports.

An expected `CompileError` produces one diagnostic and `ok: false`. This is a
fail-fast interface, not parser recovery or multi-error analysis. Invalid API
arguments and unexpected internal failures still throw; they must not be
misreported as errors in the user's program. Session checks reuse the existing
bounded artifact cache, without caching failed checks or caller source names.

Each diagnostic includes its code, severity, message, compiler phase, source name,
a nullable range, and a nullable bounded source frame. Offsets and columns count
JavaScript UTF-16 code units. Lines and columns are one-based; offsets are
zero-based. The range is a **point** (`start === end` by value): current compiler
offsets do not justify inventing a semantic end span. EOF is a valid point.
CRLF counts as one line break; lone CR and LF also break lines. A missing source
or invalid offset yields no range/frame rather than a fabricated location.
Named builds use file-local offsets, preserving the existing absolute offset
when available. Bundle-level errors without a source name are not arbitrarily
assigned to the last input file.

The source frame contains a bounded window of the error's line. Rendering adds a
caret, expands tabs and escapes terminal controls and bidirectional formatting
characters. JSON retains raw UTF-16 coordinates for tools; rendered display
columns are best-effort monospace, not a Unicode grapheme/cell-width guarantee.
Diagnostic messages are bounded and marked when truncated. Rendering does not
inject HTML, ANSI colors, or auto-fix source.

## Interfaces

`--check --diagnostics=json` emits exactly one check report on stdout, no build
artifacts, and exit status 0 for success or 1 for failure. This mode rejects
execution, output and explain flags rather than mixing JSON with other output.
Driver/option/I/O errors are also reported as JSON, but have no fabricated source
range. Default CLI compile errors gain source frames while the compact error API
remains unchanged. `--diagnostics=text` explicitly selects human output.

The playground gains a separate Check action that does not parse runtime arguments
or grant host capabilities. It uses the existing cancellable worker and deadline.
Compile failures carry diagnostics as data as well as rendered text. The UI offers
an explicit action to move the source caret to the diagnostic point, and refuses
to navigate if the editor has changed since the checked snapshot. Runtime failures
remain runtime errors, not invented compiler diagnostics.

## Alternatives and trade-offs

Parsing existing strings is fragile and loses offsets. Making every compiler
entry point non-throwing would be a breaking change. Changing the parser to
recover multiple errors or produce full spans is a separate compiler project.
Introducing an editor framework or language server now would add an unrelated
transport/lifecycle surface before the diagnostic data contract is established.
This PR instead creates a small browser-compatible data/formatting layer and
exercises it through the API, CLI and playground, with no new dependencies.

## Resource and authority invariants

All existing source, parse, expansion, schema and cache limits remain in force.
Source location scanning is linear in the prefix of the provided source; frames
retain at most 160 source code units, and diagnostic messages at most 4096.
Success reports do not retain binaries or source snapshots. Existing errors and
caller inputs are not mutated by presentation. Check compilation may allocate
normally and is not a time sandbox; worker termination is still the playground's
execution deadline. Check mode creates no runtime and accepts no capabilities.

## Usage and report fields

```js
import { checkSources, formatDiagnostic } from './src/compiler.mjs';

const report = checkSources([
  { name: 'helpers.ass', source: 'fn twice = x -> x * 2;' },
  { name: 'app.ass', source: 'export fn main = (x: Num) -> twice x;' },
]);
if (report.ok) console.log(report.signatures);
else for (const diagnostic of report.diagnostics)
  console.error(formatDiagnostic(diagnostic));
```

```sh
node src/cli.mjs examples/concepts/reducer_toolkit.ass \
  --lib lib/reducers.ass --check --diagnostics=json
npm run test:diagnostics
```

Reports have `schemaVersion: 1`. A success contains `ok: true`, an empty
`diagnostics` array, `signatures` (the inferred signature map) and `exports`
(the compiler's export descriptions). Failure contains `ok: false` and one
entry in `diagnostics`, without success-only fields. The compiler's existing
`RangeError`-to-`E_LIMIT` normalization is retained; other unexpected errors throw.

A diagnostic's `range.start` and `range.end` each contain `offset`, `line` and
`column`; they are independent point objects. `absoluteOffset`, when present,
addresses the linked bundle. `frame` contains `line`, bounded `text`, a UTF-16
`markerOffset` into that text, and `truncatedStart` / `truncatedEnd` flags.
`messageTruncated` distinguishes bounded messages from complete ones. `phase`
is `source`, `parse`, `infer`, `stage`, `emit`, `validate`, or null when unknown.
CLI failures outside the compiler use `driver`, with codes such as `E_OPTIONS`
and the filesystem's `ENOENT`; they are not attributed to an arbitrary source.

`CompileError.toDiagnostic(source)` can also be used with existing throwing APIs.
Omitting source leaves location unavailable. `formatDiagnostic` accepts a report's
diagnostic or a JSON round-trip of one. Source frames cover a single line, not a
whole expression. Columns count raw UTF-16 including tabs; rendered tabs expand
at four-column stops. A point between CR and LF remains before the completed
line break. There are no inferred hints, semantic spans, or automatic edits.

## Validation plan

Run the baseline and full Node suite, both host/reducer examples, and Chromium
engine checks. Add positive, negative, phase, source-location, multi-file, EOF,
CRLF, Unicode, tabs, control-character, truncation, resource-limit and cache tests.
Check both optimization modes. Exercise CLI JSON/text output, option and file
errors, stdout/stderr separation, and no-output/no-execution invariants. Exercise
the real worker handler and source navigation with changed-editor protection.
Run HTTP browser checks when permitted and distinguish them from in-memory engine
checks. Record actual results and any limitations in a new validation report;
do not rewrite historical benchmark evidence.

See [executed validation and limitations](DIAGNOSTICS-VALIDATION.md).
