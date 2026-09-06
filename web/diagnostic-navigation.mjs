// A response may describe an older editor snapshot. Never move the caret using
// stale offsets, or confuse human columns with textarea UTF-16 positions.
export function selectDiagnostic(input, checkedSource, diagnostic) {
  const offset = diagnostic?.range?.start?.offset;
  if (input.value !== checkedSource || !Number.isSafeInteger(offset) || offset < 0 || offset > checkedSource.length) return false;
  input.focus();
  input.setSelectionRange(offset, offset);
  return true;
}
