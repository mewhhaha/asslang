// Explicit host shell: stdin/JSON/filesystem I/O stays outside the pure kernel.
import { readFile } from 'node:fs/promises';
import { compileSources } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';
import { expandedCorpus } from '../expanded-corpus.mjs';

async function main() {
  const [id, ...flags] = process.argv.slice(2);
  const entry = expandedCorpus.find(e => e.kind === 'case-study' && e.id === id);
  if (!entry || flags.some(f => f !== '--simd') || flags.length > 1)
    throw new Error('Usage: node examples/case-studies/app.mjs CASE_ID [--simd] < arguments.json');
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('JSON input exceeds the 1 MiB host limit');
    chunks.push(chunk);
  }
  const args = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!Array.isArray(args)) throw new TypeError('Input must be a JSON array of export arguments');
  const files = await Promise.all([...(entry.libraries ?? []), entry.path].map(async path => ({
    name: path, source: await readFile(new URL('../'+path, import.meta.url), 'utf8'),
  })));
  const compiled = compileSources(files, { simd: flags.includes('--simd') });
  const runtime = await createRuntime(compiled, { pages: 16 });
  const result = runtime.call(entry.name, args);
  // JSON cannot encode nonfinite numbers; do not silently print null instead.
  console.log(JSON.stringify(result, (_, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Result is not finite JSON data');
    return ArrayBuffer.isView(value) ? Array.from(value) : value;
  }));
}
try { await main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
