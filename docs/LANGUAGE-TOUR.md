# A short language tour

[Documentation](README.md) · [Getting started](GETTING-STARTED.md) · [Full syntax](SYNTAX.md)

Every Asslang block below is a complete program. The documentation tests compile
and execute the positive examples and check the stated diagnostic for the negative
one. Use the [JavaScript adapter](GETTING-STARTED.md#call-from-javascript) to pass
concrete arguments to an export.

## Functions and products

`x -> body` consumes one value. `f x y` means `(f x) y`; a tuple is one argument,
not a comma-separated argument list. Helpers can remain inferred; annotations on
exports make concrete ABI shapes explicit.

<!-- example: tour-functions -->
```ass
fn add = x -> y -> x + y;
export fn combine = (x: Num) -> do {
  let plus_two = add 2;
  {value: plus_two x, pair: (x, plus_two x)}
};
```

At `x=3`, this returns `{value:5,pair:{_0:3,_1:5}}` to JS. A record is `{x, y}`;
a block is `do { let x = ...; result }`. Partial applications and function fields
stay in compiler-side staging, not guest closures. Legacy syntax is retained for
compatibility, but new code uses the [canonical rules](SYNTAX.md).

## Recurrence without mutable iterator objects

`scan` emits the new state at each event and preserves its source's event domain.
This allows a history stream and its source to be aligned:

<!-- example: tour-streams -->
```ass
export fn running = (xs: [Num]) -> do {
  let prefix = scan xs 0 (total -> x -> total+x);
  zip xs prefix (x -> total -> x+total)
};
```

For `[1,2,3]`, the result is `[2,5,9]`. Density does not imply random access:
the history depends on all earlier transitions. This program is deliberately
rejected with `E_CAUSAL_ACCESS`:

<!-- example: tour-noncausal -->
```ass
export fn invalid = (xs: [Num]) ->
  at (scan xs 0 (total -> x -> total+x)) 2;
```

Independent streams do not become aligned just because their lengths happen to
match. `zip_checked` provides explicit positional pairing where supported; it
does not establish equal provenance. See [causal streams](CAUSAL.md) and [JTE](JTE.md).

## Stop at the required prefix

<!-- example: tour-stop -->
```ass
export fn reach_six = (xs: [Num]) ->
  fold_until xs 0 (total -> x -> do {
    let next = total+x;
    {state: next, done: next >= 6}
  });
```

On `[1,2,3,100]`, the result is `{state:6,steps:3,done:true}`. The suffix is not
traversed. `iterate` offers explicitly bounded scalar state evolution; its
`done` flag distinguishes convergence from budget exhaustion. Neither operation
is a general recursive-call mechanism. See [composable reducers](COMPOSABILITY.md).

## Differentiate finite numerical products

`grad` computes a product-shaped gradient for a scalar objective. `linearize`
prepares a forward derivative that can be applied to several directions:

<!-- example: tour-linearize -->
```ass
export fn sensitivity = (point: {x: Num, y: Num}) -> do {
  let local = linearize (p -> {square: p.x*p.x, sum: p.x+p.y}) point;
  {value: local.value, along_x: local.pushforward {x:1,y:0}}
};
```

At `{x:3,y:4}`, the value is `{square:9,sum:7}` and the x-direction derivative
is `{square:6,sum:1}`. The callable cannot be returned through ASABI; apply it
or project concrete values first. [Forward differentiation](LINEARIZE.md),
[gradients](GRADIENTS.md), [reverse VJPs](VJP.md) and [reusable pullbacks](PULLBACK.md)
have different use cases and explicit supported-operation boundaries.

## Pure demand and explicit effects

Unused pure work is not an effect. This returns `x+1` without demanding its
trapping field:

<!-- example: tour-demand -->
```ass
export fn increment = (x: Num) ->
  {unused: require false x, value: x+1}.value;
```

Host calls are different: declare them and invoke them explicitly inside an
effect body. This program requires a matching `audit` capability from the host:

<!-- example: tour-effects -->
```ass
host fn audit: Num -> Bool;
export fn checked_energy = (xs: [Num]) -> effect {
  let value = sum (map xs (x -> x*x));
  let accepted = perform audit value;
  {value, accepted}
};
```

Run `npm run example:host` for the complete capability setup. No implicit host
permission is granted by a function, generated proof, or input lease. Already
performed effects are not rolled back after a later trap. [Effects](EFFECTS.md)
and [demand/staging](IMPLEMENTATION.md) define the exact boundaries.

## Static protocols and proof helpers

Ordinary records can contain functions while being staged. [Record symbols](RECORD-SYMBOLS.md)
provide checked keys for explicit protocols, not runtime dynamic properties.
Build-time [reconstruction and descent](CATEGORY-THEORY.md) helpers generate the
same kind of ordinary function/record code. A structural certificate is not a
refinement type or a proof that untrusted input currently satisfies the equations.

Returning `{valid,value}` does not make validation mandatory when only `value`
is demanded. Use an explicit `require`, or the documented guarded `join` / `select`
operations, at the boundary where validation must be enforced.
