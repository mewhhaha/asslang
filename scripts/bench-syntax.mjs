// Parser-only evidence; no timing threshold or claim about Wasm throughput.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cpus, platform, arch } from 'node:os';
import { createHash } from 'node:crypto';
import { parse, tokenize } from '../src/frontend.mjs';

const options = {}, args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (!['--output', '--baseline'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--'))
    throw new Error('Usage: node scripts/bench-syntax.mjs [--output REPORT.json] [--baseline CHECKOUT]');
  options[args[i].slice(2)] = args[++i];
}
const baseline = options.baseline ? await import(pathToFileURL(resolve(options.baseline, 'src/frontend.mjs'))) : null;
const warmup = 20, samples = 15, batch = 12;
let sink;
function measure(run) {
  for (let i = 0; i < warmup; i++) sink = run();
  const values = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    for (let j = 0; j < batch; j++) sink = run();
    values.push((performance.now() - started) / batch);
  }
  values.sort((a, b) => a - b);
  return { p50: values[Math.floor(samples / 2)], p95: values[Math.floor(samples * 0.95)], unit: 'ms/parse', samples, batch };
}
const workloads = [
  { name: 'legacy-400-helpers', legacy: true, source: Array.from({ length: 400 }, (_, i) => `fn helper_${i}(x,y)=x+y;`).join('\n') },
  { name: 'unary-400-helpers', source: Array.from({ length: 400 }, (_, i) => `fn helper_${i} = x -> y -> x+y;`).join('\n') },
  ...[64, 256, 1000].map(width => ({ name: `unary-tuple-pattern-${width}`,
    source: `fn wide = (${Array.from({ length: width }, (_, i) => `x${i}`).join(',')}) -> x0;` })),
  { name: 'unary-1000-record-puns', source: `fn record = x -> {${Array.from({ length: 1000 }, (_, i) => `field${i}`).join(',')}};` },
  { name: 'unary-200-groupings', source: `fn grouped = x -> ${'('.repeat(200)}x${')'.repeat(200)};` },
];
const measurements = workloads.map(({ name, source, legacy }) => ({
  name, sourceCharacters: source.length, tokens: tokenize(source).length - 1,
  syntaxNodes: parse(source).nodeCount,
  sha256: createHash('sha256').update(source).digest('hex'),
  current: measure(() => parse(source)),
  ...(baseline && legacy ? { baseline: measure(() => baseline.parse(source)) } : {}),
}));
const report = {
  environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  method: { warmup, samples, batch, scope: 'tokenization + parse + syntax lowering; not inference, emission, or execution',
    caveat: 'Sequential local batch measurements; p95 is of batch averages. Canonical and legacy source sizes differ. No universal speedup claim.' },
  measurements,
};
if (!sink?.definitions.length) throw new Error('Benchmark did not retain a parsed program');
const json = JSON.stringify(report, null, 2) + '\n';
if (options.output) await writeFile(options.output, json);
console.log(json);
