import { CompileError, parse, infer } from './frontend.mjs';
import { stage } from './jte.mjs';
import { emitModule } from './wasm.mjs';
import { supportsSIMD } from './simd.mjs';
export { CompileError } from './frontend.mjs';
export { formatDiagnostic } from './diagnostics.mjs';
export { verifyCertificate } from './jte.mjs';
export { supportsSIMD } from './simd.mjs';

function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Compiler options must be an object');
  if (options.maxExpansion !== undefined && (!Number.isSafeInteger(options.maxExpansion) || options.maxExpansion < 1)) {
    throw new TypeError('maxExpansion must be a positive safe integer');
  }
  if (options.memoizeReductions !== undefined && typeof options.memoizeReductions !== 'boolean') throw new TypeError('memoizeReductions must be a boolean');
  if (options.simd !== undefined && typeof options.simd !== 'boolean') throw new TypeError('simd must be a boolean');
  if (options.reductionFusion !== undefined && typeof options.reductionFusion !== 'boolean') throw new TypeError('reductionFusion must be a boolean');
  if (options.reductionFusion !== undefined && options.experimentalReductionFusion !== undefined && options.reductionFusion !== options.experimentalReductionFusion) throw new TypeError('Conflicting reduction fusion options');
  if (options.experimentalReductionFusion !== undefined && typeof options.experimentalReductionFusion !== 'boolean') throw new TypeError('experimentalReductionFusion must be a boolean');
}

/** Compile source to a standalone Wasm kernel module and an erased JTE ledger.
 * The compiler itself is JavaScript and is NOT allocation-free.
 * @param {string} source
 * @param {{maxExpansion?: number, memoizeReductions?: boolean, experimentalReductionFusion?: boolean, reductionFusion?: boolean, simd?: boolean}} options
 */
export function compile(source, options = {}) {
  validateOptions(options);
  const now = () => globalThis.performance.now();
  const start = now();
  let phase = 'parse';
  try {
    const program = parse(source); const parsed = now();
    phase = 'infer';
    const inferred = infer(program); const checked = now();
    phase = 'stage';
    const staged = stage(program, inferred, options); const normalized = now();
    phase = 'emit';
    const module = emitModule(staged, { ...options, experimentalReductionFusion: options.reductionFusion ?? options.experimentalReductionFusion ?? true }); const emitted = now();
    phase = 'validate';
    if (module.functions.some(f => f.simd.vectorizedLoops) && !supportsSIMD())
      throw new CompileError('WebAssembly SIMD is unavailable; compile with simd: false', 0, 'E_TARGET');
    if (!WebAssembly.validate(module.bytes)) throw new Error('Compiler bug: generated invalid WebAssembly');
    const validated = now();
    return {
      bytes: module.bytes,
      abi: module.contract,
      signatures: inferred.signatures,
      observations: staged.observations,
      exports: staged.kernels.map(k => ({ name: k.name, parameters: k.parameters, result: k.resultSchema.kind })),
      certificate: staged.certificate,
      stats: {
        sourceCharacters: source.length, syntaxNodes: program.nodeCount,
        inferenceConstraints: inferred.constraints, scalarNodes: staged.nodes,
        stagingWork: staged.work, proofSteps: staged.certificate.steps.length,
        staticZips: staged.staticZips, stagedCheckedZips: staged.checkedZips,
        wasmBytes: module.bytes.length, abiMetadataBytes: module.abiMetadataBytes, needsMemory: module.needsMemory,
        kernelHeapAllocationSites: 0, intermediateBufferBytes: 0,
        functions: module.functions,
        milliseconds: { parse: parsed - start, infer: checked - parsed,
          stage: normalized - checked, emit: emitted - normalized,
          validate: validated - emitted, total: validated - start },
      },
    };
  } catch (error) {
    if (error instanceof RangeError) {
      error = new CompileError('Compiler resource limit exceeded (nesting, expansion, or binary size)', 0, 'E_LIMIT');
    }
    if (error instanceof CompileError) error.phase ??= phase;
    throw error;
  }
}

/** Instantiate without an allocator or copying inputs. For [Num] exports, pass
 * an unshared WebAssembly.Memory and call the raw (byteOffset, length) ABI.
 * @param {ReturnType<typeof compile>} compiled
 * @param {{memory?: WebAssembly.Memory}} options
 */
export async function instantiate(compiled, { memory } = {}) {
  if (compiled.abi?.hosts.length) throw new TypeError('Host effects require createRuntime and an explicit capability; raw instantiate is pure-only');
  if (compiled.stats.needsMemory && !(memory instanceof WebAssembly.Memory)) {
    throw new TypeError('This module borrows inputs: supply a WebAssembly.Memory');
  }
  const imports = compiled.stats.needsMemory ? { env: { memory } } : {};
  const { instance } = await WebAssembly.instantiate(compiled.bytes, imports);
  return instance;
}


// Source composition is static linking in one checked global namespace, not a
// filesystem loader or a new module runtime. No implicit I/O or host authority.
function sourceBundle(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > 128)
    throw new TypeError('Expected between 1 and 128 named source files');
  const names = new Set(), manifest = [], fragments = [];
  let offset = 0;
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || !file.name || file.name.length > 4096 || /[\0\r\n]/.test(file.name))
      throw new TypeError('Each source needs a nonempty, single-line name');
    if (names.has(file.name)) throw new TypeError(`Duplicate source name '${file.name}'`);
    if (typeof file.source !== 'string') throw new TypeError(`Source '${file.name}' must be a string`);
    names.add(file.name);
    manifest.push({ name: file.name, start: offset, end: offset + file.source.length });
    fragments.push(file.source);
    offset += file.source.length + 1;
  }
  if (offset - 1 > 1_000_000) {
    const error = new CompileError('Combined source limit is 1,000,000 characters', 0, 'E_LIMIT');
    error.phase = 'source';
    throw error;
  }
  return { source: fragments.join('\n'), manifest };
}
function compileBundle(files, options, compiler) {
  const { source, manifest } = sourceBundle(files);
  try {
    return { ...compiler(source, options), sourceFiles: manifest };
  } catch (error) {
    if (error instanceof CompileError) {
      const file = manifest.find(f => error.offset >= f.start && error.offset <= f.end) ?? manifest.at(-1);
      error.absoluteOffset = error.offset;
      error.offset = Math.max(0, error.offset - file.start);
      error.sourceName = file.name;
    }
    throw error;
  }
}

/** Compile named source fragments together, retaining file-local diagnostics.
 * Helpers and exported definitions share one global namespace. File order need
 * not be dependency order. Duplicate definitions are errors, not overrides.
 * @param {{name: string, source: string}[]} files
 * @param {Parameters<typeof compile>[1]} options
 */
export function compileSources(files, options = {}) {
  return compileBundle(files, options, compile);
}

// Expected language failures are data; invalid API usage and compiler bugs still
// throw. Success proves the same full pipeline as compile, but executes nothing.
function checked(build, sourceForError) {
  try {
    const { signatures, exports } = build();
    return { schemaVersion: 1, ok: true, diagnostics: [], signatures, exports };
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { schemaVersion: 1, ok: false, diagnostics: [error.toDiagnostic(sourceForError(error))] };
  }
}

/** Check through Wasm validation without instantiating or running an export. */
export function check(source, options = {}) {
  return checked(() => compile(source, options), () => source);
}

/** Named-source checking; bundle-level failures do not invent a source location. */
export function checkSources(files, options = {}) {
  return checked(() => compileSources(files, options), error => files.find(file => file.name === error.sourceName)?.source);
}

/** An explicit, bounded LRU for repeated builds of exactly the same source.
 * This is NOT per-definition incremental compilation. Every returned artifact
 * is an independent snapshot; modifying bytes, ABI or proofs cannot poison the
 * cache. retainedBytes accounts for source, binary and serialized metadata, not
 * JavaScript object overhead. No global cache keeps user source alive.
 */
export function createCompiler({ maxEntries = 16, maxBytes = 8 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 1024)
    throw new TypeError('maxEntries must be an integer between 1 and 1024');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new TypeError('maxBytes must be a nonnegative safe integer');
  const entries = new Map();
  let hits = 0, misses = 0, retainedBytes = 0;
  function cachedCompile(source, options = {}) {
    validateOptions(options);
    if (typeof source !== 'string') throw new TypeError('Source must be a string');
    const started = performance.now();
    const normalized = {
      maxExpansion: options.maxExpansion ?? 100_000,
      memoizeReductions: options.memoizeReductions ?? true,
      reductionFusion: options.reductionFusion ?? options.experimentalReductionFusion ?? true,
      simd: options.simd ?? false,
    };
    const key = JSON.stringify(normalized) + '\n' + source;
    if (entries.has(key)) {
      const entry = entries.get(key);
      entries.delete(key); entries.set(key, entry); hits++;
      const result = structuredClone(entry.result);
      return { ...result, cache: { hit: true, stored: true, elapsedMilliseconds: performance.now() - started } };
    }
    misses++;
    const result = compile(source, normalized);
    const { bytes, ...metadata } = result;
    const size = key.length * 2 + bytes.byteLength + JSON.stringify(metadata).length * 2;
    const stored = size <= maxBytes;
    if (stored) {
      while (entries.size >= maxEntries || retainedBytes + size > maxBytes) {
        const oldest = entries.keys().next().value;
        retainedBytes -= entries.get(oldest).size; entries.delete(oldest);
      }
      entries.set(key, { result: structuredClone(result), size }); retainedBytes += size;
    }
    return { ...result, cache: { hit: false, stored, elapsedMilliseconds: performance.now() - started } };
  }
  return Object.freeze({
    compile: cachedCompile,
    check(source, options = {}) { return checked(() => cachedCompile(source, options), () => source); },
    checkSources(files, options = {}) {
      return checked(() => compileBundle(files, options, cachedCompile), error => files.find(file => file.name === error.sourceName)?.source);
    },
    compileSources(files, options = {}) { return compileBundle(files, options, cachedCompile); },
    clear() { const count = entries.size; entries.clear(); retainedBytes = 0; hits = 0; misses = 0; return count; },
    get stats() { return Object.freeze({ hits, misses, entries: entries.size, retainedBytes }); },
  });
}
