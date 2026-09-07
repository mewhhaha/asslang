export const cases=[
  {name:'jvp nested capture tag',source:'export fn main = (x:Num) -> jvp (y -> (jvp (z -> y*z) y 1).tangent) x 1;',args:[3],expected:{value:3,tangent:1}},
  {name:'jvp polynomial',source:'export fn main = (x:Num) -> jvp (y -> y*y*y+2*y) x 1;',args:[3],expected:{value:33,tangent:29}},
  {name:'jvp independent aliases',source:'export fn main = (x:Num) -> jvp (p -> p.a*p.b) {a:x,b:x} {a:1,b:0};',args:[3],expected:{value:9,tangent:3}},
  {name:'jvp capture isolation',source:'export fn main = (x:Num) -> jvp (y -> x*y) x 1;',args:[3],expected:{value:9,tangent:3}},
  {name:'jvp nested second derivative',source:'export fn main = (x:Num) -> jvp (y -> (jvp (z -> z*z*z) y 1).tangent) x 1;',args:[3],expected:{value:27,tangent:18}},
  {name:'jvp stop gradient',source:'export fn main = (x:Num) -> jvp (y -> y*stop_gradient y) x 1;',args:[3],expected:{value:9,tangent:3}},
  {name:'jvp lazy branch',source:'export fn main = (x:Num) -> jvp (y -> if y>0 then y*y else require false y) x 1;',args:[3],expected:{value:9,tangent:6}},
  {name:'jvp tangent retains primal guard',source:'export fn main = () -> (jvp (x -> require false 7) 2 1).tangent;',args:[{}],trap:true},
  {name:'jvp rejects nonnumeric products',source:'export fn main = () -> jvp (x -> x) true false;',code:'E_DIFF_TYPE'},
  {name:'jvp rejects dynamic reductions',source:'export fn main = (x:Num) -> jvp (y -> sum (map (range 3) (i -> i*y))) x 1;',code:'E_DIFF_UNSUPPORTED'},
];
