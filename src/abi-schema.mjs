// ASABI 1 is a project ABI, not the WebAssembly Component Model Canonical ABI.
// Schema field order is ASCII-lexical, independent of source/object insertion order.
export const ABI_VERSION = 1;
export const alignTo = (n, alignment) => Math.ceil(n / alignment) * alignment;
export function layout(schema) {
  switch (schema.kind) {
    case 'Num': return { size: 8, align: 8 };
    case 'Bool': return { size: 4, align: 4 };
    case 'Text': case 'Bytes': case 'Stream': return { size: 8, align: 4 };
    case 'Record': {
      let offset = 0, alignment = 1;
      const fields = schema.fields.map(({ name, schema: child }) => {
        const l = layout(child); offset = alignTo(offset, l.align); alignment = Math.max(alignment, l.align);
        const field = { name, schema: child, offset, ...l }; offset += l.size; return field;
      });
      return { size: alignTo(offset, alignment), align: alignment, fields };
    }
    default: throw new TypeError(`Unsupported ABI type: ${schema.kind}`);
  }
}
export function flatTypes(schema) {
  if (schema.kind === 'Record') return schema.fields.flatMap(f => flatTypes(f.schema));
  if (['Text', 'Bytes', 'Stream'].includes(schema.kind)) return ['I32', 'I32'];
  if (['Num', 'Bool'].includes(schema.kind)) return [schema.kind];
  throw new TypeError(`Unsupported ABI type: ${schema.kind}`);
}
export const isScalarSchema = s => s.kind === 'Num' || s.kind === 'Bool';
