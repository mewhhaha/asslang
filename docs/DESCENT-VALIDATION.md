# Descent certificate validation

## Revision and source integrity

The starting point is main `13c52a7fa20f7133f88fcf6229f66aa9ab620567`, with tree
`5b677be6fd1fa8ddd587fb89eb82126f431390a3`. Its downloaded GitHub Actions source
archive reconstructed that exact tree. The unchanged local baseline passed all
877 Node tests. The theory document was written and locally committed before
implementation and is published ahead of the feature commit.

This change adds `src/descent.mjs`, exports its three helpers through the compiler,
and integrates an executable example and browser checks. No parser, inference,
JTE, emitter, ABI, effect authority, loop accounting, workflow permissions or
dependencies were changed. Previous validation reports remain historical records.

## Executed local checks

Environment: Node v22.16.0, Linux x64, Chromium 144.0.7559.96. Results were obtained
on 2026-09-10. These are local results, not claims about a remote CI run.

| Command | Result |
| --- | --- |
| Unchanged baseline `npm test` | 877 passed; zero failures/skips |
| `node --test test/descent-theory.test.mjs test/descent.test.mjs` | 29 passed |
| `npm run test:descent` | 61 passed, including existing reconstruction/integration suites |
| `npm test` | 906 passed; zero failures/skips |
| `npm run example:descent` | Passed; two overlap tests replace five and invalid joins trap |
| `npm run example:host` | Passed |
| `npm run example:reducers` | Passed |
| `npm run example:reconstruction` | Passed |
| `npm run example:case-studies` | Passed |
| `npm run build:example` | Passed |
| `npm run test:browser -- --output /mnt/data/descent-browser.json` | 1,152 core checks and 276 experiment checks passed (138 experiment cases) |
| Node syntax checks for added/modified modules | Passed |
| `git diff --check` | Passed |

## Mathematical verification

The finite exhaustive suite covers every directed graph on zero through three
vertices without self-loops, every ordered cover by zero through three
successor-closed patches, and every subset of legal pairwise coordinate tests.
Empty patches and repeated domains are included. There are 3,251 graph/cover
configurations and 82,172 certificates. A separate Floyd-closure/Boolean-adjacency
oracle agrees with the production verifier for every certificate.

For each configuration, exhaustive subset minimization agrees with the planner's
minimum number of comparisons and with its minimum cost for the coordinate cost
profile `(v+1) mod 3`. This includes zero-cost coordinates. It is not an enumeration
of all real-valued weight assignments. The general cost theorem has a written
lower-bound proof and matching construction in `DESCENT.md`.

For all 42,274 insufficient certificates in the exhaustive family, the test
constructs the canonical quotient-class countermodel: arrow maps are well-defined,
all chosen comparisons hold, and some copies still disagree. Maps on paths extend
by composition. This establishes actual counterexamples rather than merely a
negative graph-algorithm answer.

A separate semantic enumeration checks all 16 assignments of Boolean maps to the
two-arrow three-coordinate example, and all 128 resulting locally coherent
families. The selected two comparisons pass exactly when a unique global section
extends those particular records. Another 200 seeded larger covers test complete
certificates and failure after deleting any selected comparison. Additional
examples cover cycles, loops, parallel arrows and minimum-cost representatives.

The mathematical results have not been checked in Lean, Coq or another proof
assistant, nor reviewed by an independent mathematician. Finite tests corroborate
the written proofs but do not replace them. The exact formula's historical
originality is unverified; standard descent and sheaf equalizer theory are cited
as established foundations, not presented as inventions.

## Compiler, boundary and resource evidence

All eight SIMD/fusion/memoization configurations are exercised for checked joins,
explicit budgets, demand and streams. For the selected three-patch example,
generated agreement and unchecked assembly produce byte-identical Wasm to their
handwritten counterparts, both without a loop budget and with budget zero.
This is evidence for those exports, not a general runtime speedup or all-program
erasure theorem. The example has two overlap comparisons instead of five; full
checking still includes four local edge equations.

The first agreement generator used `&& true` to impose a Boolean type, and the
byte comparison exposed an extra runtime branch. A typed identity now enforces
Bool with no residual branch in the measured case. This was fixed in source
generation, without adding a global optimizer rewrite. Invalid single-comparison
return types still fail inference.

A two-comparison workload consumes three plus four loop units: seven succeeds,
six traps, including raw Wasm invocation and fresh allowance after a trap. Two
local coherence arrows each traverse `range 4`: eight succeeds and seven traps.
Generated helpers do not create another invocation boundary. Unused pure maps,
patch values and checks are not demanded, and projecting a `join` result still
demands its validation guard.

Tests retain source-local errors, cache snapshot independence, mixed product and
Boolean types, lexical captures, rejection of host functions as pure maps,
protocol ABI rejection, causal stream access and event-domain separation. A
non-successor-closed patch or incomplete cover fails at build time. Invalid names,
input shapes, injection strings and mutable-name/cost accessors are covered.
Snapshots are deeply frozen and do not freeze the caller's records.

The largest membership plan tested has 256 vertices and eight full patches
(2,048 memberships). The maximum 32-patch, one-coordinate join compiles and runs.
A checker with 4,096 local equations (two copies of 2,048 parallel self-loop
arrows) compiles and runs, including NaN rejection with its supplied comparator.
These do not establish that every graph/type at the limits compiles: normal
source, inference, staging and ASABI limits remain in force, including the
128-field-per-record ABI bound.

## Equality and browser limitations

The reduced certificate is sound with genuine equality and coherent local
sections; with equivalence predicates it additionally requires maps to preserve
them. Regression tests deliberately demonstrate two violations: a nontransitive
approximate predicate, and ordinary numeric equality combined with reciprocal
at +0/-0. Both can make compressed checks accept when an omitted direct comparison
would fail. Neither the helper nor the compiler proves these laws. `agree` also
assumes local coherence; a malformed downstream value passes agreement but is
rejected by `check`/`join` under the example's lawful semantics.

The new browser module contributes 31 assertions to the engine-only bundle,
using its real compiler exports and Wasm engine. It covers the two-versus-five
certificate, incomplete proof rejection, full joins, local-coherence boundaries,
no new guest allocator, exact loop allowances and trap recovery across four
SIMD/fusion combinations. HTTP module loading, playground-worker loading, other
browser engines, throughput benchmarks, and proof-assistant verification were not
run. The new descent-specific browser cases are not wired into the separate HTTP
harness; this is explicit rather than a claim of HTTP coverage.
