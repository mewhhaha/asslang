# Unary syntax validation

## Scope and baseline

The theory-first commit adds AGENTS.md, the documentation index, implementation
theory, and the syntax design before the implementation commit. The baseline is
`c29fa76839d53fbbb84f9ce92dcd5881c10c9691` (main). Its source was recovered from the
successful CI validation archive; the reconstructed tree matches
`ae327aadaa729d9d61db7e599300cd702d9bb26e`.

The implementation adds the canonical parser in `src/unary.mjs`, connects it to
the existing frontend, and makes function unification/staging curry-compatible.
Tuple syntax reuses closed records; it does not add an ASABI kind. Legacy syntax
is deliberately retained for migration. Formerly invalid partial applications
can now be accepted; previously valid legacy programs retain their semantics.

## Executed checks

On Node v22.16.0, `npm test` passed **260 tests**, including all **215 baseline
tests** and **45 unary-syntax tests**. The new tests exercise 26 shared execution
cases with default and optional fusion lowering, plus exact tuple shape, unit,
pattern renaming/nesting, annotations, source locations, malformed/truncated
input, nesting/node limits, occurs checks, recursion, ABI restrictions, host
capabilities, legacy source linking, deterministic artifacts, cache isolation,
CLI execution, and 100 seeded comparisons against hand-written JavaScript.

`npm run test:browser` passed **692 Chromium checks**, including 53 new checks for
canonical expressions and host sequencing. The shared syntax cases execute with
fusion disabled and enabled. The browser identifies itself as HeadlessChrome
144.0.0.0 in this environment. HTTP module loading and playground-worker loading
remain unvalidated by this engine-only harness; this is not an end-to-end browser
UI claim.

`npm run example:host`, `npm run example:reducers`, and `npm run build:example`
passed. The existing frozen ASABI compatibility tests and JTE/capability/causal
suites remain part of the full Node run. `git diff --check` is also required
before publication.

## Parser measurements, not a universal speed claim

`npm run bench:syntax` runs tokenization, parsing, and syntax lowering only. The
checked-in [raw report](syntax-benchmarks-node.json) includes workload source
hashes, source sizes, token/node counts, machine details, warmup, sample count,
and batch size. It excludes inference, staging, Wasm emission, and execution.

For a before/after legacy check, run:

```sh
node scripts/bench-syntax.mjs --baseline /path/to/baseline-checkout --output report.json
```

In this local run, 400 unchanged legacy helpers parsed in a median 0.796 ms versus
0.786 ms at baseline. The corresponding canonical helper workload took 1.526 ms;
it contains more source characters and performs arrow/pattern lowering, so this
is **not evidence that canonical syntax is faster than the old syntax**.
The design improvement is deterministic, bounded parsing without speculative
pattern scans. Wide tuple-pattern medians were 0.075, 0.206, and 0.808 ms at widths
64, 256, and 1000 respectively. These are workload observations, not an asymptotic
proof, a latency guarantee, or a CI timing gate.

A first measurement exposed an unnecessary delimiter-index pass on legacy-only
files. The theory and implementation were revised to construct that index lazily
only when a canonical declaration is encountered. Parsing still enforces source
and syntax-node budgets; canonical syntax also has a 256-level nesting budget.

## Deliberate boundaries

Functions and partial applications remain static compiler values. Exporting a
closure or accepting a function through ASABI is unsupported. Canonical export
chains retain the existing flat host argument convention. Tuples cross that
boundary as positional records (`_0`, `_1`, ...), not JS arrays. There is no
nominal tuple/record distinction. Record-pattern rows may be open internally but
export boundaries must resolve to a concrete schema. Host calls must remain direct
and saturated; no first-class impure partial application is introduced.
