import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, check, checkSources, createCompiler, CompileError, formatDiagnostic } from '../src/compiler.mjs';
import { diagnosticCases } from './diagnostic-cases.mjs';
const source = 'export fn main = (xs: [Num]) -> sum xs + count xs;';

for (const experimentalReductionFusion of [false, true]) {
  for (const entry of diagnosticCases) {
    test(`structured ${entry.name} diagnostic, fusion=${experimentalReductionFusion}`, () => {
      const report = check(entry.source, { ...entry.options, experimentalReductionFusion });
      assert.equal(report.schemaVersion, 1);
      assert.equal(report.ok, false);
      assert.equal(report.diagnostics.length, 1);
      const diagnostic = report.diagnostics[0];
      assert.equal(diagnostic.code, entry.code);
      assert.equal(diagnostic.phase, entry.phase);
      assert.equal(diagnostic.severity, 'error');
      assert.deepEqual(diagnostic.range.start, diagnostic.range.end);
      assert.ok(diagnostic.range.start.offset >= 0 && diagnostic.range.start.offset <= entry.source.length);
      assert.match(formatDiagnostic(diagnostic), /\n\d+ \| .*\n\s+\| .*\^$/);
      assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
    });
  }
  test(`checks report exports without retaining source, binary or timings, fusion=${experimentalReductionFusion}`, () => {
    const options = { experimentalReductionFusion };
    const expected = compile(source, options), report = check(source, options);
    assert.deepEqual(report, { schemaVersion: 1, ok: true, diagnostics: [], signatures: expected.signatures, exports: expected.exports });
    assert.deepEqual(Object.keys(report), ['schemaVersion', 'ok', 'diagnostics', 'signatures', 'exports']);
  });
}

test('full-pipeline checks never instantiate or execute even effectful or trapping exports', () => {
  const instantiate = WebAssembly.instantiate, nativeCompile = WebAssembly.compile;
  let calls = 0;
  WebAssembly.instantiate = WebAssembly.compile = () => { calls++; throw new Error('Execution forbidden'); };
  try {
    assert.equal(check('host fn tick: Num -> Num; export fn main = (x: Num) -> effect { perform tick x; x };').ok, true);
    assert.equal(check('export fn main = (x: Num) -> require false x;').ok, true);
    assert.equal(calls, 0);
  } finally { WebAssembly.instantiate = instantiate; WebAssembly.compile = nativeCompile; }
});

test('invalid API inputs and unexpected failures are not converted into language diagnostics', () => {
  for (const bad of [undefined, null, 4, {}, []]) assert.throws(() => check(bad), TypeError);
  for (const options of [null, [], { maxExpansion: 0 }, { experimentalReductionFusion: 1 }])
    assert.throws(() => check(source, options), TypeError);
  for (const files of [null, [], [{ name: 'a', source: 0 }], [{ name: '', source }]])
    assert.throws(() => checkSources(files), TypeError);
  const validate = WebAssembly.validate, sentinel = new Error('Deliberate internal failure');
  WebAssembly.validate = () => { throw sentinel; };
  try { assert.throws(() => check(source), error => error === sentinel); }
  finally { WebAssembly.validate = validate; }
});

test('source locations preserve file-local and absolute offsets without changing compact formatting', () => {
  const first = { name: 'helpers.ass', source: 'fn id = x -> x; // no newline' };
  const second = { name: 'app.ass', source: '// 🦊\r\nexport fn main = (x: Num) -> do {\r\n\tmissing x\r\n};' };
  const diagnostic = checkSources([first, second]).diagnostics[0];
  assert.equal(diagnostic.sourceName, 'app.ass');
  assert.deepEqual(diagnostic.range.start, { offset: second.source.indexOf('missing'), line: 3, column: 2 });
  assert.equal(diagnostic.absoluteOffset, first.source.length + 1 + second.source.indexOf('missing'));
  assert.equal(formatDiagnostic(diagnostic), "E_NAME at app.ass:3:2: Unknown name 'missing'\n3 |     missing x\n  |     ^");
  const error = new CompileError('problem', 2, 'E_TEST'); error.sourceName = 'a.ass';
  assert.equal(error.format('a\nb'), 'E_TEST at a.ass:2:1: problem');
  assert.equal(error.toDiagnostic('a\nb').range.start.line, 2);
});

test('duplicate declarations point into the correct fragment', () => {
  const a = 'fn helper = x -> x;', b = 'fn helper = x -> x; export fn main = (x: Num) -> helper x;';
  const diagnostic = checkSources([{ name: 'a', source: a }, { name: 'b', source: b }]).diagnostics[0];
  assert.equal(diagnostic.code, 'E_NAME'); assert.equal(diagnostic.sourceName, 'b');
  assert.equal(diagnostic.range.start.offset, b.indexOf('helper'));
});

test('EOF, empty sources, and lone CR have honest point locations', () => {
  for (const text of ['', 'x', 'x\n', 'x\r\n', 'x\r']) {
    const diagnostic = new CompileError('end', text.length).toDiagnostic(text);
    assert.deepEqual(diagnostic.range.start, diagnostic.range.end);
    assert.equal(diagnostic.range.start.offset, text.length);
    assert.equal(diagnostic.range.start.line, text === '' || text === 'x' ? 1 : 2);
    assert.equal(diagnostic.frame.markerOffset, text === 'x' ? 1 : 0);
  }
  const text = 'export fn main = (x: Num) ->';
  assert.equal(check(text).diagnostics[0].range.start.offset, text.length);
});

test('UTF-16 coordinates round-trip across every point in seeded mixed-line sources', () => {
  let seed = 47;
  const next = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const pieces = ['abc', '🦊', '\t', '\n', '\r\n', '\r', 'λ'];
  for (let run = 0; run < 40; run++) {
    const text = Array.from({ length: 20 }, () => pieces[next() % pieces.length]).join('');
    for (let offset = 0; offset <= text.length; offset++) {
      const diagnostic = new CompileError('point', offset).toDiagnostic(text);
      // A CR inside CRLF is not a completed line break before its LF.
      const prefix = text.slice(0, offset).replace(/\r$/, match => text[offset] === '\n' ? '' : match);
      const lines = prefix.split(/\r\n|\r|\n/);
      const column = lines.at(-1).length + 1 + (text[offset] === '\n' && text[offset - 1] === '\r' ? 1 : 0);
      assert.deepEqual(diagnostic.range.start, { offset, line: lines.length, column });
    }
  }
});

test('unavailable sources and invalid offsets do not fabricate a range', () => {
  assert.equal(new CompileError('unknown').toDiagnostic().range, null);
  for (const offset of [-1, NaN, Infinity, 0.5, 20]) {
    const diagnostic = new CompileError('unknown', offset).toDiagnostic('abc');
    assert.equal(diagnostic.range, null); assert.equal(diagnostic.frame, null);
    assert.equal(formatDiagnostic(diagnostic), 'E_COMPILE: unknown');
  }
  assert.throws(() => new CompileError('x').toDiagnostic(4), TypeError);
  assert.throws(() => formatDiagnostic(null), TypeError);
});

test('oversized bundles retain their limit diagnostic without blaming the final file', () => {
  const files = [{ name: 'large', source: ' '.repeat(1_000_000) }, { name: 'app', source }];
  const diagnostic = checkSources(files).diagnostics[0];
  assert.equal(diagnostic.code, 'E_LIMIT'); assert.equal(diagnostic.phase, 'source');
  assert.equal(diagnostic.sourceName, null); assert.equal(diagnostic.range, null); assert.equal(diagnostic.frame, null);
  const single = check(' '.repeat(1_000_001)).diagnostics[0];
  assert.equal(single.phase, 'parse'); assert.ok(single.frame.text.length <= 160);
});

test('source frames and messages are bounded without splitting surrogate pairs', () => {
  const text = 'a'.repeat(100) + '🦊'.repeat(100) + 'z'.repeat(100);
  for (let offset = 0; offset <= text.length; offset++) {
    const error = new CompileError('m'.repeat(4095) + '🦊', offset);
    const diagnostic = error.toDiagnostic(text);
    assert.ok(diagnostic.frame.text.length <= 160);
    assert.ok(!/[\ud800-\udbff]$/.test(diagnostic.frame.text));
    assert.ok(!/^[\udc00-\udfff]/.test(diagnostic.frame.text));
    assert.equal(diagnostic.message.length, 4095);
    assert.equal(diagnostic.messageTruncated, true);
  }
  const middle = new CompileError('x', 200).toDiagnostic(text);
  assert.equal(middle.frame.truncatedStart, true); assert.equal(middle.frame.truncatedEnd, true);
  assert.match(formatDiagnostic(middle), /…/);
});

test('rendering escapes control/bidi characters in source, filenames and messages', () => {
  const text = '\x1b[2J\t\u202emissing';
  const error = new CompileError('bad\n\x1bmessage', text.indexOf('missing'), 'E_TEST');
  error.sourceName = 'a\x1b\u2066.ass';
  const diagnostic = error.toDiagnostic(text), formatted = formatDiagnostic(diagnostic);
  assert.ok(!/[\x00-\x09\x0b-\x1f\x7f-\x9f\u202e\u2066]/.test(formatted));
  assert.match(formatted, /\\u001b/); assert.match(formatted, /\\u202e/); assert.match(formatted, /\\u000a/);
  assert.equal(formatDiagnostic(JSON.parse(JSON.stringify(diagnostic))), formatted);
  assert.equal(error.message, 'bad\n\x1bmessage'); assert.equal(error.offset, text.indexOf('missing'));
});

test('diagnostics are independent snapshots, not mutable aliases of compiler errors', () => {
  const error = new CompileError('problem', 1, 'E_TEST');
  const a = error.toDiagnostic('abc'); a.range.start.offset = 99; a.frame.text = 'changed'; a.message = 'changed';
  assert.equal(a.range.end.offset, 1);
  assert.equal(error.toDiagnostic('abc').range.start.offset, 1);
  assert.equal(error.toDiagnostic('abc').message, 'problem');
});

test('session checks share bounded caches without exposing cached artifacts or names', () => {
  const session = createCompiler({ maxEntries: 1 });
  const first = session.check(source); assert.equal(session.stats.misses, 1);
  first.signatures.main = 'poisoned'; first.exports[0].name = 'poisoned';
  const second = session.checkSources([{ name: 'new.ass', source }]);
  assert.equal(session.stats.hits, 1); assert.equal(second.exports[0].name, 'main');
  assert.equal(second.signatures.main, compile(source).signatures.main);
  session.clear();
  const bad = 'export fn main = (x: Num) -> missing x;';
  assert.equal(session.check(bad).ok, false);
  assert.equal(session.checkSources([{ name: 'bad.ass', source: bad }]).diagnostics[0].sourceName, 'bad.ass');
  assert.equal(session.stats.entries, 0); assert.equal(session.stats.misses, 2);
  assert.throws(() => session.check(source, { maxExpansion: 0 }), TypeError);
  assert.throws(() => session.checkSources(null), TypeError);
});
