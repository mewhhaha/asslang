import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { builtinArities, primitiveArities, parse } from '../src/frontend.mjs';
import { preludeArities, preludeSource } from '../src/prelude.mjs';

// Every callable name needs a decision; this is not a theorem of minimality.
const inventory = JSON.parse(await readFile(new URL('../docs/core-inventory.json',import.meta.url),'utf8'));
const seen = new Set(), layers = {compiler:[],source:[]};
assert.equal(inventory.schemaVersion,1);
for (const decision of inventory.decisions) {
  assert(Object.hasOwn(layers,decision.layer), 'Unknown inventory layer');
  assert(decision.reason && decision.family);
  assert((await stat(new URL('../'+decision.implementation,import.meta.url))).isFile());
  for (const name of decision.names) {
    assert(!seen.has(name),`Duplicate decision: ${name}`);seen.add(name);
    const registry = decision.layer === 'compiler' ? primitiveArities : preludeArities;
    assert(Object.hasOwn(registry,name),`Incorrect classification: ${name}`);
    layers[decision.layer].push(name);
  }
}
assert.deepEqual([...seen].sort(),Object.keys(builtinArities).sort(),'Unclassified or stale builtin');
assert.deepEqual(layers.compiler.sort(),Object.keys(primitiveArities).sort());
assert.deepEqual(layers.source.sort(),Object.keys(preludeArities).sort());
const program = parse(preludeSource);
assert.deepEqual(Object.fromEntries(program.definitions.map(d=>[d.name,d.params.length])),preludeArities);
for (const library of inventory.sourceLibraries)
  assert((await stat(new URL('../'+library.path,import.meta.url))).isFile());
console.log(JSON.stringify({publicCallableNames:seen.size,compilerPrimitives:layers.compiler.length,
  sourcePreludeFunctions:layers.source.length,layers,scope:inventory.scope,
  sourceLibraries:inventory.sourceLibraries},null,2));
