// Programs shared by Node and real-browser checks. All helpers are linked source.
export const clockedMachineCases = [
  {
    name: 'serial accumulation observes the updated upstream state',
    source: `export fn main = (xs:[Num]) -> do {
      let m=sum_reducer () |> machine_then (sum_reducer ());
      scan_with xs m
    };`,
    args: [[1,2,3,4]], expected: [1,4,10,20],
  },
  {
    name: 'heterogeneous state uses the existing reducer protocol',
    source: `export fn main = (xs:[Num]) -> do {
      let m=mean_reducer () |> machine_then (sum_reducer ());
      scan_with xs m
    };`,
    args: [[2,4,6]], expected: [2,5,9],
  },
  {
    name: 'reset outside hold differs from hold outside reset',
    source: `export fn main = (xs:[Num]) -> do {
      let m=sum_reducer ();
      let a=m |> reducer_filter (x -> x>0) |> machine_reset_when (x -> x<0);
      let b=m |> machine_reset_when (x -> x<0) |> reducer_filter (x -> x>0);
      {resetOutside:scan_with xs a, holdOutside:scan_with xs b}
    };`,
    args: [[2,-1,3]], expected: {resetOutside:[2,0,3],holdOutside:[2,2,5]},
  },
  {
    name: 'held upstream still clocks downstream; held pipeline does not',
    source: `export fn main = (xs:[Num]) -> do {
      let a=(sum_reducer () |> reducer_filter (x -> x>0)) |> machine_then (sum_reducer ());
      let b=(sum_reducer () |> machine_then (sum_reducer ())) |> reducer_filter (x -> x>0);
      {upstream:scan_with xs a, whole:scan_with xs b}
    };`,
    args: [[2,-1,3]], expected: {upstream:[2,4,9],whole:[2,2,7]},
  },
  {
    name: 'resume is not a replacement reset target',
    source: `export fn main = (xs:[Num]) -> do {
      let m={initial:10,step:s -> x -> s+x,finish:s -> s}
        |> machine_reset_when (x -> x<0);
      machine_states_from xs m 100
    };`,
    args: [[2,-1,3]], expected: [102,9,12],
  },
  {
    name: 'resume type-checks but does not demand the declared initial state',
    source: `export fn main = (xs:[Num]) ->
      machine_states_from xs {initial:require false 0,step:s -> x -> s+x} 5;`,
    args: [[1,2]], expected: [6,8],
  },
  {
    name: 'partial applications and function fields are ordinary source',
    source: `export fn main = (xs:[Num]) -> do {
      let {chain}={chain:machine_then};
      let extend=chain (sum_reducer ());
      scan_with xs (extend (mean_reducer ()))
    };`,
    args: [[1,2,3]], expected: [1,2,10/3],
  },
  {
    name: 'a complete composed pipeline resets in symbolic chunks',
    source: `export fn main = (xs:[Num]) ->
      chunks xs 3 |> map (b -> scan_with b (machine_then (sum_reducer ()) (sum_reducer ()))) |> flatten;`,
    args: [[1,2,3,4,5,6,7]], expected: [1,4,10,4,13,28,7],
  },
];
