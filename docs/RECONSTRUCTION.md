# Reconstruction bases for finite observation diagrams

## Problem and categorical contract

A redundant observation record can contain several coordinates of the same
underlying state. An explicit directed edge `a -> b` means that a **pure unary
map** computes coordinate `b` from coordinate `a`. A coherent record `x` obeys
`x.b = maps.edge x.a` for every edge. Different coordinates may have different
types. This is the naturality/section equation for a diagram presented by its
finite generating graph; paths mean composition of the supplied maps.

The reconstruction observation is that agreement on one vertex propagates
forward. Consequently a set of observations determines every coherent record
exactly when it meets every source strongly connected component (SCC), uniformly
over choices of value types and maps. This is an application of the reconstruction
argument, not a claim of new category theory, graph algorithms, or coding theory.

This is **not** an ordinary expression dependency graph: `z = x + y` does not
supply an edge from `x` alone to `z`. Its input must instead be a product
coordinate containing both values. It is also not an event-domain certificate,
an inference-variable equivalence relation, or permission to equate independent
streams. Users explicitly supply the observation graph; the compiler does not
infer categorical laws from arbitrary code.

## Proposed API and semantics

Expose two build-time JavaScript helpers through `src/compiler.mjs`:

```js
const graph = {
  nodes: ['a', 'b', 'total'],
  edges: [
    { from: 'a', to: 'b', map: 'flip' },
    { from: 'b', to: 'a', map: 'flip' },
    { from: 'a', to: 'total', map: 'collapse' },
  ],
};
const plan = planReconstruction(graph, { observed: ['b'] });
const generated = reconstructionSource('observations', graph, { observed: ['b'] });
// compileSources([generated, {name: 'app.ass', source: ...}])
```

`nodes` is an ordered array of distinct ordinary Asslang field identifiers.
`edges` contains `{from, to, map}` records. `map` names a field in an explicitly
passed Asslang record of unary functions; it is not a JavaScript callback, source
snippet, implicit import, or host capability. Self-loops and parallel edges are
allowed. Node and edge declaration order make the generated plan deterministic.

`planReconstruction` returns an independent frozen snapshot with `nodes`, `edges`,
`sourceComponents`, `basis`, `missingComponents`, `complete`, `minimumDistance`,
and `steps`. Source components and their members follow node declaration order.
Without `observed`, choose the first node in every source component: a minimum
cardinality observation basis. With `observed`, retain exactly those nodes, in
node declaration order; do not silently invent missing observations. Return the
missing source components as a structural ambiguity witness. Steps are a
multi-source breadth-first reconstruction forest, in edge declaration order.
Even an incomplete plan reports its reachable forest, but cannot generate source.

`minimumDistance` is the smallest source component's cardinality. It is the
minimum Hamming disagreement of coherent records **over all target diagrams**,
not necessarily the minimum for these particular maps. Empty diagrams have an
empty basis, `complete: true`, and `minimumDistance: null`: there is only the
empty record, so no pair of distinct records to measure.

`reconstructionSource(name, graph, options)` rejects incomplete covers and returns
`{name: '<name>.generated.ass', source, plan}`, directly usable by `compileSources`.
Its one generated definition is an ordinary staged protocol:

```ass
fn observations = maps -> {
  restore: seed -> do {
    let v1 = seed.b;
    let v0 = maps.flip v1;
    let v2 = maps.collapse v0;
    {a: v0, b: v1, total: v2}
  },
  check: same -> value ->
    same.b (maps.flip value.a) value.b &&
    same.a (maps.flip value.b) value.a &&
    same.total (maps.collapse value.a) value.total
};
```

The actual generator uses fixed local names with numbered vertex slots. All user
identifiers occur only in validated declaration/field positions; none is spliced
in as an expression. An explicit exported wrapper supplies concrete ABI types.
The generated function has no special language status or implicit registration.

## Uniqueness is not existence

`restore` preserves every observed coordinate and computes each unobserved
coordinate once in the forest. It reconstructs any **already coherent** record
from its observations. Arbitrary seeds can be incompatible with a cycle, a
non-tree edge, or another observed coordinate. Choosing a forest does not prove
that different paths agree.

`check same value` explicitly checks **all original edges**, including self-loops,
parallel arrows and edges unused by the forest. `same` supplies a curried equality
predicate at each edge's target coordinate; structural product equalities are
ordinary user functions. The checker is exact only when these predicates implement
the intended equality. In particular, approximate floating-point comparisons do
not certify an equivalence relation, and NaN needs an explicit convention.

A restored record that passes an exact checker is a unique coherent extension of
its seeds. Checking remains opt-in and demand-sensitive: `{valid, value}` is not
a refined type, and demanding `value` alone does not demand `valid`. Use the
existing `require (protocol.check same value) value` to enforce validation at a
chosen pure boundary. Maps/predicates that trap can make restoration/checking
trap. Neither totality nor equality laws are proved by this helper.

## Why the cover and distance are exact

Collapse the finite graph into its SCC directed acyclic graph. Every vertex is
reachable from a source SCC. Inside an SCC, every vertex reaches every other.
Thus one seed in each source SCC reaches every coordinate, and forward propagation
of agreement proves uniqueness. A breadth-first forest gives an acyclic execution
order even when the supplied diagram has cycles.

Conversely, omit a source SCC `S`. Give every vertex in `S` Boolean values and
all other vertices singleton values. Internal maps in `S` are identities; maps
leaving it are the unique maps to a singleton. No edge enters `S` from outside.
The all-false and all-true assignments on `S` are coherent, agree everywhere
else, and cannot be distinguished by the observations. This also realizes a
pair differing exactly on `S`. Any nonempty disagreement set is predecessor-closed
and therefore contains a source SCC. Its minimum possible size is exactly
`minimumDistance`. Actual numerical maps can admit fewer records, larger distance,
or no records at all.

These are finite graph proofs of the relevant special case of the category-of-
elements argument. This feature does not implement general cosieve classifiers,
weighted distances, probability calculations, error correction, or theorem proving.

## Representation, compatibility, and resource bounds

Plan SCCs iteratively and build the forest with a queue: no unbounded recursion
or graph traversal at guest runtime. Graph processing is O(V + E), apart from
ordering at most V components. Generation is O(V + E) in output size. Bound each
request to 256 nodes, 2,048 edges, and 64 characters per identifier; reject invalid,
duplicate, reserved, or unknown identifiers before planning. Check conjunctions
are balanced to avoid linear parser nesting at the edge limit. Compiler source,
syntax, type, staging and ABI budgets continue to apply independently.

The generated record, functions, and map dictionary stage away through existing
row inference and JTE. Pure demand rules are unchanged: unused reconstructions
and checks are not effects. Scalar maps lower normally; stream maps retain their
original provenance, causal-access restrictions, guards, and borrowing rules.
Host declarations cannot be disguised as pure map fields. No new Wasm opcodes,
ASABI 1 layouts, guest allocator, closure table, cache, or implicit I/O is added.
Returning a concrete record may still require the existing ABI result storage.
No general runtime performance improvement is claimed.

Alternatives include handwritten records (simpler for a fixed tiny graph), a new
language intrinsic (unnecessary semantic surface), runtime graph traversal (extra
storage and dispatch), and full path-law inference (not justified by the existing
type system). Explicit source generation keeps the choice of arrows and equality
visible and compiles through the same checked pipeline as handwritten code.

## Planned validation

Before implementation, the unchanged baseline passed `npm test`: 783 tests,
zero failures, on Node v22.16.0, using upstream main `46296dd10de6fb80c79844dec02fc2a6298c0e88`.

Add independent exhaustive small-graph reachability/cover checks, exact-distance
witnesses, cyclic and disconnected diagrams, non-first and redundant observations,
empty diagrams, immutable snapshots, input/injection rejection, and boundary-size
plans. Execute generated source with numeric, Boolean and product coordinates;
check conflicting cycles/parallel edges; compare selected scalar exports byte-for-
byte with handwritten code across lowering options. Test source-local failures,
ABI rejection, demand, host effects, stream provenance and causal restrictions.
Exercise the new entry point in the browser test bundle as well as native modules.

Run `npm test`, `npm run example:host`, `npm run example:reducers`, and
`npm run test:browser`, with exact results and limitations recorded before review.
