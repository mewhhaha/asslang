import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compile } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const cases = [
  { file:'threshold', name:'reach_target', args:[[2,3,-99],5],
    explicit: source => source
      .replace('let {state: total, steps: visited, done: reached} =', 'let stopped =')
      .replace('  require (limit', '  let total = stopped.state;\n  let visited = stopped.steps;\n  let reached = stopped.done;\n  require (limit') },
  { file:'shared_report', name:'running_report', args:[[1,2,3],{start:0,alert:3}],
    explicit: source => source.replace('let {start, alert} = settings;', 'let start = settings.start;\n  let alert = settings.alert;') },
  { file:'paired_error', name:'error_summary', args:[[2,5,8],[1,5,6]],
    explicit: source => source.replace('let {count, squares, largest} =', 'let reduced =')
      .replace('  let rms', '  let count = reduced.count;\n  let squares = reduced.squares;\n  let largest = reduced.largest;\n  let rms') },
];
const results = [];
for (const entry of cases) {
  const source = await readFile(new URL(`../case-studies/vertical/${entry.file}.ass`, import.meta.url), 'utf8');
  const explicit = entry.explicit(source);
  const c = compile(source, {maxLoopIterations:100}), before = compile(explicit, {maxLoopIterations:100});
  assert.deepEqual(c.bytes, before.bytes);
  const value = (await createRuntime(c)).call(entry.name, entry.args);
  assert.deepEqual(value, (await createRuntime(before)).call(entry.name, entry.args));
  results.push({name:entry.name,result:value,sameBytes:true,loops:c.stats.functions[0].loops,
    patternSourceLines:source.trimEnd().split('\n').length,
    explicitProjectionLines:explicit.trimEnd().split('\n').length});
}
console.log(JSON.stringify({cases:results,
  note:'Same emitted programs; this is a source ergonomics comparison, not a timing or user-study result.'},
  (_,v)=>ArrayBuffer.isView(v)?Array.from(v):v, 2));
