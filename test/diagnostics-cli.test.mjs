import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const command = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 });
function json(result, status) {
  assert.equal(result.status, status, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim().split('\n').length, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 1); assert.equal(report.ok, status === 0);
  return report;
}
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'asslang-diagnostics-'));
  const app = join(directory, 'app.ass'), helper = join(directory, 'helper.ass');
  try {
    await writeFile(app, 'export fn main = (x: Num) -> twice x;');
    await writeFile(helper, 'fn twice = x -> x*2;');
    await run({ directory, app, helper });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('CLI JSON checks link sources, report exports, and neither write nor modify artifacts', async () => fixture(async ({ directory, app, helper }) => {
  const before = await readdir(directory);
  const report = json(command(app, '--lib', helper, '--check', '--diagnostics=json'), 0);
  assert.deepEqual(report.diagnostics, []); assert.equal(report.exports[0].name, 'main');
  assert.equal(typeof report.signatures.main, 'string'); assert.equal(report.bytes, undefined);
  assert.deepEqual(await readdir(directory), before);
  await writeFile(app.replace('.ass', '.wasm'), 'existing binary');
  await writeFile(app.replace('.ass', '.wasm.json'), 'existing metadata');
  json(command(app, '--lib', helper, '--check', '--diagnostics=json', '--experimental-reduction-fusion'), 0);
  assert.equal(await readFile(app.replace('.ass', '.wasm'), 'utf8'), 'existing binary');
  assert.equal(await readFile(app.replace('.ass', '.wasm.json'), 'utf8'), 'existing metadata');
}));

test('CLI checks effectful and trapping programs without runtime arguments or authority', async () => fixture(async ({ app }) => {
  for (const source of [
    'host fn tick: Num -> Num; export fn main = (x: Num) -> effect { perform tick x; x };',
    'export fn main = (x: Num) -> require false x;',
  ]) {
    await writeFile(app, source);
    json(command(app, '--check', '--diagnostics=json'), 0);
  }
}));

test('CLI reports source-local compiler failures as a single JSON document', async () => fixture(async ({ app, helper }) => {
  const source = '// 🦊\r\nfn twice = x -> missing x;';
  await writeFile(helper, source);
  const report = json(command(app, '--lib', helper, '--check', '--diagnostics=json'), 1);
  const diagnostic = report.diagnostics[0];
  assert.equal(diagnostic.code, 'E_NAME'); assert.equal(diagnostic.phase, 'infer');
  assert.equal(diagnostic.sourceName, helper);
  assert.equal(diagnostic.range.start.offset, source.indexOf('missing'));
  assert.equal(diagnostic.range.start.line, 2);
}));

test('default and explicit text diagnostics keep stdout clean and add a caret frame', async () => fixture(async ({ app }) => {
  const implicit = command(app, '--check'), explicit = command(app, '--check', '--diagnostics=text');
  assert.equal(implicit.status, 1); assert.equal(implicit.stdout, '');
  assert.equal(explicit.stderr, implicit.stderr);
  assert.match(implicit.stderr, /E_NAME at .*app\.ass:1:/);
  assert.match(implicit.stderr, /\n1 \| export fn main/); assert.match(implicit.stderr, /\^/);
  await writeFile(app, 'export fn main = (x: Num) -> x;');
  const passed = command(app, '--check');
  assert.equal(passed.status, 0); assert.equal(passed.stdout, ''); assert.equal(passed.stderr, '');
}));

test('JSON transport also covers option and I/O failures regardless of flag order', async () => fixture(async ({ app, helper }) => {
  const invalid = [
    ['--bogus', app, '--check', '--diagnostics=json'],
    [app, '--diagnostics=json'],
    [app, '--check', '--diagnostics=json', '--run', 'main'],
    [app, '--check', '--diagnostics=json', '-o', 'forbidden.wasm'],
    [app, '--check', '--diagnostics=json', '--explain'],
    [app, '--check', '--diagnostics=json', '--args', '[]'],
    [app, '--check', '--diagnostics=json', '--pages', 'no'],
    [app, '--check', '--diagnostics=json', '--diagnostics=text'],
    ['--help', '--diagnostics=json'],
    ['--check', '--diagnostics=json'],
  ];
  for (const args of invalid) {
    const diagnostic = json(command(...args), 1).diagnostics[0];
    assert.equal(diagnostic.code, 'E_OPTIONS'); assert.equal(diagnostic.phase, 'driver');
    assert.equal(diagnostic.range, null); assert.equal(diagnostic.sourceName, null);
  }
  const missing = json(command(app, '--lib', helper + '.missing', '--check', '--diagnostics=json'), 1).diagnostics[0];
  assert.equal(missing.code, 'ENOENT'); assert.equal(missing.phase, 'driver'); assert.equal(missing.range, null);
  const invalidFormat = command(app, '--check', '--diagnostics=xml');
  assert.equal(invalidFormat.status, 1); assert.equal(invalidFormat.stdout, '');
  assert.match(invalidFormat.stderr, /--diagnostics must be text or json/);
}));
