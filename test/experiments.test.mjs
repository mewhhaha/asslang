import test from 'node:test';
import {readdir} from 'node:fs/promises';
import {compile} from '../src/compiler.mjs';
import {createRuntime} from '../src/abi.mjs';
import {runExperimentCases} from './experiment-runner.mjs';
for(const name of (await readdir(new URL('./experiments/',import.meta.url))).filter(n=>n.endsWith('.mjs')).sort()) {
  const {cases}=await import(new URL('./experiments/'+name,import.meta.url));
  for(const c of cases)test(`experiment: ${c.name}`,()=>runExperimentCases([c],compile,createRuntime));
}
