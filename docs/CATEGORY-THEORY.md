# Category theory in practice

[Documentation](README.md) · [Getting started](GETTING-STARTED.md) · [Research notes](#go-deeper)

Start with the programming problem; the categorical description explains why the
abstraction is sound. Asslang's observation helpers take an **explicit graph of
pure unary maps**. An edge `raw -> summary` means the supplied map computes a
summary from that one coordinate. It is not an inferred dependency graph:
`z = x+y` needs a product input, not independent edges from x and y.

## Choose an operation

| Need | Helper / example | What it guarantees |
| --- | --- | --- |
| Recover a coherent record from observations | `reconstructionSource` | A sufficient source-component cover determines at most one coherent record. |
| Assemble coherent overlapping records | `descentSource` | A complete comparison certificate is sufficient for unique gluing. |
| Extend a plan with restricted, priced comparisons | `planDescentExtension` | Cheapest permitted completion, or a finite obstruction. |
| Establish one equality | `descentQuerySource` | A cheapest evidence path and a support-local sufficient guard. |
| Share evidence across several goals | `descentBatchSource` | An exact bounded frontier and a cheapest shared support. |
| Handle alternative caller guarantees | [Evidence residual example](EVIDENCE-RESIDUALS.md) | The weakest monotone additional condition; a teaching example, not a compiler export. |

These operations are build-time helpers. Their outputs are plans or ordinary
Asslang source, not new Wasm objects. Full versus conditional validation matters:
read each method's contract before using it as an input boundary.

## Reconstruct from a small observation set

Save and run this JS example from the repository root. The graph says that `a`
and `b` negate one another. Either coordinate determines the other when coherent.

<!-- example: category-reconstruction -->
```js
import { compileSources, reconstructionSource } from './src/compiler.mjs';
import { createRuntime } from './src/abi.mjs';

const generated = reconstructionSource('observations', {
  nodes: ['a', 'b'],
  edges: [
    {from: 'a', to: 'b', map: 'flip'},
    {from: 'b', to: 'a', map: 'flip'},
  ],
}, {observed: ['b']});
const compiled = compileSources([generated, {
  name: 'app.ass',
  source: `
    fn equal = x -> y -> x==y;
    export fn restore = (b: Num) -> do {
      let p = observations {flip: x -> -x};
      let value = p.restore {b};
      require (p.check {a:equal,b:equal} value) value
    };
  `,
}]);
const runtime = await createRuntime(compiled);
console.log(JSON.stringify(runtime.call('restore', [3]))); // {"a":-3,"b":3}
```

Agreement propagates forward through every pure map. One observation in each
source strongly connected component therefore determines every coordinate.
Restoration alone does not prove that arbitrary seeds satisfy all cycle equations;
the explicit check above establishes them under the supplied equality semantics.
See the [reconstruction proof and API](RECONSTRUCTION.md).

## Share evidence between goals

The following example plans and executes two goals together. Raw equality costs
4; either of two summary comparisons can complete the output goal. Separate
cheapest choices cost 7, but sharing the raw comparison lowers the total to 5.
These are declared costs, not a timing benchmark.

<!-- example: category-batch -->
```js
import { compileSources, descentBatchSource, verifyDescentBatch } from './src/compiler.mjs';
import { createRuntime } from './src/abi.mjs';

const graph = {
  nodes: ['raw', 'summary'],
  edges: [{from: 'raw', to: 'summary', map: 'square'}],
};
const patches = [
  {name: 'a', nodes: ['raw', 'summary']},
  {name: 'b', nodes: ['raw', 'summary']},
  {name: 'c', nodes: ['summary']},
];
const options = {
  queries: [
    {name: 'input', node: 'raw', left: 'a', right: 'b'},
    {name: 'output', node: 'summary', left: 'a', right: 'c'},
  ],
  candidates: [
    {node: 'raw', left: 'a', right: 'b', cost: 4},
    {node: 'summary', left: 'b', right: 'c', cost: 1},
    {node: 'summary', left: 'a', right: 'c', cost: 3},
  ],
};
const generated = descentBatchSource('proof', graph, patches, options);
if (!verifyDescentBatch(graph, patches, options, generated.plan)) {
  throw new Error('Invalid certificate');
}
const runtime = await createRuntime(compileSources([generated, {
  name: 'app.ass',
  source: `
    fn equal = x -> y -> x==y;
    export fn values = (x: Num) ->
      (proof {square: n -> n*n}).select {raw:equal,summary:equal} {
        a:{raw:x,summary:x*x}, b:{raw:x,summary:x*x}, c:{summary:x*x}
      };
  `,
}]));
console.log(generated.plan.minimumCost); // 5
console.log(JSON.stringify(runtime.call('values', [3]))); // {"input":3,"output":9}
```

`generated.plan.frontier.minimal` is `[[0,1],[0,2]]`: both are minimal sufficient
supports, and the first is cheaper under these prices. Keeping the full frontier
allows repricing without pretending one proof was the only possible proof.
The exact batch search is bounded to **16 candidates and 8 goals**; it rejects
larger requests instead of silently approximating. [Complete contract](DESCENT-BATCHES.md).

## What a certificate does not prove

A plan proves a structural statement about the explicitly declared observation
model. It does not prove that current data, equality predicates or map functions
satisfy that model. `verifyDescentBatch` checks the frontier and goal-proof contract,
not arbitrary display metadata or the truth of runtime values.

`checkEvidence` assumes the needed coherence. A guarded `select` additionally
checks the local equations supporting its goals; it does not establish full
global consistency. Projecting one batch result still validates the whole batch.
The relative-extension method `checkAdditional` has a stronger precondition:
retained equalities must still be true of the current pieces. Full `join` rechecks
them. A returned plan is not a cache token granting permission to trust old data.

The supplied equality must be transitive and respected by each used map.
Approximate comparisons can fail transitivity; numeric equality treats +0 and -0
as equal while reciprocal distinguishes them. NaN is not equal to itself.
A false sufficient guard does not necessarily imply unequal outputs: square maps
3 and -3 to the same number. The [descent contract](DESCENT.md) documents these
limits and has explicit counterexamples.

## Explore conditional evidence

The next question is what to request from a caller who guarantees either one
support or another. For target frontier `[[0,1],[0,2]]`, a guarantee `[[1],[2]]`
needs the additional support `[[0]]`.

```sh
npm run example:evidence-residual
```

The [derivation](EVIDENCE-RESIDUALS.md) identifies this operation as Heyting
implication, the right adjoint to conjunction. It proves an exact frontier
formula and explains why choosing a completion for just one possible guarantee
is unsound. The bounded helper lives in the example; no compiler API or equality
semantics changes are required. The runtime example rechecks both the actual
caller guarantee and the extra evidence.

## Go deeper

The implementation documents separate established mathematics, proved derivations,
finite checks and unverified novelty. Read [reconstruction](RECONSTRUCTION.md),
[gluing](DESCENT.md), [relative completion](DESCENT-EXTENSIONS.md),
[single-goal metrics](DESCENT-QUERIES.md), [shared proof frontiers](DESCENT-BATCHES.md)
and [conditional evidence](EVIDENCE-RESIDUALS.md) in that order.

For category-inspired language composition beyond these helpers, see
[concept mappings](CONCEPTS.md), [staged callables](STAGED-CALLABLES.md),
[reducer composition](COMPOSABILITY.md), and [forward/reverse differentiation](DIFFERENTIAL-STAGING.md).
[Related work](RELATED-WORK.md) and the [validation index](EVIDENCE.md) retain
sources, executed checks and their limitations. A useful specialization is not
by itself evidence of worldwide mathematical priority.
