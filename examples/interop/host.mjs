import { readFile } from 'node:fs/promises';
import { compile } from '../../src/compiler.mjs';
import { createRuntime, createCapability } from '../../src/abi.mjs';

const source = await readFile(new URL('./host_effects.ass', import.meta.url), 'utf8');
const runtime = await createRuntime(compile(source));
const grant = createCapability({
  read_scale: { parameters: ['Text'], result: 'Num',
    validate: key => key === 'demo', call: () => 0.5 },
  audit: { parameters: ['Text','Num'], result: 'Bool',
    validate: (key,value) => key === 'demo' && Number.isFinite(value) && value <= 1000,
    call: (key,value) => { console.log('Audit:', key, value); return true; } },
}, { maxCalls: 2 });

console.log(runtime.call('measured', ['demo', [3,4]], { capability: grant }));
console.log('Remaining host calls:', grant.remaining);
grant.revoke();
