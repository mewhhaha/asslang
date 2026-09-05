import { readFile } from 'node:fs/promises';
// Fixed test-only bundler, not a general JavaScript module transformer. It lets
// browser engine tests run without network navigation or a package dependency.
export async function browserBundle() {
  const read = async path => (await readFile(new URL('../'+path,import.meta.url),'utf8'))
    .replace(/^import .*?;\n/gm,'').replace(/^export \{.*?;\n/gm,'').replace(/^export /gm,'');
  const specs = [
    ['frontend','', 'CompileError,fail,tokenize,parse,prune,showType,builtinNames,infer'],
    ['jte','const {fail,prune}=modules.frontend;', 'verifyCertificate,stage'],
    ['wasm','', 'uleb,emitModule'],
    ['compiler','const {CompileError,parse,infer}=modules.frontend; const {stage,verifyCertificate}=modules.jte; const {emitModule}=modules.wasm;', 'compile,instantiate,CompileError,verifyCertificate'],
  ];
  let code='const modules={};\n';
  for (const [name,imports,exports] of specs) {
    code+=`modules.${name}=(()=>{${imports}\n${await read('src/'+name+'.mjs')}\nreturn {${exports}};})();\n`;
  }
  code+=`modules.reference=(()=>{const {parse}=modules.frontend;\n${await read('test/reference.mjs')}\nreturn {reference};})();\n`;
  code+=`const {compile,instantiate}=modules.compiler; const {reference}=modules.reference;\n`;
  code+=`document.body.innerHTML='<pre id="report"></pre>'; document.body.dataset.result='pending';\n`;
  code+=`globalThis.asslangEngineOnly=true;\n${await read('test/browser.mjs')}\nreturn report;`;
  return `(async()=>{${code}})()`;
}
