# Shape-preserving record updates

## Problem and acceptance contract

The existing `examples/patterns/record_update.ass` and `record_lens.ass` rebuild
records field by field. A setter must know every unrelated field. Adding a field
to a caller silently drops it from that setter's result. On base main
`c01612b13c264b51c16fe0315a4c17b6125c22ea`, selecting a new `revision` field after
the existing `with_score` helper fails with `E_TYPE` (missing required field).

Before:

```ass
fn with_score = score -> record ->
  {name:record.name, score, enabled:record.enabled};
```

Canonical source:

<!-- example: record-update-setter -->
```ass
fn with_score = score -> record -> {record with score};
export fn main = (name:Text) ->
  with_score 9 {name, score:0, enabled:true, revision:7};
```

This is one general record operation, not a domain-specific setter builtin. It
supports reusable configuration edits, immutable state transitions, lenses, and
staged dictionary adaptation. Acceptance requires preserved unknown fields,
row-polymorphic helpers, same-type replacement, single base staging, unchanged
field demand/provenance/authority, useful rejections even in unused definitions,
and real Wasm execution. It does not make Asslang a complete general-purpose
language: variants, general recursion, modules, escaping closures and a managed
guest heap remain separate design work.

## Syntax and static semantics

`{record with field:value, other}` is an immutable shallow update. The base is a
name or a grouped expression: `{(choose_record flag) with enabled:true}` and
`{(record.settings) with retries:3}`. A grouped base uses existing balanced
parenthesis lookahead, not speculative parsing. At least one replacement is
required. Field puns, trailing commas and declared symbol keys follow record
construction. Duplicate replacement labels are errors. Nested updates are explicit:

<!-- example: record-update-nested -->
```ass
fn set_retries = retries -> config ->
  {config with network:{(config.network) with retries}};
export fn main = (retries:Num) ->
  set_retries retries {enabled:true, network:{retries:0, timeout:30}};
```

`with` is contextual only after the name/grouped base at the start of a record
expression. It remains a valid value, function and field name elsewhere. No new
token or operator precedence rule is introduced. Existing `{field:value}` and
`{field}` programs retain their ASTs. The legacy grammar is unchanged; legacy
functions can call canonical update helpers. Computed keys, deep path assignment,
record extension/removal, mutation and runtime record reflection are not added.

Given a base type `R` and replacements `ki:ei`, infer each expression in the same
lexical environment and unify `R` with the open row `{ki:Ti | rho}`, where `Ti`
is the replacement's type. The result is the **same R**, not a newly closed row.
Thus all replacement fields must already exist, with unifiable types, and all
other fields and their types survive. This reuses existing HM row unification,
generalization and instantiation, including numeric-product restrictions. A helper
may be used at several record shapes and several replacement types, but a single
call cannot replace Num with Bool. Even an unused update is checked.

This deliberately starts with shape- and type-preserving updates. Type-changing
updates need a separate row-subtraction/lacks contract: reusing a shared row tail
without such a contract can admit duplicate labels. Do not smuggle extension or
subtyping into the current row system.

## Values, demand and representation

For a concrete record with field set S and replacement set K (K subset S):

- the result has exactly S;
- for k in K, projection returns the replacement expression;
- for k outside K, projection returns the original field computation;
- no replacement binder is introduced: all expressions see the original lexical
  environment, so `{r with x:r.y, y:r.x}` swaps simultaneously;
- the base expression is staged exactly once, without duplicating causal plans.

The implementation adds one checked `record_update` AST form with a base and named replacement
expressions. Staging copies the base's field map shallowly and replaces the named
entries. It shares scalar graphs, closures, spans and stream plans; it never
copies input data or creates a guest object. Replacements are staged in source
order, just like existing records. Runtime evaluation follows the existing demand
graph, not that compiler traversal order.

An overwritten old field is not demanded. An unused replacement is not demanded.
Guards on retained fields survive, including guards distributed by `require` on
a record. Replacing every guarded field can remove those field demands, exactly
as explicit reconstruction without reading the old fields would. This operation
is not a new strict assertion on the whole base. A Boolean field named `valid`
remains a value, never authority or proof.

Record updates can retain/replace source closures and symbol-keyed protocol fields,
but existing ABI restrictions still reject their escape. Stream fields retain
their actual JTE evidence. Replacing a stream with another of the same ordinary
type does not equate their event domains or make a scan seekable. AD consumes the
ordinary resulting graph, retaining activity errors and floating-point order.
Effects remain direct `perform` bindings; updates neither hide nor replay calls.

## Boundary, cost and compatibility

The callable primitive count remains 33, with four source-prelude names. The
expression core gains static record update, recorded separately in the inventory
and audit. Source projections cannot enumerate a polymorphic unknown remainder, which
is the reason for this small compiler operation rather than another handwritten
setter or a runtime library. Algorithms and lens composition remain ordinary
source. No Wasm opcode, JTE rule, ABI version/layout, guest allocator, global
registry, dependency or limit increase is needed.

The shallow staging operation copies one reference per immediate base field
and performs one map write per replacement, using O(number of immediate fields)
compiler map storage. This excludes parsing, row unification, and staging the
base/replacement expressions, which can do additional work. Every copied field
is charged to the existing `maxExpansion` budget alongside ordinary expression
staging. Nested payloads are shared, not traversed recursively by the update.
Existing source/node/nesting/type/ABI bounds still apply. Large repeated updates
must fail with `E_LIMIT`, not evade generated-work accounting. Emitted runtime
work is whatever the retained/replacement computations require. Returning a record
or array still uses normal output descriptors/materialization and host copies;
no constant-runtime or universal zero-cost claim follows from static erasure.

Compatibility checks compare old corpus ASTs, bytes, ABI metadata and certificates
against the actual base compiler. Explicit closed-record expansions should match
representative update artifacts; compiler syntax/inference/staging counts need
not match. The existing record-update/lens examples adopt the new form without changing
their previous outputs. Configuration and ledger examples are registered in the
corpus. See [executed validation](RECORD-UPDATES-VALIDATION.md).

## Arguments and validation plan

Projection preservation follows by the two cases k in/outside K above. Row
unification ensures the same field set and compatible types before staging. This
is a local argument, not a mechanized type-soundness or contextual-equivalence
proof. Test its integration rather than assuming the argument settles effects,
stream demand or derivative activity.

Run baseline tests, then positive/negative/parser/source-location tests for names,
grouped bases, puns, symbols, tuples, nested records, simultaneous replacement,
polymorphic/partial/local helpers, occurs checks and invalid unused definitions.
Use at least configuration, state and dictionary examples. Exercise all eight
SIMD/fusion/memoization modes, independent value oracles and seeded families.
Check traps/laziness, scan/zip/split witnesses, stopping suffixes, differentiation
with analytic and finite-difference checks, performed-call ordering, prepared
ownership/disposal, cache isolation and expansion boundaries. The test reference
interpreter is only a value oracle, never a substitute for emitted Wasm.

Run `npm test`, `npm run example:host`, `npm run example:reducers`, focused suites,
case studies, docs, core/prelude/operator audits and browser engine checks. Report
HTTP loading and other engines separately. Retain exact commands, resource
measurements, provenance and limits in the validation report and journal.

## Prior art and integration decision

Primary sources read September 17, 2026:

- Elm's official [core-language guide](https://guide.elm-lang.org/core_language.html#records)
  demonstrates immutable record updates and the row-polymorphic birthday helper.
  This motivates preserving unknown fields, rather than treating a setter as a
  closed record reconstruction.
- The [OCaml 5.3 manual, record expressions](https://ocaml.org/manual/5.3/expr.html#ss%3Aexpr-records)
  documents `{expression with fields}` and distinguishes functional update from
  assignment. Asslang borrows the readable `with` cue while keeping its own
  comma/colon/pun conventions, grouped-base disambiguation and structural typing.

Record update is established prior art. The contribution is its bounded
integration with Asslang's existing rows, staged products and demand/provenance
rules, not historical novelty or a performance improvement.
