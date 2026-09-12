// Real, supported Asslang: key evaluation is Wasm; permutation sorting in this
// experiment is a separate JavaScript backend. This is not sort syntax support.
export const partitionKeySource = `
  fn finite_key = x -> x-x == 0;
  export fn distance_keys = (readings:[Num]) -> (center:Num) ->
    require (finite_key center) (
      readings
      |> map (reading -> do {
        let distance = abs (reading-center);
        require (finite_key reading && finite_key distance) distance
      })
    );
`;
