# Static record symbols and explicit protocols

## Problem and scope

Ordinary record fields make convenient dictionaries, but a field such as `step`
can accidentally satisfy an unrelated library's convention. Add declared symbol
keys as a separate, statically checked field namespace. Libraries can express
protocols with records of data and functions, without dynamic object machinery.

ECMAScript symbols motivate the distinction between ordinary and symbol keys
([ECMAScript 6.1.5](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-ecmascript-language-types-symbol-type)).
This is deliberately **not** JavaScript's runtime Symbol type: Asslang has no
symbol values, dynamic key expressions, registry, reflection, prototypes,
getters, implicit `this`, automatic protocol hooks, or runtime symbol allocation.
It is an explicit source-level abstraction, not an ownership or secrecy system.

## Syntax, identity, and checking

```text
symbol payload;
symbol apply;

fn wrap = value -> { [payload]: value, [apply]: x -> x };
fn unwrap = object -> object[apply] object[payload];
export fn main = (x:Num) -> unwrap (wrap x);
```

A top-level `symbol name;` declares one key for the linked compilation unit.
Different declared names denote different keys, and `[payload]` is distinct from
the ordinary field `payload`. Declarations are order-independent, including
across explicitly supplied `compileSources` fragments. Duplicate declarations
are errors, not an interning request. All fragments currently share a namespace:
there are no private modules, generative per-call keys, aliases, or key imports.
Libraries must coordinate declaration names; this change does not solve module
namespace isolation. A declaration is not regenerated when a function is called.

Record construction uses `{ [key]: expression }`; a symbol entry must have an
explicit value. Selection uses `record[key]`, at the same precedence as `.field`.
The brackets contain exactly one declared identifier, never a computed value.
Annotations use `{ [key]: Num }`. Canonical record patterns use
`{ [key]: local } -> body`, with explicit renaming and ordinary nested patterns.
Symbol puns and symbol-only expression values are not supported. Ordinary field
puns, tuple representation, stream types, and function application are unchanged.
Both declaration grammars accept symbol construction/selection/annotations;
canonical code remains the preferred surface.

Symbols occupy a separate namespace from values: a local value named `payload`
does not redirect `object[payload]`, and the ordinary field `object.payload`
remains distinct. `symbol` is contextual at the declaration boundary, not a new
reserved value name. Unknown keys, duplicate symbol entries/declarations, and
computed keys are source-local errors. Row inference tracks symbol identities:
a helper requiring `[apply]` does not accept an ordinary `apply` field or a
separately declared `[other_apply]` field. Inferred signatures print `[key]`.

## Protocols are ordinary checked functions

A protocol is a library convention requiring particular symbol-keyed fields,
not an additional trait registry or hidden method lookup. Calls supply every
argument explicitly, and the compiler checks the corresponding row and arrow
types. For example, a reduction dictionary can separate its state from code:

```ass
symbol initial;
symbol advance;
symbol finish;

fn run_reducer = reducer -> xs ->
  reducer[finish] (fold xs reducer[initial] reducer[advance]);

fn squares = () -> {
  [initial]: 0,
  [advance]: total -> x -> total+x*x,
  [finish]: total -> total
};

export fn energy = (xs:[Num]) -> run_reducer (squares ()) xs;
```

For `[1,2,3]`, `energy` returns 14. No automatic fold/iterator conversion occurs;
`run_reducer` is ordinary source code. Selecting a finite dictionary at runtime
uses existing branch-specialized callables, not a vtable. Protocol code is pure
unless the existing explicit effect rules permit an operation. A symbol called
`dispose` has no magic: it cannot cause destruction, cleanup, or implicit effects.

## Memory and lifetime contract

| Layer | Representation and lifetime |
| --- | --- |
| Declared keys | Compiler metadata only, bounded by this compilation. No runtime identity token, property table, or symbol bytes in ASABI. |
| Internal record | A staged product of field computations, not an object allocation. Constructing or selecting it does not copy a stream's storage. |
| Numeric/Boolean payload | Existing scalar graph and Wasm locals, evaluated under ordinary demand rules. Symbol names do not introduce mutability or pointer identity. |
| Function field | Existing compiler closure/partial application/finite choice, specialized before emission. No guest closure or function table. |
| Stream/Text/Bytes payload | Existing stream plan or span descriptors referring to call-frame input/output storage. A symbol does not extend the span's lifetime or confer ownership. |
| Host result | Explicitly projected ordinary ASABI values only. The normal adapter copies results to independent JS storage; raw ABI users still manage their buffers. |

A symbol-keyed record **cannot cross any ASABI input, output, or host-call
signature**, including when nested. The compiler rejects the boundary instead
of silently dropping symbol fields or inventing a new layout. Export helpers
must explicitly project ordinary records/scalars; a symbol field may contain a
stream that is explicitly projected and returned under the existing stream ABI.
This prevents a metadata-looking field from secretly retaining data at the
boundary. Ordinary ASABI 1 layouts and frozen-binary compatibility remain intact.

The high-level adapter's normal call copies inputs and clears its frame. Prepared
calls retain a private input snapshot until disposal; results own separate JS
storage and no borrowed view escapes. Internal symbol wrappers cannot escape
that lifetime, transfer a lease, alias mutable JS storage, or hide host authority.
See [ABI.md](ABI.md), [LEASES.md](LEASES.md), and [EFFECTS.md](EFFECTS.md). There is
no new affine/linear type system, automatic destructor, allocation strategy,
copy-on-write promise, or garbage-collector promise here.

Constructing a record does not eagerly demand its fields. Demanding one field
preserves its guards, while unused fields and inactive choices remain inactive.
Stream provenance survives wrapping and projection: two independent sources do
not become aligned; a scan does not become seekable. Scalar recurrence state may
use symbol fields without extra buffers, but functions/streams in state remain
subject to the existing restrictions. Numeric AD products retain symbol keys
internally and must be projected before export, with unchanged demand rules.

## Lowering, bounds, and alternatives

Resolve declared selectors to a compiler-only field namespace that cannot be
spelled as an ordinary source identifier. Keep core record/field AST nodes and
row types, so existing staging, differentiation, and emission operate on products
without a new runtime operation. Format keys for diagnostics rather than leaking
the internal encoding. Check symbol keys before constructing every ABI record.
Internal product traversal orders symbol fields by identifier before ordinary
fields (which retain their existing ASCII ordering). Previously accepted plain
records and their layouts are unaffected.

Allow at most 256 symbol declarations per linked program; charge each declaration
and selector to the syntax-node budget. Existing source, delimiter nesting, type,
staging work, scalar graph, and ABI limits continue to apply. No flag bypasses
these bounds. Compiler sessions must not retain mutable symbol registries across
compilations; key resolution is deterministic and local to each parse.

Dynamic symbols would require runtime identities and storage rules. Local
generative declarations and first-class key polymorphism would require different
scope/type contracts. Sealed modules could give real abstraction privacy but
would first need a module/linker design. Automatic well-known hooks could obscure
effects and demand. This first layer chooses explicit static protocol keys and
ordinary row inference; it makes no performance or novelty claim.

## Validation plan

Run the unchanged suite first. Add parser, annotation, pattern, and precedence
tests; ordinary/symbol collision and distinct-key negative tests; forward and
cross-source declarations; polymorphic protocol helpers; finite callable choices;
legacy compatibility; source-local failures; and declaration/resource boundaries.
Exercise demand traps, causal state/provenance, AD products and saved derivatives,
capability non-replay, compiler sessions, and all eight lowering configurations.

Compare a symbol protocol and its explicit scalar implementation for analytic
results, emitted binaries, and memory imports; do not infer allocation absence
from the currently fixed allocation statistic alone. Check explicit stream
projection and prepared-call snapshot/result lifetimes. Reject nested symbol ABI
escapes, including host signatures, rather than weakening layout validation.

Extract the reducer example into a test and add shared Node/Chromium cases.
Preserve the independent corpus oracle and historical evidence. Run `npm test`,
all three example drivers, the example build, Chromium engine checks, and
`git diff --check`. Record actual results and unavailable checks separately.
