// Shared syntax examples; they use only ordinary core semantics after parsing.
export const localPatternCases = [
  {name:'nested record and tuple names', source:`export fn main = () -> do {
    let {point:(x,y), gradient:{gain:dg,bias:db}} =
      {point:(2,3),gradient:{gain:4,bias:5},unused:true};
    {x,y,dg,db}
  };`, args:[{}], expected:{x:2,y:3,dg:4,db:5}},
  {name:'record row stays open', source:`fn read = r -> do {let {value}=r;value};
    export fn main = () -> (read {value:7,other:true},read {value:false});`, args:[{}], expected:{_0:7,_1:false}},
  {name:'unit and singleton tuple', source:`export fn main = () -> do {
    let ()=();let {}={other:7};let (x,)=(8,);x
  };`,args:[{}],expected:8},
  {name:'destructured functions remain let polymorphic', source:`export fn main = () -> do {
    let (id, choose)=(x -> x, x -> y -> x);
    {number:id 3,flag:id true,first:choose 7 false,second:choose true 9}
  };`,args:[{}],expected:{number:3,flag:true,first:7,second:true}},
  {name:'partial and row-polymorphic function fields', source:`fn add = x -> y -> x+y;
    export fn main = () -> do {
      let {increment,get}={increment:add 1,get:r -> r.value};
      {number:get {value:increment 4},flag:get {value:true,extra:9}}
    };`,args:[{}],expected:{number:5,flag:true}},
  {name:'annotations and renaming are explicit', source:`export fn main = () -> do {
    let {weight:(mass:Num),pair:(x:Num,ok:Bool)}={weight:2,pair:(3,true)};
    let (total:Num)=mass+x;
    {total,ok}
  };`,args:[{}],expected:{total:5,ok:true}},
  {name:'initializer sees outer scope, aliases see inner scope', source:`export fn main = (x:Num) -> do {
    let {x,y}={x:x+1,y:x};
    let z=do {let (x,other)=(x+2,y);x+other};
    {x,y,z}
  };`,args:[4],expected:{x:5,y:4,z:11}},
  {name:'symbol and ordinary fields are separate', source:`symbol slot;
    export fn main = () -> do {
      let {[slot]:hidden,slot:public}={[slot]:3,slot:4};hidden+public
    };`,args:[{}],expected:7},
  {name:'underscore remains a real binding', source:`export fn main = () -> do {
    let (_,x)=(2,3);_+x
  };`,args:[{}],expected:5},
  {name:'vertical pipelines and the first-argument rule', source:`fn minus = x -> y -> x-y;
    export fn main = () -> do {
      let (forward,grouped)=(10 |> minus 3, 10 |> (minus 3));
      {forward,grouped}
    };`,args:[{}],expected:{forward:7,grouped:-7}},
  {name:'grouped lambda routes a pipeline to named results', source:`export fn main = (x:Num) ->
    x
    |> (n -> {number:n,twice:n*2})
    |> ({number,twice} -> number+twice);`,args:[4],expected:12},
  {name:'unused field keeps its trap lazy', source:`export fn main = () -> do {
    let {value,unused}={value:7,unused:require false 9};value
  };`,args:[{}],expected:7},
];
