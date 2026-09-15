import {readFile, writeFile} from 'node:fs/promises';
import {validateOperatorText} from '../src/operator-library.mjs';
import {parse, tokenize} from '../src/frontend.mjs';
const input = new URL('../lib/expression-operators.ass', import.meta.url);
const output = new URL('../src/operator-source.mjs', import.meta.url);
const source = await readFile(input, 'utf8');
validateOperatorText(source,tokenize);
const definitions = parse(source).definitions;
if (definitions.length !== 15 || definitions.some(d => d.exported || d.params[0] !== 'scalar'))
  throw new Error('Expected fifteen ordinary scalar-parameter operator factories');
const text = '// Generated from lib/expression-operators.ass by scripts/build-operators.mjs.\n'
  + `export const operatorSource = ${JSON.stringify(source)};\n`;
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== text) throw new Error('Operator source snapshot is stale');
  console.log('Operator source snapshot matches all fifteen factories.');
} else await writeFile(output, text);
