# Law-aware presentation validation

[Theory and API](EVIDENCE-PRESENTATIONS.md) · [Validation index](EVIDENCE.md)

## Revision and method

Based on merged main `3f66289bf643cbc23a1f2e9a08aa7d78cac783cc`, tree
`c7e0d1d4ce4d3a941a2b4015feb7685ec1fc8345`. The source came from GitHub Actions
artifact 10273585718 for PR #24's successful run 34624088142, rather than the
older user-supplied transport archive. Reconstructing the Git tree matched main
exactly. The unchanged baseline passed 1,138 Node tests. The initial theory,
including the image quotient and static-schema repair criterion, was committed
before implementation, examples or tests.

This change adds `.present` to the existing private evidence algebra. The new
module owns independent private/public decision arenas and emits ordinary Asslang.
Existing contract operations, transport audits, inference, parser, JTE, Wasm
emitter, ABI, effect authority, loop accounting, dependencies and workflow
permissions are unchanged. The short root README and historical reports remain
unchanged. Both browser harnesses register the new checks.

## Executed local checks

Validation date: September 11, 2026. Node v22.16.0, Linux x64,
Chromium 144.0.7559.96, Debian GNU/Linux 13. Local checks are separate from any
remote CI status recorded in the pull request.

| Check | Result |
| --- | --- |
| Unchanged baseline `npm test` | 1,138 passed; zero failures/skips |
| Final `npm test` | 1,168 passed; zero failures/skips |
| `npm run test:evidence-presentations` | 30 passed |
| `npm run test:docs` | 26 passed |
| `npm run example:evidence-presentation` | Passed; law repair, blocked future, refinement and checked current inputs |
| Host, reducer, algebra, interface, refinement and transport examples | All passed |
| `npm run build:example` | Passed |
| `npm run test:browser` | 1,393 core and 276 experiment checks passed (138 experiment cases) |
| `npm run test:browser:http` | Attempted; blocked by `net::ERR_BLOCKED_BY_ADMINISTRATOR` |
| Node syntax checks for new/modified modules; `git diff --check` | Passed |

The HTTP check was attempted, not passed. No browser policy was changed or
bypassed. HTTP module/worker loading, other engines, throughput benchmarking,
formal proof-assistant checking and independent mathematical review were not
validated. The successful engine checks do execute the new compiler export and
its generated Wasm; they are not a Node-only substitute for browser execution.

## Independent mathematical checks

All 20 monotone functions on three private atoms are used as each of two public
summary meanings, giving 400 maps. Direct private assignment enumeration computes
each image without using the new symbolic image algorithm. The exact schema
matches all 1,600 public-vector membership checks, including impossible views.
A separate reader checks the exported schema and canonical-contract snapshots.

For each map, all six monotone formulas over two public atoms are restricted to
the image. They represent every image upset, including duplicates that should
share a canonical handle. Equalities and entailments agree with truth tables;
returned counterexamples belong to the image. All 42,696 relative-residual
valuations agree with direct quantification over image extensions. All 86,400
adjunction cases hold. Minimum satisfying public views match enumeration in
7,200 formula/price cases, using unit prices and two nonuniform profiles that
include zero. These are public-flag costs, not minimum private acquisition costs.

The same 400 maps are checked against an independent upper-lifting oracle that
enumerates private extensions and actual image targets. Of these, 250 preserve
relative implication and 150 do not. Among the 250 successes, 183 fail the older
independent-public-cube audit: inferred laws repair those artificial-world
obstructions. The 150 failures have genuine globally realizable targets that
are blocked above the reported private state.

Every failure is checked directly: the current view is correct, the requested
view is produced by the reported `realizableWitness`, the request extends the
current view, and no extending private assignment produces it exactly. Returned
separating formulas are replayed using the existing residual/substitution code.
All 14,400 public formula pairs are also compared against private extension
semantics: universal commutation holds exactly for the accepted image maps.

Another complete family consists of all 216 maps from two private atoms to
three public atoms. Exact image membership and lifting agree with enumeration;
168 maps pass. This covers image order relations that cannot be tested by
assuming all covers add one public flag. Duplicate summaries are the simplest
multi-flag example.

A compiled suite builds 1,296 ordinary Asslang programs, covering all 36
two-private/two-public summary maps and all 36 public residual pairs. It makes
10,368 calls across public and private entry points. Every realizable public
input returns the expected image-relative answer; every unrealizable public
input traps, including predicates equivalent to always. Private entry points
match composition with the declared summaries. This count includes expected
rejections, not 10,368 successful admissions.

These families are exhaustive only within the specified vocabularies and price
profiles. Written proofs establish the general algebra and lifting claims;
tests corroborate the implementation. No finite count establishes historical
priority, independent peer review or a formal proof-kernel guarantee.

## Useful distinction and operational behavior

Duplicated summaries `ready := validated` and `usable := validated` infer the
exact law ready=usable. Their handles become equal and their residual is always
in the presented algebra. Public source nevertheless requires the schema:
ready=true/usable=false traps. Private source composes with the shared meaning,
so the schema follows by construction. The example additionally requires the
actual guarantee computed from current numeric inputs before returning 7.

The image of `ready := validated`, `warm := validated AND cached` includes
{}, {ready}, and {ready,warm}. From private {cached}, {ready} is unreachable,
even though private {validated} realizes it elsewhere. The audit reports both
private states and the blocking target. A sound state-only law cannot exclude
this target. Exposing cached and recomputing the image restores transport by
revealing the lost ordering. This does not contradict the old impossibility of
repairing transport by adding flags while retaining the free-cube codomain.

A higher-order schema test exposes x=a, y=b and both=a AND b. It rejects {x,y}
without both, which pairwise implications alone would not exclude. Schema
inference is exact image construction, not only an implication graph.

All eight SIMD/fusion/memoization configurations exercise public law guards,
current-input behavior and trap recovery. The representative duplicate-law gate
emits byte-identical Wasm to its handwritten ordered guard at zero loop allowance.
This is a particular byte-equivalence check, not a general performance result.
Two demanded fact loops traverse range(3) and range(4): seven units succeeds,
six traps, including raw Wasm in every mode; later smaller calls get fresh fuel.

Tests retain mandatory checks under result projection, laziness of unused pure
guards, support-shaped types, file-local diagnostics, effect rejection, callable
ABI rejection, cache snapshot isolation, causal access restrictions and unrelated
event domains. No new guest allocator, graph, proof token or host authority is
introduced. Schema-valid public flags still do not prove that the application
computed their declared meanings on current data.

## Symbolic scale, resource limits and ownership

A structured case uses 64 private atoms and 64 public flags: 32 independent OR
pairs, each exposed twice. It has 2^32 realizable public views. Its exact schema
has 96 reachable decision nodes, the audit checks 32 nontrivial independent
components, and its schema-guarded predicate compiles and executes under default
budgets. Private assignments and public image states are not enumerated by the
production implementation. The source private session remains unchanged.

The component decomposition is a proved product rule, not a claim that an
arbitrary 64-output relational problem is cheap. A grouped adverse variable
order for ten duplicated atoms creates a schema larger than the 512-node source
bound and is rejected rather than truncated. Other tests use the 128th private
variable with overlapping summaries, reverse public order, 128 forced public
truths and exact public cost 128 billion. These cases do not prove polynomial
worst-case size or that every bounded graph compiles.

The presentation has two retained arenas with the inherited session node cap,
and an additional temporary arena for one audited component at a time. Each
operation shares one inherited work counter across its Boolean work and walks.
Node/work failures roll back new retained nodes and leave previous handles and
the source session usable. Successful intermediates remain counted. The source
private algebra is not mutated on success or failure.

Inputs are checked for names, private ownership, malformed/sparse lists, duplicate
facts, invalid prices and bound overruns. Contract handles are local to a
presentation, not interchangeable with ordinary or foreign-session handles.
Snapshots and outputs are deeply frozen; accessor tests cover single capture of
binding fields without freezing caller objects. Arbitrary hostile JavaScript
proxies are not sandboxed.

## Interpretation limits

The implementation infers all state laws of a declared monotone summary map. It
does not accept arbitrary user laws, restrict private states by external physical
invariants, infer numeric truth from code, or track temporal histories. The
static-schema repair criterion concerns state subsets with inherited inclusion
order that retain every realizable state. A richer transition/history model is
a different semantics.

Quotient truth assumes pure total Boolean facts. Canonical decisions may demand
partial predicates in a different order from hand-written expressions. Interpreting
facts as equality or coherence evidence still requires the existing lawful-equality,
current-data and map-compatibility assumptions. Approximation, NaN and signed-zero
caveats are not relaxed. Existing free-cube residual and audit methods are unchanged.

The positive audit is a bounded computed result, not a portable formal proof
certificate. The exact image, Heyting operations and p-morphism foundation are
established mathematics. The new deliverable is their explicit integration,
state-law repair criterion, concrete remaining obstructions and checked lowering.
Historical novelty and formal verification are unclaimed. Published source
identifiers and remote checks are recorded separately in the PR discussion.
