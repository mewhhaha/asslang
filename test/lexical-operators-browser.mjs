import {lexicalOperatorCases,lexicalProgram} from './lexical-operator-cases.mjs';
export async function runLexicalOperatorBrowserChecks({compile,check},createRuntime,report) {
  const assert=(ok,message)=>{if(!ok)throw new Error('Lexical operators: '+message);report.checks++;};
  const plain=x=>x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,plain(x[k])])):x;
  for(const simd of [false,true])for(const c of lexicalOperatorCases) {
    const r=await createRuntime(compile(lexicalProgram(c.body),{simd}));
    assert(JSON.stringify(plain(r.call('main',[{}])))===JSON.stringify(plain(c.expected)),c.name);
  }
  for(const body of [
    'infixl (%%) = (+); infixl (^^) = (*); 1 %% 2 ^^ 3',
    'infix (<~>) like (<) = x -> y -> x+y; 1 <~> 2 <~> 3',
    'infixl (%%) above (*) below (+) = (+); 0',
  ]) assert(check(lexicalProgram(body)).diagnostics[0].code==='E_FIXITY','ambiguous/cyclic fixity rejected');
  const source='export fn main = (xs:[Num]) -> do {infixl (<>) like (+) = concat; let {left,right}=split_at xs 2; scan (left <> right) 0 (+)};';
  const c=compile(source,{maxLoopIterations:4}),r=await createRuntime(c);
  assert([...r.call('main',[[1,2,3,4]],{outputBytes:32})].join(',')==='1,3,6,10','array alias runs natively');
  assert(c.stats.intermediateBufferBytes===0&&c.stats.functions[0].loops===1,'no added storage or traversal');
  report.cases.push({name:'lexical-source-operators',positiveCases:lexicalOperatorCases.length,modes:2});
}
