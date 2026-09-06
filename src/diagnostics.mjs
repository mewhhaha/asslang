// Browser-independent presentation of compiler facts. No parsing, execution,
// source loading, or semantic-span guesses belong in this layer.
const FRAME_LIMIT = 160;
const MESSAGE_LIMIT = 4096;
const isBreak = character => character === '\n' || character === '\r';
const isHigh = code => code >= 0xd800 && code <= 0xdbff;
const isLow = code => code >= 0xdc00 && code <= 0xdfff;

function bounded(text, limit) {
  let end = Math.min(text.length, limit);
  if (isHigh(text.charCodeAt(end - 1)) && isLow(text.charCodeAt(end))) end--;
  return text.slice(0, end);
}

/** A plain, serializable diagnostic. Missing/invalid locations stay unavailable. */
export function diagnosticFromError(error, source) {
  if (source !== undefined && typeof source !== 'string') throw new TypeError('Diagnostic source must be a string');
  const originalMessage = String(error.message ?? error);
  const message = bounded(originalMessage, MESSAGE_LIMIT);
  const diagnostic = {
    severity: 'error',
    code: bounded(String(error.code ?? 'E_COMPILE'), 64),
    message,
    messageTruncated: message.length < originalMessage.length,
    phase: typeof error.phase === 'string' ? bounded(error.phase, 64) : null,
    sourceName: typeof error.sourceName === 'string' ? bounded(error.sourceName, 4096) : null,
    range: null,
    frame: null,
  };
  if (Number.isSafeInteger(error.absoluteOffset) && error.absoluteOffset >= 0)
    diagnostic.absoluteOffset = error.absoluteOffset;
  const offset = error.offset;
  if (source === undefined || !Number.isSafeInteger(offset) || offset < 0 || offset > source.length) return diagnostic;

  let line = 1, lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (source[i] === '\n' || source[i] === '\r' && source[i + 1] !== '\n') {
      line++; lineStart = i + 1;
    }
  }
  const point = { offset, line, column: offset - lineStart + 1 };
  diagnostic.range = { start: point, end: { ...point } };

  let start = Math.max(lineStart, offset - FRAME_LIMIT / 2);
  if (isLow(source.charCodeAt(start)) && isHigh(source.charCodeAt(start - 1))) start--;
  let end = start;
  while (end < source.length && end - start < FRAME_LIMIT && !isBreak(source[end])) end++;
  if (isHigh(source.charCodeAt(end - 1)) && isLow(source.charCodeAt(end))) end--;
  diagnostic.frame = {
    line,
    text: source.slice(start, end),
    markerOffset: Math.min(offset - start, end - start),
    truncatedStart: start > lineStart,
    truncatedEnd: end < source.length && !isBreak(source[end]),
  };
  return diagnostic;
}

// Never emit terminal controls from source, filenames, or error messages.
// Width counts displayed code points, not Unicode terminal cells/graphemes.
function visible(text) {
  let result = '', width = 0;
  for (const character of text) {
    const code = character.codePointAt(0);
    let next = character;
    if (character === '\t') next = ' '.repeat(4 - width % 4);
    else if (code < 32 || code >= 0x7f && code <= 0x9f ||
      code === 0x061c || code >= 0x200b && code <= 0x200f ||
      code >= 0x2028 && code <= 0x202e || code >= 0x2066 && code <= 0x2069 || code === 0xfeff)
      next = `\\u${code.toString(16).padStart(4, '0')}`;
    result += next;
    width += next === character ? 1 : next.length;
  }
  return { text: result, width };
}

/** Render a diagnostic (including one round-tripped through JSON) as plain text. */
export function formatDiagnostic(diagnostic) {
  if (!diagnostic || typeof diagnostic !== 'object' || typeof diagnostic.message !== 'string')
    throw new TypeError('Expected a structured diagnostic');
  const { range, frame, sourceName } = diagnostic;
  const location = range ? ` at ${sourceName ? sourceName + ':' : ''}${range.start.line}:${range.start.column}` :
    sourceName ? ` in ${sourceName}` : '';
  const heading = visible(`${diagnostic.code}${location}: ${diagnostic.message}${diagnostic.messageTruncated ? '…' : ''}`).text;
  if (!frame) return heading;
  const prefix = frame.truncatedStart ? '… ' : '';
  const text = visible(prefix + frame.text + (frame.truncatedEnd ? ' …' : '')).text;
  const marker = visible(prefix + frame.text.slice(0, frame.markerOffset)).width;
  const gutter = String(frame.line);
  return `${heading}\n${gutter} | ${text}\n${' '.repeat(gutter.length)} | ${' '.repeat(marker)}^`;
}
