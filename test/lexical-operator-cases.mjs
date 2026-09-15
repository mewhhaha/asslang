export const lexicalOperatorCases = [
  {name:'source function, familiar precedence',body:'infixl (<+>) like (+) = x -> y -> x+y; 2 <+> 3*4',expected:14},
  {name:'right association is syntax, not a rewrite',body:'infixr (^^) above (*) = x -> y -> 10*x+y; 1 ^^ 2 ^^ 3',expected:33},
  {name:'same operation with left association',body:'infixl (^^) above (*) = x -> y -> 10*x+y; 1 ^^ 2 ^^ 3',expected:123},
  {name:'first-class functions and partial application',body:'infixl (%%) like (-) = x -> y -> x-y; let subtract = (%%); let fromTen = subtract 10; fromTen 3',expected:7},
  {name:'let-polymorphic operator values',body:'infixl (%%) = x -> y -> x; let choose = (%%); {number:choose 3 true,flag:choose true 7}',expected:{number:3,flag:true}},
  {name:'nested shadowing preserves escaped closures',body:`infixl (<+>) like (+) = x -> y -> x+y;
    let saved = x -> x <+> 2;
    let inner = do {infixl (<+>) = x -> y -> x*y; {old:saved 3,new:3 <+> 2}};
    {inner,outside:3 <+> 2}`,expected:{inner:{old:5,new:6},outside:5}},
  {name:'initializer observes previous binding',body:`infixl (%%) like (+) = (+);
    do {infixl (%%) = a -> b -> (%%) a b * 2; 3 %% 4}`,expected:14},
  {name:'operator capture survives ordinary name shadowing',body:'let combine = x -> y -> x+y; infixl (%%) = combine; let output = do {let combine=x -> y -> 99; 2 %% 3};output',expected:5},
  {name:'native rebinding is lexical and binary only',body:'let add=(+); infixl (+) = x -> y -> x*y; infixl (-) = add; {new:3+4,old:add 3 4,negative: -3,subtract:3-4}',expected:{new:12,old:7,negative:-3,subtract:7}},
  {name:'contextual words remain identifiers',body:'let infixl = x -> y -> x+y; let above=2; let like=3; infixl above like',expected:5},
  {name:'a source fallback does not demand its second value',body:'infixr (<?>) like (||) = a -> b -> if a.valid then a else b; ({valid:true,value:7} <?> require false {valid:true,value:0}).value',expected:7},
  {name:'transitive relative precedence',body:'infixl (%%) below (+) = x -> y -> x*10+y; infixl (^^) above (%%) below (+) = x -> y -> x-y; 1 %% 5 ^^ 2+1',expected:12},
  {name:'grouping resolves unrelated notations',body:'infixl (%%) = x -> y -> x+y; infixl (^^) = x -> y -> x*y; (1 %% 2) ^^ 3',expected:9},
  {name:'the data-first pipe accepts an explicit operator function',body:'infixl (%%) like (-) = x -> y -> x-y; 10 |> (%%) 3',expected:7},
];
export const lexicalProgram = body => `export fn main = () -> do {${body}};`;
