# Working on Asslang

## Theory before implementation — required for every change

Before editing implementation, tests, examples, or tooling, create or update the
relevant document in `docs/`. Explain the problem, semantics, invariants,
alternatives and trade-offs, planned lowering/representation, compatibility,
resource limits, and how the change will be validated. For a bug fix, document the
broken invariant and intended behavior first. Documentation-only work updates the
relevant theory directly; do not invent implementation work to satisfy this rule.

Keep the theory-first change ahead of implementation in the commit history when
practical. Revisit it when experiments change the design. Before submitting a PR,
reconcile the documents with the actual implementation and record test commands,
results, and limitations. Never describe a proposal as implemented or an unrun
check as passing. Keep `docs/README.md` useful as the documentation entry point.

## Architecture and compatibility

Read `docs/IMPLEMENTATION.md` and the relevant feature documents before changing
code. Use `docs/SYNTAX.md` for canonical language syntax. Prefer unary `->`
functions, whitespace application, and explicit tuple/record values in new source.
Legacy declarations remain a migration surface, not the style for new examples.
Do not silently reinterpret existing programs or change ASABI 1 layouts.

Preserve lexical scope, polymorphism, demand semantics, JTE event provenance,
causal access restrictions, capability checks, and compiler resource bounds.
Keep pure computations separate from explicit host effects. Avoid new runtime
allocations for abstractions that can be staged away. Do not claim a performance
improvement or worldwide novelty without evidence.

## Validation and review

Use Node 22 or newer. Run `npm test`, `npm run example:host`, and
`npm run example:reducers`. Run `npm run test:browser` when Chrome/Chromium is
available and report unavailable checks explicitly. Add positive, negative,
source-location, and regression tests for language changes; test both optimized
and default lowering when relevant. New `.ass` files under `examples/` must be
registered in `examples/corpus.mjs`; test-only fixtures belong under `test/`.

Keep PRs focused, describe migration choices, and report exact checks and merge
conflicts. Preserve existing historical evidence under `docs/`; add a new report
rather than rewriting old benchmark results as if they were current.
