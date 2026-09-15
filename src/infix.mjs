// Lexical notation only; operators elaborate to ordinary function bindings.
// See docs/LEXICAL-OPERATORS.md before changing scope, fixity or spelling rules.
export const infixRanks = Object.freeze({
  '|>': 1, '||': 2, '&&': 3, '==': 4, '!=': 4,
  '<': 5, '<=': 5, '>': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7,
});
const nativeFunctions = new Set(['+', '-', '*', '/', '<', '<=', '>', '>=', '==', '!=']);
export const isNativeInfixFunction = text => nativeFunctions.has(text);
export const isCustomInfix = text => /^[~^%?&|<>=+*/]{1,16}$/.test(text)
  && !Object.hasOwn(infixRanks, text) && text !== '=' && text !== '=>'
  && !text.includes('//');

export function createInfixScope() {
  // Bit i in reach[j] means j binds more tightly than i. Group 8 is unary;
  // application/selection are parsed separately, and cannot be customized.
  const reach = Array.from({length: 9}, (_, i) => (1n << BigInt(i)) - 1n);
  const symbols = new Map(Object.entries(infixRanks).map(([text, group]) =>
    [text, {text, group, associativity: 'left', binding: null}]));
  return {symbols, reach, bindings: 0};
}

export function extendInfixScope(scope, text, associativity, relations, binding, at, fail) {
  if (scope.bindings >= 64) fail('At most 64 simultaneously active operator bindings', at, 'E_LIMIT');
  const previous = scope.symbols.get(text);
  let group, reach = scope.reach;
  if (Object.hasOwn(infixRanks, text)) {
    if (associativity !== 'left' || relations.length)
      fail('Native infix rebinding retains its existing precedence and left associativity', at, 'E_FIXITY');
    group = infixRanks[text];
  } else {
    if (text.length > 16) fail('Operator names are limited to 16 characters', at, 'E_LIMIT');
    if (!isCustomInfix(text)) fail('Invalid or reserved symbolic operator name', at, 'E_OPERATOR');
    const same = relations.filter(r => r.kind === 'like');
    if (same.length) {
      if (relations.length !== 1) fail('Use one like relation, or above/below relations, not both', at, 'E_FIXITY');
      group = same[0].anchor.group;
      if (group <= 1) fail('Custom operators must bind more tightly than the pipeline', at, 'E_FIXITY');
    } else if (previous && !relations.length) group = previous.group;
    else {
      // Clone on extension: inner declarations cannot mutate an outer scope.
      reach = scope.reach.slice(); group = reach.length; reach.push(1n << 1n);
      const bit = 1n << BigInt(group); reach[8] |= bit;
      for (const {kind, anchor} of relations) {
        if (kind === 'above') reach[group] |= 1n << BigInt(anchor.group);
        else reach[anchor.group] |= bit;
      }
      // Bounded transitive closure, not numeric levels or insertion-order ties.
      for (let k = 0; k < reach.length; k++) {
        const target = 1n << BigInt(k);
        for (let i = 0; i < reach.length; i++) if (reach[i] & target) reach[i] |= reach[k];
      }
      if (reach.some((row, i) => row & (1n << BigInt(i))))
        fail('Cyclic operator precedence; remove a contradictory above/below relation', at, 'E_FIXITY');
    }
  }
  const symbols = new Map(scope.symbols);
  symbols.set(text, {text, group, associativity, binding});
  return {symbols, reach, bindings: scope.bindings + 1};
}

// Decide whether an incoming operator belongs in the right operand of parent.
export function infixBindsInside(scope, incoming, parent, at, fail) {
  if (incoming.group === parent.group) {
    if (incoming.associativity !== parent.associativity || incoming.associativity === 'none')
      fail(`Parenthesize '${parent.text}' and '${incoming.text}': incompatible associativity`, at, 'E_FIXITY');
    return incoming.associativity === 'right';
  }
  if (scope.reach[incoming.group] & (1n << BigInt(parent.group))) return true;
  if (scope.reach[parent.group] & (1n << BigInt(incoming.group))) return false;
  fail(`Parenthesize '${parent.text}' and '${incoming.text}': no declared precedence relationship`, at, 'E_FIXITY');
}
