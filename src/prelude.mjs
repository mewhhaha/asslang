import { preludeSource, preludeArities } from './prelude-source.mjs';
export { preludeSource, preludeArities };

// Only the small, compiler-shipped AST is relocated. Never rewrite caller ASTs
// or substitute text: lexical scope and argument evaluation use normal staging.
export function relocatePrelude(value, pos) {
  if (Array.isArray(value)) return value.map(v => relocatePrelude(v, pos));
  if (value instanceof Map) return new Map([...value].map(([k,v]) => [k,relocatePrelude(v,pos)]));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([k,v]) =>
    [k,k === 'pos' ? pos : relocatePrelude(v,pos)]));
}

// Each inference run owns its ASTs; no source, scheme or expansion cache crosses
// compilation boundaries. Loading is triggered by an unshadowed derived name.
export function createPrelude(parse, enabled, userNodes, fail) {
  const definitions = new Map();
  let templates, syntaxNodes = 0;
  return {
    definitions,
    get syntaxNodes() { return syntaxNodes; },
    definition(name, at) {
      if (!enabled || !Object.hasOwn(preludeArities, name)) return undefined;
      if (!templates) {
        const program = parse(preludeSource);
        syntaxNodes = program.nodeCount;
        if (userNodes + syntaxNodes > 50_000)
          fail('Syntax node limit exceeded including source prelude', at, 'E_LIMIT');
        templates = new Map(program.definitions.map(d => [d.name,d]));
      }
      if (!definitions.has(name)) definitions.set(name, relocatePrelude(templates.get(name), at?.pos ?? 0));
      return definitions.get(name);
    },
  };
}
