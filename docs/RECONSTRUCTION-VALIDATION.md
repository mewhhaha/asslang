# Reconstruction basis validation

## Revision and method

The change starts from main `46296dd10de6fb80c79844dec02fc2a6298c0e88`
(tree `f1c17e791122b12817f06ed49309713234e6d03e`). The downloaded CI source
archive's embedded commit and reconstructed Git tree matched those identifiers.
Its unchanged baseline passed 783 Node tests. The theory document and index were
committed before implementation; the final theory reflects the implementation.

The feature adds `planReconstruction` and `reconstructionSource` through the
existing compiler entry point. It does not change parsing, inference, JTE, Wasm
emission, ABI schemas, or default lowering options. Its generated protocol is
ordinary Asslang. Browser bundle registration and browser integration checks
exercise the same source generator.

## Executed local checks

Environment: Node v22.16.0, Linux x64, Chromium 144.0.7559.96.

| Command | Result |
| --- | --- |
| `node --test test/reconstruction.test.mjs` | 25 passed, zero failures |
| `npm test` | 808 passed, zero failures, zero skipped |
| `npm run example:reconstruction` | Passed; six coordinates reconstructed from two seeds, exact missing component reported |
| `npm run example:host` | Passed |
| `npm run example:reducers` | Passed |
| `npm run example:case-studies` | Passed |
| `npm run test:browser -- --output /mnt/data/reconstruction-browser.json` | 1,105 browser checks and 236 experiment checks passed (118 experiment cases) |
| `node --check` for the new module and modified browser modules | Passed |
| `git diff --check` | Passed |

These are local execution results, not a claim that GitHub Actions has run.
The browser test used the repository's engine-only bundle. HTTP module loading
and playground worker loading are explicitly not tested by that mode. The Node
suite retains the existing real worker-handler tests; those do not prove browser
worker loading.

## Independent mathematical and implementation checks

The new suite exhausts all 4,166 directed graphs with zero through four vertices,
without self-loops, and all 66,067 graph/observation-set combinations. A separate
Floyd-style transitive-closure oracle checks source components, coverage, selected
bases, missing components, and forest reachability. Boolean-on-one-source and
singleton-elsewhere assignments witness the graph-only minimum disagreement.
Self-loops and parallel edges have separate tests. This is finite exhaustive
evidence, not proof-assistant verification or exhaustive verification at the
resource limits. The general cover/distance arguments are in the theory document.

The six-coordinate diagram has source component sizes two and three. Choosing
`a1` and `b2` reconstructs the whole record; retaining only `a1` and the downstream
sink reports the entire three-vertex source component as missing. Across all eight
SIMD/fusion/memoization settings, its unchecked scalar restoration export produces
exactly the same Wasm bytes as the handwritten record construction. This narrowly
supports staging erasure, not a general runtime or compilation speedup claim.

Other checks cover mixed numeric/Boolean/product coordinates, captured maps,
cycles, parallel arrows, conflicting redundant observations, retained-value
preservation, empty diagrams, snapshot immutability, identifier hygiene and
injection rejection, invalid API inputs, source-local diagnostics, protocol ABI
rejection, and the existing prohibition on using host functions as pure arrows.
Stream restoration retains event-domain certificates, sequential scan access,
empty-stream behavior, and rejection of independent-stream zips.

Demand tests keep unused trapping maps and unchecked constraints inactive; checker
conjunctions short-circuit in original edge order. `require` explicitly traps on
an inconsistent extension. Equality remains user-supplied: a numeric cycle involving
addition/subtraction can fail exact checking for 0.1 due to floating-point rounding.
The helper does not silently repair observations or assume those paths commute.

## Design reconciliation and limits

Experiments caught an important one-edge case: without a Boolean context, a lone
comparator could return a number. The generator now constrains every check to
`Bool`, including singleton checks. Repeated dictionary projections in a 2,048-edge
checker initially exhausted existing row-inference stack depth. The generator now
binds each coordinate, used map, and comparator once. The maximum-edge checker and
a 256-node chain both compile and execute in the targeted tests. No compiler
resource bound was raised or disabled.

Graph inputs remain bounded to 256 nodes and 2,048 edges. More complicated maps,
types, or exports can still reach existing compiler limits. In particular, ordinary
ASABI records retain their 128-field-per-level limit: a large internal diagram
must project or restructure its result before export.

The checker now requires even isolated coordinates statically, without demanding
their unused pure values. It checks edge equations, not comparator laws, function
totality, or equality semantics. Coverage/distance are structural, uniform bounds;
particular maps or shared map keys may impose additional constraints not used by
the planner. No weighted distance, stochastic recovery, automatic error correction,
implicit dependency inference, new effect authority, or worldwide novelty is claimed.
