import { corpus, exampleSource } from '../examples/corpus.mjs';
import { selectDiagnostic } from './diagnostic-navigation.mjs';
const output = document.querySelector('#output'), details = document.querySelector('#details');
const examples = document.querySelector('#examples'), sourceInput = document.querySelector('#source');
const locate = document.querySelector('#locate');
let worker = null, timer = null, navigation = null;
const display = (_key, value) => ArrayBuffer.isView(value) ? Array.from(value) :
  typeof value === 'number' && !Number.isFinite(value) ? String(value) : Object.is(value, -0) ? '-0' : value;
function stop() { worker?.terminate(); worker = null; clearTimeout(timer); }
function clearNavigation() { navigation = null; locate.hidden = true; }
sourceInput.addEventListener('input', () => {
  locate.hidden = !navigation || sourceInput.value !== navigation.source;
});
locate.onclick = () => {
  if (!navigation || !selectDiagnostic(sourceInput, navigation.source, navigation.diagnostic)) clearNavigation();
};
for (const entry of corpus) {
  const option = document.createElement('option');
  option.value = entry.id; option.textContent = entry.id; examples.append(option);
}
examples.onchange = async () => {
  const entry = corpus.find(item => item.id === examples.value);
  if (!entry) return;
  clearNavigation();
  try {
    sourceInput.value = await exampleSource(entry, async path => {
      const response = await fetch('../examples/' + path);
      if (!response.ok) throw new Error('Example load failed: ' + path);
      return response.text();
    });
    document.querySelector('#name').value = entry.name;
    document.querySelector('#args').value = JSON.stringify(entry.args, display);
    // Loading an effectful example is not a grant. The checkbox remains explicit.
    document.querySelector('#effects').checked = false;
  } catch (error) { output.textContent = error.message; }
};
document.querySelector('#cancel').onclick = () => { stop(); clearNavigation(); output.textContent = 'Cancelled.'; };
function start(mode) {
  stop(); clearNavigation();
  let args;
  if (mode === 'run') {
    try { args = JSON.parse(document.querySelector('#args').value); }
    catch { output.textContent = 'Arguments must be valid JSON.'; return; }
  }
  const source = sourceInput.value;
  output.textContent = mode === 'check' ? 'Checking…' : 'Compiling and running…';
  details.textContent = '';
  const active = new Worker('./worker.mjs', { type: 'module' });
  worker = active;
  timer = setTimeout(() => {
    stop(); output.textContent = 'Stopped at the playground resource limit (10 seconds).';
  }, 10000);
  active.onmessage = ({ data }) => {
    if (worker !== active) return;
    stop();
    if (data.error) {
      output.textContent = data.error;
      const diagnostic = data.diagnostics?.find(item => item.range);
      if (diagnostic) {
        navigation = { source, diagnostic };
        locate.hidden = sourceInput.value !== source;
      }
      if (data.diagnostics) details.textContent = JSON.stringify({ diagnostics: data.diagnostics }, null, 2);
      return;
    }
    if (data.mode === 'check') {
      output.textContent = `Check passed. ${data.exports.length} export(s) validated. No export was executed.`;
      details.textContent = JSON.stringify({ signatures: data.signatures, exports: data.exports }, null, 2);
      return;
    }
    output.textContent = JSON.stringify({ result: data.value, hostEvents: data.events, wasmBytes: data.stats.wasmBytes,
      abiMetadataBytes: data.stats.abiMetadataBytes, compileMilliseconds: data.stats.milliseconds.total,
      instantiateMilliseconds: data.instantiateMilliseconds, runAndMarshalMilliseconds: data.runMilliseconds,
      memoryBytes: data.memoryBytes, kernels: data.stats.functions }, display, 2);
    details.textContent = JSON.stringify({ signatures: data.signatures, observations: data.observations,
      abi: data.abi, certificate: data.certificate }, null, 2);
  };
  active.onerror = event => {
    if (worker !== active) return;
    stop(); output.textContent = event.message;
  };
  active.postMessage({ mode, source, name: document.querySelector('#name').value, args,
    allowDemoEffects: mode === 'run' && document.querySelector('#effects').checked,
    experimentalReductionFusion: document.querySelector('#fusion').checked,
    simd: document.querySelector('#simd').checked });
}
document.querySelector('#check').onclick = () => start('check');
document.querySelector('#run').onclick = () => start('run');
