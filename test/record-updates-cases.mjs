// Shared value cases for actual Node and browser Wasm execution.
export const recordUpdateModes = [false,true].flatMap(simd => [false,true].flatMap(reductionFusion =>
  [false,true].map(memoizeReductions => ({simd,reductionFusion,memoizeReductions}))));
export const recordUpdateCases = [
  {
    name:'polymorphic setters preserve unrelated rows',
    source:`fn set_value = value -> record -> {record with value};
      export fn main = () -> do {
        let set = set_value;
        {number:set 9 {value:1,active:true}, flag:set false {value:true,revision:7}}
      };`,
    args:[{}],expected:{number:{value:9,active:true},flag:{value:false,revision:7}},
  },
  {
    name:'simultaneous replacements and original persistence',
    source:`export fn main = (x:Num) -> (y:Num) -> do {
      let r={x,y,keep:true};{old:r,new:{r with x:r.y,y:r.x}}
    };`,args:[3,7],expected:{old:{x:3,y:7,keep:true},new:{x:7,y:3,keep:true}},
  },
  {
    name:'grouped nested bases, puns, trailing commas and borrowed text',
    source:`fn configure = retries -> r -> {r with network:{(r.network) with retries,}};
      export fn main = (name:Text) -> configure 4 {name,network:{retries:0,timeout:30},active:true};`,
    args:['sample'],expected:{name:'sample',network:{retries:4,timeout:30},active:true},
  },
  {
    name:'source dictionaries and captured callbacks',
    source:`fn adapt = f -> dictionary -> {dictionary with run:f};
      export fn main = (x:Num) -> do {
        let dictionary={run:n -> n+1,weight:3};
        let next=adapt (n -> dictionary.run n * dictionary.weight) dictionary;
        {old:dictionary.run x,new:next.run x,weight:next.weight}
      };`,args:[4],expected:{old:5,new:15,weight:3},
  },
  {
    name:'symbol labels are distinct from ordinary labels',
    source:`symbol run;
      fn adapt = f -> r -> {r with [run]:f};
      export fn main = () -> do {
        let d=adapt (x -> 2*x) {[run]:x -> x,run:7,weight:3};
        {answer:d[run] d.weight,ordinary:d.run}
      };`,args:[{}],expected:{answer:6,ordinary:7},
  },
  {
    name:'positional records retain their exact product representation',
    source:'export fn main = (x:Num) -> do {let pair=(x,true);{pair with _0:x+1}};',
    args:[4],expected:{_0:5,_1:true},
  },
  {
    name:'with remains a value, function and field name',
    source:`fn with = x -> x+1;
      export fn main = () -> do {let r={with:with 2,keep:true};{r with with:with r.with}};`,
    args:[{}],expected:{with:4,keep:true},
  },
  {
    name:'finite record choice remains branch-demanded',
    source:`fn select = flag -> if flag then {x:1,y:2} else {x:3,y:4};
      export fn main = (flag:Bool) -> {(select flag) with x:10};`,
    args:[false],expected:{x:10,y:4},
  },
  {
    name:'replacement expressions respect lexical source operators',
    source:`fn put = r -> do {infixl (+)=(*);{r with x:r.x+3}};
      export fn main = () -> do {
        let r={x:2,keep:7};let inner=put r;
        {inside:inner.x,outside:({r with x:r.x+3}).x,keep:inner.keep}
      };`,args:[{}],expected:{inside:6,outside:5,keep:7},
  },
];
