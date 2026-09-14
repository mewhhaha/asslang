// AD is intentionally a named source fragment: the corpus oracle has no AD.
// This is one damped correction, not the existing robust calibration optimizer.
export const operatorCalibrationSource = `
  fn parameter_vector = () -> {
    zero:{gain:0,bias:0},
    add:a -> b -> {gain:a.gain+b.gain,bias:a.bias+b.bias},
    sub:a -> b -> {gain:a.gain-b.gain,bias:a.bias-b.bias},
    scale:s -> a -> {gain:s*a.gain,bias:s*a.bias},
    dot:a -> b -> a.gain*b.gain+a.bias*b.bias,
    finite:a -> krylov_finite a.gain && krylov_finite a.bias,
  };
  export fn calibration_step = (xs:[Num]) -> (ys:[Num]) ->
    (point:{gain:Num,bias:Num}) -> (damping:Num) -> do {
      let predict = p -> {
        a:p.gain*at xs 0+p.bias,
        b:p.gain*at xs 1+p.bias,
        c:p.gain*at xs 2+p.bias,
      };
      let residual = p -> {a:p.a-at ys 0,b:p.b-at ys 1,c:p.c-at ys 2};
      let {value,linear} = operator_at predict point |> operator_chain residual;
      let vector = parameter_vector ();
      let system = operator_normal linear |> operator_shift vector damping;
      let rhs = vector.scale (-1) (linear.adjoint value);
      require (count xs == 3 && count ys == 3 && krylov_finite damping && damping>0)
        (cg_solve system.apply vector rhs vector.zero {tolerance:1e-10,maxSteps:16})
    };
`;
