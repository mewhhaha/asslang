// Conservative f64x2 planning: only total lane operations and current-cursor
// loads from entry-validated Num spans. Never speculate guards or nested work.
// Encodings: WebAssembly/simd proposals/simd/BinarySIMD.md (standard SIMD).
export const SIMD_OPS = Object.freeze({
  '+': 0xf0, '-': 0xf1, '*': 0xf2, '/': 0xf3,
  abs: 0xec, neg: 0xed, sqrt: 0xef, floor: 0x75, min: 0xf4, max: 0xf5,
});

export function planSIMD(stream, value) {
  if (stream.mask || stream.machines.length) return null;
  const indices = new Set(stream.indices.map(n => n.id)), memo = new Map();
  function visit(node) {
    if (!node || node.type !== 'Num') return null;
    if (memo.has(node.id)) return memo.get(node.id);
    let plan = null;
    if (node.op === 'const' || node.op === 'wire') plan = { kind: 'splat', node };
    else if (node.op === 'load' && node.args[0].op === 'wire' &&
        node.args[1].op === 'index' && indices.has(node.args[1].id))
      plan = { kind: 'load', node };
    else if (Object.hasOwn(SIMD_OPS, node.op)) {
      const args = node.args.map(visit);
      if (args.every(Boolean)) plan = { kind: 'operation', node, args };
    }
    memo.set(node.id, plan);
    return plan;
  }
  return visit(value);
}

/** Probe without instantiating a module or running guest code. */
export function supportsSIMD() {
  // () -> v128 { v128.const 0 }; no imports, exports, or start function.
  return typeof WebAssembly !== 'undefined' && WebAssembly.validate(Uint8Array.from([
    0,97,115,109,1,0,0,0, 1,5,1,96,0,1,123, 3,2,1,0,
    10,22,1,20,0,253,12, ...Array(16).fill(0), 11,
  ]));
}
