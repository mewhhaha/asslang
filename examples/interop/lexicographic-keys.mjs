import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compile } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const source = await readFile(new URL('../case-studies/ordering/schedule_jobs.ass', import.meta.url), 'utf8');
const repeated = source.replace('sort_by ({priority, duration} -> (-priority, duration))',
  'sort_by (job -> job.duration)\n    |> sort_by (job -> -job.priority)');
const args = [[2,1,2,3,2], [9,1,4,8,4]], reports = [];
for (const [label, program, budget] of [['tuple', source, 34], ['repeated', repeated, 63]]) {
  const artifact = compile(program, {maxLoopIterations:budget});
  const sites = artifact.stats.functions[0].ordering.sites;
  const scratchBytes = args[0].length*sites.reduce((n,s) => n+s.scratchBytesPerSourceEvent, 0);
  const runtime = await createRuntime(artifact);
  const result = [...runtime.call('schedule_jobs', args, {scratchBytes,outputBytes:40})];
  assert.deepEqual(result, [3,2,4,0,1]);
  const short = await createRuntime(compile(program, {maxLoopIterations:budget-1}));
  assert.throws(() => short.call('schedule_jobs', args), WebAssembly.RuntimeError);
  reports.push({label,result,sortSites:sites.length,scratchBytes,loopUnits:budget,wasmBytes:artifact.bytes.length});
}
assert.equal(reports[0].sortSites, 1);
assert.equal(reports[1].sortSites, 2);
console.log(JSON.stringify({reports,
  note:'Same stable priority ordering. These are exact storage/work counts, not wall-clock speedups or an automatic repeated-sort rewrite.'}, null, 2));
