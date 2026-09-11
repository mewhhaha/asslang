import assert from 'node:assert/strict';
import { createEvidenceAlgebra, compileSources } from '../../src/compiler.mjs';
import { createRuntime } from '../../src/abi.mjs';

const privateFacts = createEvidenceAlgebra(['validated', 'cached']);
const [validated, cached] = privateFacts.atoms.map(n => privateFacts.atom(n));
const twins = [{ atom: 'ready', value: validated }, { atom: 'usable', value: validated }];
const presentation = privateFacts.present(twins);
const ready = presentation.atom('ready'), usable = presentation.atom('usable');
assert(!privateFacts.auditTransport(twins).preservesImplication);
assert.equal(ready, usable);
assert(presentation.auditTransport().preservesImplication);
const additional = presentation.residual(ready, usable);
assert.equal(additional, presentation.always);

// Even an always-true quotient predicate must reject schema-invalid public data.
const runtime = await createRuntime(compileSources([
  presentation.source('extraEvidence', additional),
  presentation.sourcePrivate('currentRequirement', ready),
  { name: 'app.ass', source: `
    export fn publicCheck = (ready:Bool) -> (usable:Bool) -> extraEvidence {ready,usable};
    export fn accept = (value:Num) ->
      require (currentRequirement {validated:value>=0}) value;
  ` },
], { maxLoopIterations: 0 }));
assert(runtime.call('publicCheck', [false, false]));
assert.throws(() => runtime.call('publicCheck', [true, false]), WebAssembly.RuntimeError);
assert.equal(runtime.call('accept', [7]), 7);
assert.throws(() => runtime.call('accept', [-7]), WebAssembly.RuntimeError);

// Exact state laws are insufficient when hidden facts constrain later changes.
const blockedBindings = [{ atom: 'ready', value: validated },
  { atom: 'warm', value: privateFacts.all([validated, cached]) }];
const blocked = privateFacts.present(blockedBindings);
const obstruction = blocked.auditTransport().obstruction;
assert(obstruction);
assert(blocked.isRealizable(obstruction.requested));
assert.equal(privateFacts.liftEvidence(blockedBindings, obstruction.current, obstruction.requested), null);
const repaired = privateFacts.present([...blockedBindings, { atom: 'cached', value: cached }]);
assert(repaired.auditTransport().preservesImplication);

console.log(JSON.stringify({
  duplicateFlags: { freeCubePreservesImplication: false,
    exactImagePreservesImplication: true, equalContracts: ready === usable,
    noAdditionalRequirement: additional === presentation.always,
    schema: presentation.inspectLaws() },
  hiddenFutureObstruction: obstruction,
  exposingHiddenFactRestoresImageTransport: true,
  rejectedImpossibleFlags: true,
  currentDataResult: runtime.call('accept', [7]),
}, null, 2));
