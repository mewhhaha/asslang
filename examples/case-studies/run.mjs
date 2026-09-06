import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileSources, supportsSIMD } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';
import { expandedCorpus } from '../expanded-corpus.mjs';

const plain = value => ArrayBuffer.isView(value) ? Array.from(value) : Array.isArray(value) ? value.map(plain) :
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,plain(v)])) : value;
for (const entry of expandedCorpus.filter(e => e.kind === 'case-study')) {
  const paths = [...(entry.libraries ?? []), entry.path];
  const sources = await Promise.all(paths.map(async path => ({
    name: path, source: await readFile(new URL('../'+path,import.meta.url),'utf8'),
  })));
  for (const simd of supportsSIMD() ? [false,true] : [false]) {
    const compiled = compileSources(sources,{simd});
    const value = plain((await createRuntime(compiled,{pages:4})).call(entry.name,entry.args));
    assert.deepEqual(value,entry.expected,entry.id);
    console.log(JSON.stringify({case:entry.id,simd,result:value,vectorizedLoops:compiled.stats.functions[0].simd.vectorizedLoops}));
  }
}
