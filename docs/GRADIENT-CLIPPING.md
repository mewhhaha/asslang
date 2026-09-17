# Source-defined gradient norm clipping

[Documentation](README.md) · [Structured optimization](STRUCTURED-OPTIMIZATION.md) · [Gradients](GRADIENTS.md)

## Design status

This is the theory-first contract for extending `lib/optimization.ass` after the
structured-optimization pass on main `cde8ed35415f894180fbb6557a75d4dec2b42d95`.
Implementation and executed evidence must be reconciled below before publication.

## Problem and motivating program

The existing optimization dictionary exposes `dot`, `scale`, and `axpy`, but the
current algorithms use only `axpy` for gradient descent and `add`/`scale`/`axpy`
for momentum. A caller that wants to bound an unusually large gradient therefore
has to unpack the dictionary protocol at each call site:

```ass
let gradient = grad objective point;
let norm = sqrt (vector.dot gradient gradient);
let direction = if norm > maxNorm
  then vector.scale gradient (maxNorm / norm)
  else gradient;
vector.axpy point direction (-rate)
```

The proposed source helper makes that policy reusable without adding a compiler
optimizer primitive:

```ass
clipped_gradient_step_with vector objective point rate maxNorm
product_clipped_gradient_step objective point rate maxNorm
```

The first function is dictionary-polymorphic. The second derives the existing
bounded numeric-product vector from `point`.

## Semantics

For `g = grad objective point`, define `n = sqrt (vector.dot g g)`. The clipped
direction is

    d = if n > maxNorm then vector.scale g (maxNorm / n) else g

and the result is

    vector.axpy point d (-rate)

`maxNorm` must be nonnegative. A negative bound traps through ordinary `require`
before the gradient/update value is demanded. `maxNorm == 0` is valid: a nonzero
finite gradient is scaled to zero, while an exactly zero gradient takes the
unclipped branch and avoids `0 / 0`.

The comparison is strict. A gradient whose norm is exactly the bound is not
rescaled. The source keeps the existing floating-point instruction order; it does
not introduce an approximate comparison, epsilon, or hidden tolerance.

This helper is a step-size policy, not a numeric sanitizer. If `dot` produces NaN,
`n > maxNorm` is false under the existing floating-point comparison semantics and
the original gradient flows to `axpy`. Infinite components may still yield NaN
when multiplied by a zero clipping factor. The library does not claim to make
non-finite gradients finite.

## Dictionary, type and shape obligations

`clipped_gradient_step_with` requires only three ordinary source fields:

```text
{
  dot: V -> V -> Num,
  scale: V -> Num -> V,
  axpy: V -> V -> Num -> V,
  ...
}
```

No explicit interface syntax is added; existing record-row inference carries these
requirements through generic helpers, including unused definitions. A custom
metric is therefore possible by supplying a different `dot`, provided its `scale`
and `axpy` operations remain coherent with the caller's chosen value space. The
compiler does not prove vector-space laws or positive definiteness.

`product_clipped_gradient_step` uses `numeric_vector point`, so it inherits the
existing exact numeric-product shape restriction: scalar `Num` or finite nested
record/tuple products containing only numeric leaves. Shape limits remain 128
leaves, 16 record levels and 4,096 shape nodes per traversal.

## Demand, effects and differentiation

The guard on `maxNorm` is an ordinary demanded `require`. Once it passes, `grad`
keeps its existing activity, graph and effect restrictions. The norm is demanded
because branch selection needs it. `vector.scale` must remain lazy on the
unclipped branch; a dictionary field that would trap if called is valid when the
norm does not exceed the bound. `vector.axpy` is demanded for the returned update.

The helper is pure source and cannot hide a host capability. It does not introduce
stream traversal, causal access, event provenance, state, or mutation. Dictionary
functions and gradients remain compiler-staged and cannot escape through ASABI.

## Lowering and resource behavior

No parser form, builtin name, scalar/JTE opcode, Wasm instruction, runtime type,
ABI layout, reflection registry, guest allocation, scratch region, or compiler
option is added. Numeric-product calls elaborate through the existing bounded
shape traversal; scalar `sqrt`, comparison, division and source conditional lower
through existing scalar nodes.

For a finite scalar/nested-record objective already representable by the current
AD graph, the resulting update can still emit zero loops and zero intermediate
buffer bytes. This must be measured on the implemented example rather than assumed.
Compiler staging work grows with the differentiated graph and finite product shape.
No timing or asymptotic improvement is claimed.

## Alternatives rejected

A `clip_gradient` compiler intrinsic is unnecessary: all required operations are
already expressible through source `grad`, dictionary fields and scalar functions.
Adding a runtime parameter-tree walker would duplicate static product traversal and
add representation/runtime surface. Clipping each field independently was rejected
because it is a different policy and would not exercise the dictionary's `dot`
operation or preserve a global direction by uniform scaling.

A hidden epsilon in `maxNorm / norm` was also rejected. The branch already avoids
division for zero gradients, while an epsilon would silently change the requested
norm and signed/exceptional floating-point behavior.

## Prior art

Pascanu, Mikolov and Bengio, *On the difficulty of training Recurrent Neural
Networks* (arXiv:1211.5063), proposes rescaling a gradient when its norm exceeds a
threshold as a response to exploding gradients:
https://arxiv.org/abs/1211.5063 (checked September 17, 2026).

That paper motivates the policy, not Asslang's integration. The proposed Asslang
change is specifically a statically staged, source-dictionary composition over the
language's existing numeric-product and AD mechanisms. No novelty claim is made.

## Validation plan

Before publication:

- execute clipped and unclipped scalar/nested-product cases over the existing SIMD,
  reduction-fusion and memoization option matrix;
- compare against an independent numeric oracle, including a 3-4-5-style gradient
  whose norm and clipping factor are exact and easy to inspect;
- verify negative `maxNorm` traps, zero bound behavior, and lazy non-demand of
  `scale` on the unclipped branch;
- verify missing dictionary fields and invalid product leaves fail even through
  unused callers with client source locations;
- compare emitted Wasm with a direct source expansion and a renamed-library copy to
  exclude optimizer-name recognition in the tested cases;
- check ASABI version, loop count and intermediate-buffer bytes on the example;
- run the focused test plus `npm test`, host/reducer/case-study examples, core,
  prelude and operator audits, and the browser suite when available.

Finite tests establish regression evidence, not a formal proof of the source laws,
all floating-point inputs, or compiler correctness.

## Executed evidence

The implementation candidate `06710f2d8711f6b2c5f6bec7db10e3a30eaffd4f` was
reconstructed locally from the retained validation archive for base main
`cde8ed35415f894180fbb6557a75d4dec2b42d95`; Git blob hashes for every changed
implementation/test/example/index file matched the blobs used to build that GitHub
commit. Node 22.16.0 executed the following checks before main was advanced:

- `node --test test/structured-optimization.test.mjs`: **10/10 passed**. The four
  clipping-focused tests cover eight SIMD/fusion/memoization configurations, an
  independent JS `Math.hypot` oracle for a 6-8-10 gradient, exact-bound lazy
  non-demand of a trapping `scale`, zero and negative bounds, unused generic/type
  failures with `app.ass` locations, direct source-expansion byte equality, and a
  renamed library.
- `npm test`: **1,792/1,792 passed**, with zero failures, skips or cancellations.
- `npm run example:host`, `npm run example:reducers`, and
  `npm run example:case-studies`: passed.
- `examples/interop/structured-optimization.mjs`: passed. Its clipped nested product
  changed `{gain:1,model:{bias:1,slope:2}}` to
  `{gain:0.7,model:{bias:1,slope:1.6}}`; the existing two-step momentum oracle also
  passed. The combined module is ASABI 1, **5,272 bytes**, with **0 loops** and
  **0 intermediate buffer bytes** for the reported export statistics.
- `npm run audit:core`, `npm run check:prelude`, and `npm run check:operators`: passed.
  The callable inventory remains 37 public names / 33 compiler primitives / 4
  source-prelude functions; clipping is only an explicitly linked source-library
  function.
- `npm run test:docs`: **26/26 passed**.
- `npm run test:browser -- --output ...`: local headless Chromium 144 reported
  **2,450 core checks passed** and the experiment bundle reported **276 checks /
  138 cases passed**. HTTP module loading and playground-worker loading were not
  exercised by that runner.

The candidate makes no timing claim. The zero-loop/zero-intermediate result is one
finite scalar-graph example, not a guarantee for arbitrary objectives or custom
dictionaries. Finite tests do not prove vector-space laws, numerical robustness for
all non-finite inputs, or compiler correctness.
