#!/usr/bin/env node
import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compileSources, checkSources, CompileError, formatDiagnostic } from './compiler.mjs';
import { diagnosticFromError } from './diagnostics.mjs';
import { createRuntime } from './abi.mjs';

const usage = `Usage: node src/cli.mjs INPUT.ass [--lib HELPERS.ass ...] [-o OUTPUT.wasm]
  --check                         Check through Wasm validation without execution
  --diagnostics=text|json          Source frames (default), or JSON with --check
  --run EXPORT --args '[...]'      Run a pure export and print its JSON result
  --pages N                       Fixed runtime capacity in 64-KiB pages (default: 16)
  --explain                       Print ABI, types, observations, statistics and proof
  --experimental-reduction-fusion Enable conservative reduction cohorts`;
const files = [];
const args = process.argv.slice(2);
// Select error transport before parsing so even preceding option errors are JSON.
const jsonDiagnostics = args.includes('--diagnostics=json');
class UsageError extends Error { code = 'E_OPTIONS'; }
async function main() {
  if (args.includes('--help')) {
    if (jsonDiagnostics) throw new UsageError('--help cannot be combined with --diagnostics=json');
    console.log(usage); return;
  }
  let input, output, run, jsonArgs, pages = 16, check = false, explain = false, experimentalReductionFusion = false;
  const libraries = [];
  let diagnosticFlags = 0;
  function value(index, flag) {
    const next = args[index + 1];
    if (next === undefined || next.startsWith('--')) throw new UsageError(`${flag} requires a value`);
    return next;
  }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '-o') output = value(i++, flag);
    else if (flag === '--lib') libraries.push(value(i++, flag));
    else if (flag === '--run') run = value(i++, flag);
    else if (flag === '--args') jsonArgs = value(i++, flag);
    else if (flag === '--pages') pages = Number(value(i++, flag));
    else if (flag === '--check') check = true;
    else if (flag.startsWith('--diagnostics=')) {
      if (++diagnosticFlags > 1) throw new UsageError('--diagnostics may be specified only once');
      if (!['--diagnostics=text', '--diagnostics=json'].includes(flag))
        throw new UsageError('--diagnostics must be text or json');
    }
    else if (flag === '--explain') explain = true;
    else if (flag === '--experimental-reduction-fusion') experimentalReductionFusion = true;
    else if (flag.startsWith('-') || input) throw new UsageError(`Unexpected argument: ${flag}`);
    else input = flag;
  }
  if (jsonDiagnostics && (!check || run || output || explain))
    throw new UsageError('--diagnostics=json requires --check and cannot be combined with --run, -o, or --explain');
  if (!input) throw new UsageError(usage);
  if (run && check) throw new UsageError('--run and --check are mutually exclusive');
  if (run && output) throw new UsageError('--run and -o are mutually exclusive');
  if (jsonArgs !== undefined && !run) throw new UsageError('--args requires --run');
  if (!Number.isInteger(pages) || pages < 0 || pages > 32767) throw new UsageError('--pages must be an integer between 0 and 32767');
  for (const name of [...libraries, input]) files.push({ name, source: await readFile(name, 'utf8') });
  if (jsonDiagnostics) {
    const report = checkSources(files, { experimentalReductionFusion });
    console.log(JSON.stringify(report));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }
  const result = compileSources(files, { experimentalReductionFusion });
  if (run) {
    const values = JSON.parse(jsonArgs ?? '[]');
    if (!Array.isArray(values)) throw new UsageError('--args must be a JSON array of export arguments');
    const runtime = await createRuntime(result, { pages });
    console.log(JSON.stringify(runtime.call(run, values), (_, value) => ArrayBuffer.isView(value) ? Array.from(value) : value));
  } else if (!check) {
    output ??= input.endsWith('.ass') ? input.slice(0, -4) + '.wasm' : input + '.wasm';
    // Protect every input, including alias paths and symlinks, from both outputs.
    const canonical = async path => realpath(path).catch(error => {
      if (error.code === 'ENOENT') return resolve(path);
      throw error;
    });
    const inputs = new Set(await Promise.all(files.map(f => canonical(f.name))));
    const identities = await Promise.all(files.map(f => stat(f.name)));
    for (const path of [output, output + '.json']) {
      const existing = await stat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (inputs.has(await canonical(path)) || existing && identities.some(s => s.dev === existing.dev && s.ino === existing.ino))
        throw new UsageError('Output must not overwrite source');
    }
    await writeFile(output, result.bytes);
    await writeFile(output + '.json', JSON.stringify({ abi: result.abi, exports: result.exports, signatures: result.signatures,
      observations: result.observations, sourceFiles: result.sourceFiles, stats: result.stats }, null, 2) + '\n');
    console.log(`Wrote ${output}: ${result.bytes.length} bytes`);
  }
  if (explain) console.log(JSON.stringify({ abi: result.abi, signatures: result.signatures, observations: result.observations,
    sourceFiles: result.sourceFiles, stats: result.stats, certificate: result.certificate }, null, 2));
}
try {
  await main();
} catch (error) {
  const diagnostic = error instanceof CompileError ? error.toDiagnostic(files.find(f => f.name === error.sourceName)?.source) :
    diagnosticFromError({ code: error.code ?? 'E_DRIVER', message: error.message, phase: 'driver' });
  if (jsonDiagnostics) console.log(JSON.stringify({ schemaVersion: 1, ok: false, diagnostics: [diagnostic] }));
  else console.error(error instanceof CompileError ? formatDiagnostic(diagnostic) : error.message);
  process.exitCode = 1;
}
