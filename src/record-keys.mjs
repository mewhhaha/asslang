// Compiler-only record labels. '$' cannot occur in a source identifier, so this
// namespace cannot collide with ordinary fields. Keys never cross ASABI 1.
const SYMBOL_PREFIX = '$symbol:';
export const symbolKey = name => SYMBOL_PREFIX + name;
export const isSymbolKey = key => key.startsWith(SYMBOL_PREFIX);
export const displayRecordKey = key => isSymbolKey(key)
  ? `[${key.slice(SYMBOL_PREFIX.length)}]` : key;
