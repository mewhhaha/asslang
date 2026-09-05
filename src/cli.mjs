#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { compile, CompileError } from './compiler.mjs';

const usage = 'Usage: node src/cli.mjs INPUT.ass [-o OUTPUT.wasm] [--check] [--explain] [--experimental-reduction-fusion]';
let source = '';
try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(usage); process.exit(0); }
  let input, output, check = false, explain = false, experimentalReductionFusion = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('-o requires a filename');
      output = args[++i];
    } else if (args[i] === '--check') check = true;
    else if (args[i] === '--explain') explain = true;
    else if (args[i] === '--experimental-reduction-fusion') experimentalReductionFusion = true;
    else if (args[i].startsWith('-') || input) throw new Error(`Unexpected argument: ${args[i]}`);
    else input = args[i];
  }
  if (!input) throw new Error(usage);
  source = await readFile(input, 'utf8');
  const result = compile(source, { experimentalReductionFusion });
  if (!check) {
    output ??= input.endsWith('.ass') ? input.slice(0, -4) + '.wasm' : input + '.wasm';
    if (output === input) throw new Error('Output must not overwrite source');
    await writeFile(output, result.bytes);
    await writeFile(output + '.json', JSON.stringify({ abi: result.abi, exports: result.exports, signatures: result.signatures, observations: result.observations, stats: result.stats }, null, 2) + '\n');
    console.log(`Wrote ${output}: ${result.bytes.length} bytes`);
  }
  if (explain) console.log(JSON.stringify({ abi: result.abi, signatures: result.signatures, observations: result.observations, stats: result.stats, certificate: result.certificate }, null, 2));
} catch (error) {
  console.error(error instanceof CompileError ? error.format(source) : error.message);
  process.exitCode = 1;
}
