import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, planDescentBatch, verifyDescentBatch } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

/** Teaching helper, not a compiler API. Return the weakest monotone additional
 * evidence sufficient for every promised alternative. Indices denote facts,
 * not cached runtime authority. See docs/EVIDENCE-RESIDUALS.md.
 * @param {number} labelCount Integer in [0,8].
 * @param {number[][]} guarantee Alternative sufficient supports promised by a caller.
 * @param {number[][]} target Alternative sufficient supports for the target.
 * @returns {ReadonlyArray<ReadonlyArray<number>>} Minimal completions in mask order.
 */
export function residualEvidence(labelCount, guarantee, target) {
  if (!Number.isSafeInteger(labelCount) || labelCount < 0 || labelCount > 8)
    throw new RangeError('The teaching example supports zero through eight evidence labels');
  function masks(family) {
    if (!Array.isArray(family)) throw new TypeError('An evidence family must be an array');
    if (family.length > 256) throw new RangeError('An evidence family is limited to 256 supports');
    const result = new Set();
    for (const term of family) {
      if (!Array.isArray(term) || term.length > labelCount)
        throw new TypeError('A support must be an array no longer than the label set');
      let mask = 0;
      for (const i of term) {
        if (!Number.isSafeInteger(i) || i < 0 || i >= labelCount || (mask & (1 << i)))
          throw new TypeError('Support indices must be distinct integers in the label set');
        mask |= 1 << i;
      }
      result.add(mask);
    }
    return [...result];
  }
  const promises = masks(guarantee), targets = masks(target), size = 1 << labelCount;
  const sufficient = new Uint8Array(size);
  for (const mask of targets) sufficient[mask] = 1;
  for (let bit = 1; bit < size; bit <<= 1) for (let mask = 0; mask < size; mask++)
    if (mask & bit) sufficient[mask] |= sufficient[mask ^ bit];
  const accepts = new Uint8Array(size);
  for (let mask = 0; mask < size; mask++)
    accepts[mask] = +promises.every(promise => sufficient[mask | promise]);
  const result = [];
  for (let mask = 0; mask < size; mask++) {
    if (!accepts[mask]) continue;
    let minimal = true;
    for (let bit = 1; bit < size; bit <<= 1)
      if ((mask & bit) && accepts[mask ^ bit]) { minimal = false; break; }
    if (minimal) result.push(Object.freeze(Array.from({ length: labelCount }, (_, i) => i)
      .filter(i => mask & (1 << i))));
  }
  return Object.freeze(result);
}

// A complete, ordinary Asslang guard. The caller's promise is rechecked, not
// accepted merely because residualEvidence produced a structural completion.
export const evidenceResidualSource = `
  export fn flags = (e0:Bool) -> (e1:Bool) -> (e2:Bool) ->
    require ((e1 || e2) && e0) true;
  export fn values = (p:{a:{raw:Num,summary:Num},b:{raw:Num,summary:Num},c:{summary:Num}}) -> do {
    let e0 = p.a.raw == p.b.raw;
    let e1 = p.b.summary == p.c.summary;
    let e2 = p.a.summary == p.c.summary;
    let coherent = p.a.raw*p.a.raw == p.a.summary && p.b.raw*p.b.raw == p.b.summary;
    require (coherent && (e1 || e2) && e0) {input:p.a.raw,output:p.a.summary}
  };
`;

export async function runEvidenceResidualExample() {
  const graph = { nodes: ['raw', 'summary'], edges: [{ from: 'raw', to: 'summary', map: 'square' }] };
  const patches = [{ name: 'a', nodes: graph.nodes }, { name: 'b', nodes: graph.nodes },
    { name: 'c', nodes: ['summary'] }];
  const options = {
    queries: [{ name: 'input', node: 'raw', left: 'a', right: 'b' },
      { name: 'output', node: 'summary', left: 'a', right: 'c' }],
    candidates: [{ node: 'raw', left: 'a', right: 'b', cost: 4 },
      { node: 'summary', left: 'b', right: 'c', cost: 1 },
      { node: 'summary', left: 'a', right: 'c', cost: 3 }],
  };
  const plan = planDescentBatch(graph, patches, options);
  assert(verifyDescentBatch(graph, patches, options, plan));
  const guarantee = [[1], [2]];
  const additional = residualEvidence(3, guarantee, plan.frontier.minimal);
  assert.deepEqual(additional, [[0]]);
  // An existential choice would incorrectly return [[0],[1]] in this example.
  const uncertain = residualEvidence(2, [[0], [1]], [[0, 1]]);
  assert.deepEqual(uncertain, [[0, 1]]);
  assert.deepEqual(residualEvidence(2, [[0]], [[0, 1]]), [[1]]);

  const runtime = await createRuntime(compile(evidenceResidualSource, { maxLoopIterations: 0 }));
  const pieces = { a: { raw: 3, summary: 9 }, b: { raw: 3, summary: 9 }, c: { summary: 9 } };
  const values = runtime.call('values', [pieces]);
  assert.deepEqual(values, { input: 3, output: 9 });
  assert.throws(() => runtime.call('flags', [true, false, false]), WebAssembly.RuntimeError);
  assert.throws(() => runtime.call('flags', [false, true, true]), WebAssembly.RuntimeError);
  const stale = structuredClone(pieces); stale.b.raw = -3;
  assert.throws(() => runtime.call('values', [stale]), WebAssembly.RuntimeError);
  return { target: plan.frontier.minimal, guarantee, additional,
    uncertainEitherLabel: uncertain, values, callerGuaranteeRechecked: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await runEvidenceResidualExample(), null, 2));
