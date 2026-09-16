# Automated development progress

This journal records bounded direct-main development passes. Historical entries are
append-only summaries; validation claims belong to the exact revisions named.

## 2026-09-17 — Structured optimization, design checkpoint

Base main: `8e40a8fdee0b4a9eed0ea1c129d5e09b08fb1e22` (tree
`ab1712bdaf6f8ddccaa1fa13037444663f527200`). PR #42 is merged in that base, so
numeric `product_map`, `product_zip`, `product_fold`, `product_axpy`, source `grad`
and related shape-programming evidence are available.

Problem: scalar AD already returns gradients matching nested numeric product shapes,
but reusable optimizers still have to depend directly on product helpers or spell
field updates manually. The selected improvement is a source-only vector dictionary
plus gradient/momentum steps over the existing bounded numeric-product mechanism.

Theory: `docs/STRUCTURED-OPTIMIZATION.md`. Related-work check: JAX's official pytree
documentation was read on September 17, 2026 for the established pattern of mapping
and transforming matching nested parameter structures. The Asslang design remains
narrower and static; no runtime registry or novelty claim is implied.

Status at this checkpoint: design only. No implementation, test or performance
result is claimed yet. Planned validation includes scalar/nested values, custom
dictionaries, momentum state, rejection/source-location cases, exact source
expansion comparison, full Node tests, required examples, core/prelude/operator
audits, and Chromium browser tests on the exact candidate tree.
