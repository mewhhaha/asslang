// Named source rather than an .ass corpus fixture: the reference interpreter
// deliberately has no AD implementation. Independent gradient oracles test this.
export const calibrationSource = `
  fn calibration_finite = x -> x-x == 0;
  fn squared_loss = r -> r*r/2;
  fn huber_loss = delta -> r -> if abs r <= delta then r*r/2 else delta*(abs r-delta/2);
  export fn loss_gradient = (xs:[Num]) -> (ys:[Num]) -> (gain:Num) -> (bias:Num) ->
    (delta:Num) -> (robust:Bool) -> do {
      let policy = {loss:if robust then huber_loss delta else squared_loss};
      let {count, loss, gain:gainGradient, bias:biasGradient} =
        xs
        |> zip_checked ys (x -> y -> {x,y})
        |> fold {count:0,loss:0,gain:0,bias:0} (s -> row -> do {
          let objective = p -> policy.loss (p.gain*row.x+p.bias-row.y);
          let {value:sampleLoss, gradient:{gain:dg, bias:db}} =
            value_and_grad objective {gain,bias};
          require (calibration_finite row.x && calibration_finite row.y) {
            count:s.count+1, loss:s.loss+sampleLoss,
            gain:s.gain+dg, bias:s.bias+db
          }
        });
      require (delta > 0 && calibration_finite delta && calibration_finite gain
        && calibration_finite bias && count > 0 && calibration_finite loss
        && calibration_finite gainGradient && calibration_finite biasGradient) {
        loss:loss/count,
        gradient:{gain:gainGradient/count,bias:biasGradient/count}
      }
    };
  export fn predict = (xs:[Num]) -> (gain:Num) -> (bias:Num) ->
    require (calibration_finite gain && calibration_finite bias)
      (map xs (x -> do {
        let prediction = gain*x+bias;
        require (calibration_finite x && calibration_finite prediction) prediction
      }));
`;
