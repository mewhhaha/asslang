import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, stat, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve, relative, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { compile, check, verifyCertificate } from '../src/compiler.mjs';
import { createRuntime, createCapability } from '../src/abi.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const tutorialPaths = ['README.md', 'docs/GETTING-STARTED.md', 'docs/LANGUAGE-TOUR.md', 'docs/CATEGORY-THEORY.md'];
const navigationPaths = ['docs/CASE-STUDIES.md', 'docs/CASE-STUDIES-VALIDATION.md', 'examples/case-studies/workflows/README.md', 'docs/README.md', 'docs/EVIDENCE.md', 'docs/EVIDENCE-RESIDUALS.md', 'docs/DOCUMENTATION-VALIDATION.md'];
const pages = new Map(await Promise.all([...tutorialPaths, ...navigationPaths].map(async path => [path, await readFile(resolve(root, path), 'utf8')])));
const examples = [];
for (const path of tutorialPaths) for (const m of pages.get(path).matchAll(/<!-- example: ([a-z0-9-]+) -->\n```(js|ass)\n([\s\S]*?)\n```/g))
  examples.push({ id: m[1], language: m[2], source: m[3], path });
const normalize = x => ArrayBuffer.isView(x) || Array.isArray(x) ? Array.from(x, normalize) : x && typeof x === 'object'
  ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, normalize(v)])) : x;
const modes = [false, true].flatMap(simd => [false, true].flatMap(reductionFusion =>
  [false, true].map(memoizeReductions => ({ simd, reductionFusion, memoizeReductions }))));
const jsOutputs = {
  'readme-runtime': '14',
  'getting-started-runtime': '[ 0.5, 1.25, 2.125 ]',
  'getting-started-diagnostics': 'false\nE_CAUSAL_ACCESS',
  'category-reconstruction': '{"a":-3,"b":3}',
  'category-batch': '5\n{"input":3,"output":9}',
};
const assCases = {
  'readme-language': [['prefixes', [[1, 2, 3]], [1, 3, 6]], ['gradient', [{ x: 3, y: 4 }], { x: 6, y: 8 }]],
  'getting-started-energy': [['energy', [[1, 2, 3]], 14]],
  'tour-functions': [['combine', [3], { value: 5, pair: { _0: 3, _1: 5 } }]],
  'tour-streams': [['running', [[1, 2, 3]], [2, 5, 9]]],
  'tour-noncausal': 'E_CAUSAL_ACCESS',
  'tour-stop': [['reach_six', [[1, 2, 3, 100]], { state: 6, steps: 3, done: true }]],
  'tour-linearize': [['sensitivity', [{ x: 3, y: 4 }], { value: { square: 9, sum: 7 }, along_x: { square: 6, sum: 1 } }]],
  'tour-demand': [['increment', [3], 4]],
  'tour-effects': [['checked_energy', [[1, 2, 3]], { value: 14, accepted: true }]],
};

test('every tutorial code block is registered and the root README remains an overview', () => {
  assert.equal(new Set(examples.map(e => e.id)).size, examples.length);
  assert.deepEqual(examples.map(e => e.id).sort(), [...Object.keys(jsOutputs), ...Object.keys(assCases)].sort());
  for (const path of tutorialPaths)
    assert.equal([...pages.get(path).matchAll(/^```(?:ass|js)\n/gm)].length, examples.filter(e => e.path === path).length, path);
  assert(pages.get('README.md').trimEnd().split('\n').length <= 100, 'Move long explanations to docs instead of growing the README');
});

for (const example of examples) test(`published example executes: ${example.id}`, async () => {
  if (example.language === 'js') {
    const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', example.source], { cwd: root, timeout: 15_000, maxBuffer: 1_000_000 });
    assert.equal(stdout.trim(), jsOutputs[example.id]);
    return;
  }
  const expected = assCases[example.id];
  for (const mode of modes) {
    if (typeof expected === 'string') {
      const result = check(example.source, mode);
      assert.equal(result.ok, false); assert.equal(result.diagnostics[0].code, expected); continue;
    }
    const compiled = compile(example.source, mode);
    assert(verifyCertificate(compiled.certificate.steps));
    const runtime = await createRuntime(compiled);
    for (const [name, args, value] of expected) {
      let capability;
      if (example.id === 'tour-effects') {
        assert.throws(() => runtime.call(name, args), e => e.code === 'E_CAPABILITY');
        capability = createCapability({ audit: { parameters: ['Num'], result: 'Bool', call: x => x === 14 } }, { maxCalls: 1 });
      }
      assert.deepEqual(normalize(runtime.call(name, args, { capability })), normalize(value));
      if (capability) assert.equal(capability.remaining, 0);
    }
  }
});

test('the getting-started CLI commands run, check and emit the documented program', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'asslang-docs-'));
  try {
    await writeFile(join(temp, 'energy.ass'), examples.find(e => e.id === 'getting-started-energy').source);
    const commands = pages.get('docs/GETTING-STARTED.md').split('\n').filter(line => line.startsWith('node src/cli.mjs energy.ass '));
    assert.equal(commands.length, 3);
    for (const command of commands) {
      // These documented lines deliberately use simple, single-quoted arguments.
      // No shell execution, variable expansion or arbitrary Markdown command runner.
      const words = command.match(/'[^']*'|\S+/g).slice(1).map(word => word.startsWith("'") ? word.slice(1, -1) : word);
      const args = words.map(word => ['energy.ass', 'energy.wasm'].includes(word) ? join(temp, word) : word);
      const { stdout } = await exec(process.execPath, args, { cwd: root, timeout: 15_000 });
      if (args.includes('--run')) assert.equal(stdout.trim(), '14');
      if (args.includes('--check')) assert.equal(JSON.parse(stdout).ok, true);
    }
    assert(WebAssembly.validate(await readFile(join(temp, 'energy.wasm'))));
    const metadata = JSON.parse(await readFile(join(temp, 'energy.wasm.json'), 'utf8'));
    assert.equal(metadata.executionLimits.maxLoopIterations, 10000);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

function localLinks(markdown, path) {
  // The new entry pages use inline Markdown links; ignore fenced code first.
  const prose = markdown.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');
  return [...prose.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)].flatMap(m => {
    const url = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return [];
    const [name, fragment = ''] = url.split('#');
    return [{ path: name ? resolve(root, dirname(path), decodeURIComponent(name)) : resolve(root, path), fragment: decodeURIComponent(fragment) }];
  });
}
function anchors(markdown) {
  const result = new Set(), counts = new Map();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const text = match[1].replace(/[`*_~]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
    const count = counts.get(text) ?? 0;
    result.add(text + (count ? `-${count}` : '')); counts.set(text, count + 1);
  }
  return result;
}

test('local file and heading links in entry pages resolve without network access', async t => {
  let checked = 0;
  for (const [path, markdown] of pages) for (const link of localLinks(markdown, path)) {
    const relativePath = relative(root, link.path);
    assert(!relativePath.startsWith(`..${sep}`), `Link leaves repository: ${path}`);
    const info = await stat(link.path);
    assert(info.isFile() || info.isDirectory(), `${path} -> ${relativePath}`);
    if (link.fragment) {
      const text = await readFile(link.path, 'utf8');
      assert(anchors(text).has(link.fragment), `${path} -> ${relativePath}#${link.fragment}`);
    }
    checked++;
  }
  t.diagnostic(JSON.stringify({ localLinks: checked }));
});

test('all top-level technical and historical documentation remains reachable from the index', async t => {
  const seen = new Set(), queue = ['docs/README.md'];
  for (let head = 0; head < queue.length; head++) {
    const path = queue[head];
    if (seen.has(path)) continue;
    let text;
    try { text = await readFile(resolve(root, path), 'utf8'); } catch { continue; }
    seen.add(path);
    for (const link of localLinks(text, path)) {
      const dest = relative(root, link.path).split(sep).join('/');
      if (dest.startsWith('docs/') && dest.endsWith('.md') && !seen.has(dest)) queue.push(dest);
    }
  }
  const docs = (await readdir(resolve(root, 'docs'))).filter(p => p.endsWith('.md'));
  for (const path of docs) assert(seen.has(`docs/${path}`), `Orphaned documentation: ${path}`);
  t.diagnostic(JSON.stringify({ reachableTopLevelDocuments: docs.length }));
});

test('documented npm commands name real scripts and the research example executes', async () => {
  const { scripts } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  for (const [path, text] of pages) for (const match of text.matchAll(/npm run ([a-z][a-z0-9:-]*)/g))
    assert(Object.hasOwn(scripts, match[1]), `${path}: missing npm script ${match[1]}`);
  const { stdout } = await exec(process.execPath, ['examples/interop/evidence-residual.mjs'], { cwd: root, timeout: 15_000 });
  assert.deepEqual(JSON.parse(stdout).additional, [[0]]);
});
