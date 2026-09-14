// Named source because the corpus reference interpreter deliberately has no AD.
// Independent whole-recurrence oracles and browser checks cover this kernel.
export const sensitivitySource = `
  fn sensitivity_smooth = alpha -> {
    initial:0,
    step:mean -> value -> mean+alpha*(value-mean),
    finish:mean -> mean,
  };
  export fn sensitivity = (samples:[Num]) -> (directions:[Num]) -> (alpha:Num) ->
    (saved:{value:{left:Num,right:Num},tangent:{left:Num,right:Num}}) -> do {
      let pipeline = sensitivity_smooth alpha |> machine_then (sum_reducer ());
      let lifted = machine_jvp pipeline {left:0,right:0};
      let events = zip_checked samples directions (value -> tangent -> {value,tangent});
      let history = machine_states_from events lifted saved;
      {
        values: history |> map (state -> (lifted.finish state).value),
        sensitivities: history |> map (state -> (lifted.finish state).tangent),
        state: history |> fold saved (previous -> next -> next),
      }
    };
`;
