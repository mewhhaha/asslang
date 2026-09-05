import { CompileError, parse, infer } from './frontend.mjs';
import { stage } from './jte.mjs';
import { emitModule } from './wasm.mjs';
export { CompileError } from './frontend.mjs';
export { verifyCertificate } from './jte.mjs';

/** Compile source to a standalone Wasm kernel module and an erased JTE ledger.
 * The compiler itself is JavaScript and is NOT allocation-free.
 * @param {string} source
 * @param {{maxExpansion?: number, experimentalReductionFusion?: boolean}} options
 */
export function compile(source, options = {}) {
  if (options.maxExpansion !== undefined && (!Number.isSafeInteger(options.maxExpansion) || options.maxExpansion < 1)) {
    throw new TypeError('maxExpansion must be a positive safe integer');
  }
  if (options.experimentalReductionFusion !== undefined && typeof options.experimentalReductionFusion !== 'boolean') {
    throw new TypeError('experimentalReductionFusion must be a boolean');
  }
  const now = () => globalThis.performance.now();
  const start = now();
  try {
    const program = parse(source); const parsed = now();
    const inferred = infer(program); const checked = now();
    const staged = stage(program, inferred, options); const normalized = now();
    const module = emitModule(staged, options); const emitted = now();
    if (!WebAssembly.validate(module.bytes)) throw new Error('Compiler bug: generated invalid WebAssembly');
    const validated = now();
    return {
      bytes: module.bytes,
      signatures: inferred.signatures,
      exports: staged.kernels.map(k => ({ name: k.name, parameters: k.parameters, result: k.resultType })),
      certificate: staged.certificate,
      stats: {
        sourceCharacters: source.length, syntaxNodes: program.nodeCount,
        inferenceConstraints: inferred.constraints, scalarNodes: staged.nodes,
        stagingWork: staged.work, proofSteps: staged.certificate.steps.length,
        staticZips: staged.staticZips, stagedCheckedZips: staged.checkedZips,
        wasmBytes: module.bytes.length, needsMemory: module.needsMemory,
        kernelHeapAllocationSites: 0, intermediateBufferBytes: 0,
        functions: module.functions,
        milliseconds: { parse: parsed - start, infer: checked - parsed,
          stage: normalized - checked, emit: emitted - normalized,
          validate: validated - emitted, total: validated - start },
      },
    };
  } catch (error) {
    if (error instanceof RangeError) {
      throw new CompileError('Compiler resource limit exceeded (nesting, expansion, or binary size)', 0, 'E_LIMIT');
    }
    throw error;
  }
}

/** Instantiate without an allocator or copying inputs. For [Num] exports, pass
 * an unshared WebAssembly.Memory and call the raw (byteOffset, length) ABI.
 * @param {ReturnType<typeof compile>} compiled
 * @param {{memory?: WebAssembly.Memory}} options
 */
export async function instantiate(compiled, { memory } = {}) {
  if (compiled.stats.needsMemory && !(memory instanceof WebAssembly.Memory)) {
    throw new TypeError('This module borrows inputs: supply a WebAssembly.Memory');
  }
  const imports = compiled.stats.needsMemory ? { env: { memory } } : {};
  const { instance } = await WebAssembly.instantiate(compiled.bytes, imports);
  return instance;
}
