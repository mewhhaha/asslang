// Link tracking.ass and the ordinary machine/JVP libraries. The reference
// interpreter lacks AD; independent recurrence derivatives cover this source.
export const feedbackSensitivitySource = `
  export fn tracking_sensitivity = (targets:[Num]) -> (directions:[Num]) -> (gain:Num) ->
    (saved:{value:{left:Num,right:Num},tangent:{left:Num,right:Num}}) -> do {
      let body = tracking_body gain;
      let closed = machine_feedback body body.finish;
      let lifted = machine_jvp closed {left:0,right:0};
      let events = zip_checked targets directions (value -> tangent -> {value,tangent});
      let history = machine_states_from events lifted saved;
      {
        values:history |> map (state -> (lifted.finish state).value),
        tangents:history |> map (state -> (lifted.finish state).tangent),
        state:history |> fold saved (previous -> next -> next),
      }
    };
`;
