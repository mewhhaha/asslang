import { compile, instantiate, CompileError } from '../src/compiler.mjs';
self.onmessage = async ({data}) => {
  try {
    const {source,n} = data;
    const compiled = compile(source);
    const main = compiled.exports.find(e=>e.name==='main');
    if (!main || main.parameters.length!==1 || main.parameters[0].type!=='Num' || compiled.stats.needsMemory) {
      throw new Error('Playground requires main(Num) -> Num/Bool without borrowed inputs. Use the JS API for span exports.');
    }
    const before=performance.now(), instance=await instantiate(compiled), ready=performance.now();
    const value=instance.exports.main(n), end=performance.now();
    self.postMessage({value,stats:compiled.stats,signatures:compiled.signatures,certificate:compiled.certificate,
      instantiateMilliseconds:ready-before,runMilliseconds:end-ready});
  } catch(error) {
    self.postMessage({error:error instanceof CompileError ? error.format(data.source) : error.message});
  }
};
