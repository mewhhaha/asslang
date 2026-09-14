// Shared source cases; expected values are independent of helper expansion.
export const corePreludeCases = [
  {name:'ordered cancellation',source:'export fn main = (xs:[Num]) -> sum xs;',args:[[1e16,1,-1e16,1]],expected:1},
  {name:'sparse sum',source:'export fn main = (xs:[Num]) -> xs |> filter (x -> x>0) |> sum;',args:[[-2,1,3,-4]],expected:4},
  {name:'causal sum',source:'export fn main = (xs:[Num]) -> xs |> scan 0 (s -> x -> s+x) |> sum;',args:[[1,2,3]],expected:10},
  {name:'block seed scope',source:'export fn main = (xs:[Num]) -> xs |> chunks 2 |> map (b -> scan b (sum b) (s -> x -> s+x)) |> flatten;',args:[[1,2,3,4]],expected:[4,6,10,14]},
  {name:'product gradient',source:'export fn main = (p:{x:Num,y:Num}) -> grad (q -> q.x*q.x+q.y*q.y) p;',args:[{x:3,y:4}],expected:{x:6,y:8}},
  {name:'product JVP',source:'export fn main = (p:{x:Num,y:Num}) -> jvp (q -> {square:q.x*q.x,product:q.x*q.y}) p {x:1,y:2};',args:[{x:3,y:4}],expected:{value:{square:9,product:12},tangent:{square:6,product:10}}},
  {name:'product VJP',source:'export fn main = (p:{x:Num,y:Num}) -> vjp (q -> {square:q.x*q.x,product:q.x*q.y}) p {square:2,product:3};',args:[{x:3,y:4}],expected:{value:{square:9,product:12},cotangent:{x:24,y:9}}},
  {name:'higher order and partials',source:'export fn main = (xs:[Num]) -> do {let {reduce}={reduce:sum};xs |> chunks 2 |> map reduce};',args:[[1,2,3,4,5]],expected:[3,7,5]},
  {name:'legacy calls',source:'export fn main(xs)=sum(xs);',args:[[1,2,3]],expected:6},
  {name:'partial differential',source:'export fn main = (x:Num) -> do {let directional=jvp (y -> y*y);(directional x 2).tangent};',args:[3],expected:12},
  {name:'nested gradient',source:'export fn main = (x:Num) -> grad (y -> grad (z -> z*z*z) y) x;',args:[3],expected:18},
];
