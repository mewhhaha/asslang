# App-like case studies

These examples separate a small application host from pure, checked Wasm kernels.
`app.mjs` reads a JSON argument array from stdin (at most 1 MiB), links only the
selected registered sources, uses a fixed 16-page runtime arena, and prints a JSON
result. Invalid requests, bounds, contracts, and nonfinite JSON results fail
explicitly. Filesystem, stdin, JSON and process I/O belong to the host, not Asslang.

```sh
npm run example:case-studies  # assertion-backed fixtures, scalar and SIMD
printf '[[0,10],[2,-2],0.5]' | \
  node examples/case-studies/app.mjs particle-step --simd
printf '[[10,5],[2,3],0.2,0.1]' | \
  node examples/case-studies/app.mjs checkout-invoice
```

| Case ID / source | Input argument array | Output and application role |
| --- | --- | --- |
| `telemetry-monitor` / `telemetry_monitor.ass` | `[readings, threshold]` | Discards nonfinite samples; computes count, rejected count, mean, RMS and alert count in a scalar record fold |
| `checkout-invoice` / `checkout_invoice.ass` | `[prices, quantities, taxRate, discount]` | Checks positional alignment and nonnegative line inputs; returns subtotal, tax, total and line count |
| `session-analytics` / `session_analytics.ass` | `[timestamps, gap]` | Validates finite, nondecreasing event times and returns causal session IDs; starts a new session only when the gap is strictly exceeded |
| `inventory-planner` / `inventory_planner.ass` | `[dailyDemand, stock, leadDays, safety]` | Calculates nonnegative replenishment units with explicit nonnegative integral-input contracts and checked alignment |
| `particle-step` / `particle_step.ass` | `[positions, velocities, dt]` | Performs a structure-of-arrays simulation step; returns updated positions, kinetic sum and particle count; both numeric loops can vectorize |
| `text-log-summary` / `text_log_summary.ass` | `[text]` | Classifies UTF-8 bytes into ASCII digit counts and line counts; handles trailing newline and empty text |

The corpus records concrete arguments and expected answers for each app. Tests
also cover empty data, invalid contracts, unequal lengths, unsorted timestamps,
Unicode bytes, nonfinite telemetry and result ownership. `run.mjs` validates the
fixtures; `app.mjs` accepts caller data. The source fragments can also be embedded
with `compileSources` and `createRuntime` rather than using either driver.

## Boundaries rather than production claims

These are bounded computation examples, not deployed services. There is no
network server, persistent database, scheduler, mutable guest object graph or
unbounded allocation. JSON cannot represent NaN/infinity, although direct JS
embedding tests the telemetry kernel with those values. The text kernel counts
UTF-8 bytes and ASCII classes, not Unicode graphemes or regex matches.

`Num` is f64. Checkout demonstrates pricing data flow, not decimal money or
financial accounting: the host must define currency precision and rounding.
Inventory units should remain in the exactly representable integer range; no
arbitrary-precision integer type is implied. Simulation input and numerical app
parameters should be finite and suitably scaled to avoid overflow. Contracts
shown in source are enforced; additional production-domain rules belong to the
embedding application. Materialized outputs remain bounded by arena capacity.
