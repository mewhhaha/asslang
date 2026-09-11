// Named source rather than an .ass corpus fixture: the reference interpreter
// deliberately has no AD implementation. Independent gradient oracles test this.
export const calibrationSource = `
  fn calibration_finite = x -> x-x == 0;
  fn squared_loss = r -> r*r/2;
  fn huber_loss = delta -> r -> if abs r <= delta then r*r/2 else delta*(abs r-delta/2);
  export fn loss_gradient = (xs:[Num]) -> (ys:[Num]) -> (gain:Num) -> (bias:Num) ->
    (delta:Num) -> (robust:Bool) -> do {
      let policy = {loss:if robust then huber_loss delta else squared_loss};
      let rows = zip_checked xs ys (x -> y -> {x,y});
      let total = fold rows {count:0,loss:0,gain:0,bias:0} (s -> row -> do {
        let objective = p -> policy.loss (p.gain*row.x+p.bias-row.y);
        let result = value_and_grad objective {gain,bias};
        require (calibration_finite row.x && calibration_finite row.y) {
          count:s.count+1,loss:s.loss+result.value,
          gain:s.gain+result.gradient.gain,bias:s.bias+result.gradient.bias
        }
      });
      require (delta > 0 && calibration_finite delta && calibration_finite gain
        && calibration_finite bias && total.count > 0 && calibration_finite total.loss
        && calibration_finite total.gain && calibration_finite total.bias) {
        loss:total.loss/total.count,
        gradient:{gain:total.gain/total.count,bias:total.bias/total.count}
      }
    };
  export fn predict = (xs:[Num]) -> (gain:Num) -> (bias:Num) ->
    require (calibration_finite gain && calibration_finite bias)
      (map xs (x -> do {
        let prediction = gain*x+bias;
        require (calibration_finite x && calibration_finite prediction) prediction
      }));
`;
