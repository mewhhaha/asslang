// Shared Node/Chromium cases; expected values are independent of compiler IR.
export const unaryCases = [
  { name: 'stream-valued export with filtering', source:
    'export fn main = (xs:[Num]) -> xs |> filter (x -> x>0) |> map (x -> x*2);', args: [[1,-2,3]], expected: [2,6] },
  { name: 'tuple state in a curried reduction', source:
    'fn step = (total,count) -> x -> (total+x,count+1); export fn main = (xs:[Num]) -> fold xs (0,0) step;', args: [[1,2,3]], expected: {_0:6,_1:3} },
  { name: 'left-associated application and right-associated arrows', source:
    'fn subtract = x -> y -> x-y; export fn main = (x:Num) -> subtract x 3;', args: [10], expected: 7 },
  { name: 'partial applications capture immutable environments', source:
    'fn add = x -> y -> x+y; export fn main = (x:Num) -> do {let a=add x; let b=add 20; a 2 + b 3};', args: [10], expected: 35 },
  { name: 'partial builtins are ordinary values', source:
    'export fn main = (x:Num) -> do {let clampLow=max 3; min (clampLow x) 9};', args: [2], expected: 3 },
  { name: 'higher-order application and local polymorphism', source:
    'fn apply = f -> x -> f x; fn id = x -> x; export fn main = (x:Num) -> do {let f=apply id; {n:f x, b:f true}};', args: [7], expected: {n:7,b:true} },
  { name: 'function returned through a block', source:
    'fn make = x -> do {let k=x; y -> k+y}; export fn main = (x:Num) -> make x 2;', args: [5], expected: 7 },
  { name: 'tuple pattern is one argument', source:
    'fn add = (x,y) -> x+y; export fn main = (x:Num) -> add (x,3);', args: [4], expected: 7 },
  { name: 'tuple annotations and ASABI positional records', source:
    'export fn main = (pair:(Num,Num)) -> ((x,y) -> x-y) pair;', args: [{_0:8,_1:3}], expected: 5 },
  { name: 'typed destructured tuple export', source:
    'export fn main = (x:Num,y:Num) -> x+y;', args: [{_0:2,_1:3}], expected: 5 },
  { name: 'nested record renaming and tuple patterns', source:
    'fn scale = ({point:(x,y)},factor) -> (x+y)*factor; export fn main = () -> scale ({point:(2,3),other:true},4);', args: [{}], expected: 20 },
  { name: 'record puns include singleton records', source:
    'export fn main = (x:Num) -> {x};', args: [5], expected: {x:5} },
  { name: 'record patterns accept wider rows', source:
    'fn add = {z,y} -> z+y; export fn main = (x:Num) -> do {let z=x; let y=3; add {z,y,extra:true}};', args: [4], expected: 7 },
  { name: 'grouping is distinct from singleton tuple', source:
    'fn one = (x,) -> x; export fn main = (x:Num) -> one ((x),);', args: [5], expected: 5 },
  { name: 'unit function and tuple result', source:
    'fn value = () -> 9; export fn main = () -> (value (),true);', args: [{}], expected: {_0:9,_1:true} },
  { name: 'function annotations bind arrows to the right', source:
    'fn twice = (f:Num -> Num) -> x -> f (f x); export fn main = (x:Num) -> twice (y -> y+1) x;', args: [4], expected: 6 },
  { name: 'field selection and arithmetic precedence', source:
    'export fn main = (x:Num) -> do {let ops={f:y -> y*2}; ops.f x + 3*4};', args: [4], expected: 20 },
  { name: 'subtraction is not a negative argument', source:
    'export fn main = (x:Num) -> abs x - 2 + abs (-x);', args: [-3], expected: 4 },
  { name: 'comments and newlines delimit application', source:
    'fn add = x -> y -> x+y; export fn main = (x:Num) -> add\n// argument\nx\t2;', args: [4], expected: 6 },
  { name: 'qualified stream-first pipes and curried fold callback', source:
    'export fn main = (xs:[Num]) -> do {let ops={map}; xs |> ops.map (x -> x*2) |> fold 0 (s -> x -> s+x)};', args: [[1,2,3]], expected: 12 },
  { name: 'zip and causal scan use curried callbacks', source:
    'export fn main = (xs:[Num]) -> zip xs (scan xs 0 (s -> x -> s+x)) (x -> total -> x+total) |> sum;', args: [[1,2,3]], expected: 16 },
  { name: 'transduce and partial stream builtins', source:
    'export fn main = (xs:[Num]) -> do {let walk=transduce xs 0; walk (s -> x -> {state:s+x,value:s+x,emit:x>0}) |> sum};', args: [[1,-2,3]], expected: 3 },
  { name: 'bounded iteration', source:
    'export fn main = (n:Num) -> iterate 0 n (s -> {state:s+1,done:s>=2});', args: [10], expected: {state:3,steps:3,done:true} },
  { name: 'legacy functions can be partially applied', source:
    'fn add(x,y)=x+y; fn unit()=4; export fn main = (x:Num) -> add (unit ()) x;', args: [3], expected: 7 },
  { name: 'legacy higher-order caller accepts canonical callback', source:
    'fn reduce(xs,f)=fold(xs,0,f); fn step = s -> x -> s+x; export fn main = (xs:[Num]) -> reduce xs step;', args: [[1,2,3]], expected: 6 },
  { name: 'canonical helper can be called by legacy code', source:
    'fn add = x -> y -> x+y; export fn main(x:Num)=add(x,2);', args: [3], expected: 5 },
];
