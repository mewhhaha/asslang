import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../src/compiler.mjs';
import { selectDiagnostic } from '../web/diagnostic-navigation.mjs';
// Execute the real UI event handlers with explicit DOM/Worker doubles. Browser
// engine tests additionally use a real textarea; neither claims HTTP loading.
class Element {
  value = ''; textContent = ''; hidden = false; checked = false; children = []; listeners = {};
  append(child) { this.children.push(child); }
  addEventListener(event, callback) { this.listeners[event] = callback; }
  focus() { this.focused = true; }
  setSelectionRange(start, end) { this.selection = [start, end]; }
}
const elements = new Map(['output', 'details', 'examples', 'source', 'locate', 'name', 'args', 'effects', 'fusion', 'cancel', 'check', 'run']
  .map(id => [id, new Element()]));
const get = id => elements.get(id), workers = [];
class WorkerDouble {
  constructor() { workers.push(this); }
  postMessage(data) { this.request = data; }
  terminate() { this.terminated = true; }
  deliver(data) { this.onmessage({ data }); }
}
const oldDocument = globalThis.document, oldWorker = globalThis.Worker;
globalThis.document = { querySelector: selector => get(selector.slice(1)), createElement: () => new Element() };
globalThis.Worker = WorkerDouble;
await import('../web/main.mjs');
after(() => {
  get('cancel').onclick();
  if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  if (oldWorker === undefined) delete globalThis.Worker; else globalThis.Worker = oldWorker;
});
const source = '// 🦊\nexport fn main = (x: Num) -> missing x;';
const diagnostic = check(source).diagnostics[0];
const failure = { error: 'source error', diagnostics: [diagnostic] };
const success = { mode: 'check', ok: true, diagnostics: [], signatures: { main: 'Num -> Num' }, exports: [{ name: 'main' }] };
function start() { get('source').value = source; get('check').onclick(); return workers.at(-1); }

test('Check UI bypasses invalid JSON arguments and never requests demo authority', () => {
  get('args').value = 'not json'; get('effects').checked = true;
  const worker = start();
  assert.equal(worker.request.mode, 'check'); assert.equal(worker.request.args, undefined);
  assert.equal(worker.request.allowDemoEffects, false);
  worker.deliver(success);
  assert.match(get('output').textContent, /No export was executed/);
  assert.match(get('details').textContent, /Num -> Num/);
  assert.equal(worker.terminated, true);
});

test('Go to error selects the exact UTF-16 offset only on the checked source', () => {
  const worker = start(); worker.deliver(failure);
  assert.equal(get('locate').hidden, false);
  get('locate').onclick();
  assert.deepEqual(get('source').selection, [source.indexOf('missing'), source.indexOf('missing')]);
  assert.equal(get('source').focused, true);
  get('source').selection = null;
  get('source').value += ' ';
  get('source').listeners.input();
  assert.equal(get('locate').hidden, true);
  get('locate').onclick(); assert.equal(get('source').selection, null);
});

test('edits during a check make returned diagnostic navigation unavailable', () => {
  const worker = start(); get('source').value = 'different source';
  worker.deliver(failure); assert.equal(get('locate').hidden, true);
  assert.equal(get('output').textContent, 'source error');
});

test('stale worker messages and errors cannot stop or overwrite a newer check', () => {
  const old = start(), current = start();
  assert.equal(old.terminated, true);
  old.deliver(failure); old.onerror({ message: 'old error' });
  assert.equal(current.terminated, undefined);
  assert.equal(get('output').textContent, 'Checking…');
  current.deliver(success); assert.match(get('output').textContent, /Check passed/);
});

test('cancelled checks cannot later publish diagnostics', () => {
  const worker = start(); get('cancel').onclick(); worker.deliver(failure);
  assert.equal(get('output').textContent, 'Cancelled.'); assert.equal(get('locate').hidden, true);
});

test('run behavior still validates JSON and runtime errors clear source navigation', () => {
  get('args').value = 'bad'; const count = workers.length;
  get('run').onclick(); assert.equal(workers.length, count);
  assert.equal(get('output').textContent, 'Arguments must be valid JSON.');
  get('args').value = '[1]'; get('run').onclick();
  const worker = workers.at(-1);
  assert.equal(worker.request.mode, 'run'); assert.deepEqual(worker.request.args, [1]);
  assert.equal(worker.request.allowDemoEffects, true);
  worker.deliver({ error: 'RuntimeError: trap' });
  assert.equal(get('locate').hidden, true); assert.equal(get('output').textContent, 'RuntimeError: trap');
});

test('navigation rejects missing, nonintegral and out-of-range offsets while permitting EOF', () => {
  const input = new Element(); input.value = 'abc';
  for (const offset of [undefined, -1, NaN, 1.5, 4]) {
    assert.equal(selectDiagnostic(input, 'abc', { range: { start: { offset } } }), false);
    assert.equal(input.selection, undefined);
  }
  assert.equal(selectDiagnostic(input, 'abc', { range: { start: { offset: 3 } } }), true);
  assert.deepEqual(input.selection, [3, 3]);
});
