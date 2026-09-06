// Shared compiler failures for Node and the real Chromium engine.
export const diagnosticCases = [
  { name: 'lexical', source: 'export fn main = () -> @;', code: 'E_LEX', phase: 'parse' },
  { name: 'canonical call migration', source: 'export fn main = (x: Num) -> x(1);', code: 'E_PARSE', phase: 'parse' },
  { name: 'unknown name', source: 'export fn main = (x: Num) -> missing x;', code: 'E_NAME', phase: 'infer' },
  { name: 'type mismatch', source: 'export fn main = (x: Num) -> x + true;', code: 'E_TYPE', phase: 'infer' },
  { name: 'infinite type', source: 'export fn main = (x: Num) -> (f -> f f) x;', code: 'E_OCCURS', phase: 'infer' },
  { name: 'open ABI', source: 'export fn main = x -> x;', code: 'E_ABI', phase: 'stage' },
  { name: 'event domains', source: 'export fn main = (a: [Num]) -> (b: [Num]) -> sum (zip a b (x -> y -> x+y));', code: 'E_DOMAIN', phase: 'stage' },
  { name: 'causal access', source: 'export fn main = (xs: [Num]) -> at (scan xs 0 (s -> x -> s+x)) 0;', code: 'E_CAUSAL_ACCESS', phase: 'stage' },
  { name: 'dense access', source: 'export fn main = (xs: [Num]) -> at (filter xs (x -> x > 0)) 0;', code: 'E_DENSE', phase: 'stage' },
  { name: 'host authority', source: 'host fn tick: Num -> Num; export fn main = (x: Num) -> tick x;', code: 'E_EFFECT', phase: 'infer' },
  { name: 'expansion budget', source: 'export fn main = (x: Num) -> x*x+1;', options: { maxExpansion: 1 }, code: 'E_LIMIT', phase: 'stage' },
];
