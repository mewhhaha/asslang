# Patterns borrowed from other languages

These examples demonstrate useful **variants**, not full compatibility. All new
source uses canonical syntax. Statically known functions disappear during staging;
a function cannot currently escape through the concrete ABI. The ordinary helper
library `lib/patterns.ass` is linked explicitly and introduces no runtime registry.

| Familiar construct | Runnable examples | Boundary |
| --- | --- | --- |
| ML/Haskell functions | `partial_application`, `function_composition`, `polymorphic_identity`, `closure_factory` | Currying, capture and polymorphism are static; no heap closure ABI |
| Rust Option/Result, ML Maybe | `option_map`, `result_validation`, `lazy_default` | Structural flags and payload records, not exhaustive tagged unions |
| Traits/typeclasses/strategies | `strategy_dictionary`, `predicate_algebra` | Dictionaries contain known functions; no runtime virtual dispatch |
| Lenses, records and products | `record_lens`, `record_update`, `nested_products`, `matrix_transform` | Explicit fixed shapes; units/newtypes are structural conventions |
| Reader and State styles | `reader_configuration`, `state_passing`, `fsm_traffic_light` | Configuration/state are explicit values, not implicit effects |
| Iterator/generator pipelines | `filter_map_pipeline`, `generator_every_other`, `enumerated_map`, `take_while_fold` | Transduce emits at most one value per input; early-stop event is visited |
| Bounded imperative iteration | `bounded_while`, `runtime_contract` | Explicit work budget and trapping contracts, not general recursion or exceptions |
| Numeric abstractions | `complex_numbers`, `dual_autodiff`, `newtype_convention` | Fixed scalar record layouts and f64 arithmetic |
| Lambda-calculus encodings | `church_choice`, `church_numeral` | Static demonstration; not efficient unbounded runtime Church data |

Names above are filenames without `.ass`. For example:

```sh
node src/cli.mjs examples/patterns/record_lens.ass --lib lib/patterns.ass \
  --run main --args '[10]'
node src/cli.mjs examples/patterns/dual_autodiff.ass --run main --args '[3]'
```

Option absence and result failure do not demand the transform function. The
option-map helper preserves the payload representation: use an explicit fallback
of the same type. Numeric state tags require caller discipline. A true nominal
sum type would need syntax, inference, exhaustiveness rules and ABI decisions;
it is not implied by these examples. See the [unsupported catalogue](../unsupported/README.md)
for those and other extension opportunities.
