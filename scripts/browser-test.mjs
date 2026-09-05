import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from './server.mjs';
import { browserBundle } from './browser-bundle.mjs';

// Chrome DevTools over an anonymous pipe: no npm browser driver and no public
// debugging port. Node 22 and an installed Chrome/Chromium are sufficient.
const executable = [process.env.CHROME_BIN, 'chromium', 'chromium-browser', 'google-chrome'].filter(Boolean)
  .find(name => spawnSync(name,['--version'],{stdio:'ignore'}).status === 0);
if (!executable) throw new Error('Chrome/Chromium not found. Set CHROME_BIN to its executable.');
const version = spawnSync(executable,['--version'],{encoding:'utf8'}).stdout.trim();
const profile = await mkdtemp(join(tmpdir(),'asslang-browser-'));
const http = process.argv.includes('--http');
const benchmark = process.argv.includes('--bench');
const outputIndex=process.argv.indexOf('--output'), output=outputIndex<0?null:process.argv[outputIndex+1];
if(outputIndex>=0&&!output)throw new Error('--output requires a filename');
const server = http ? await serve() : null;
const args = ['--headless', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
  '--no-default-browser-check', '--password-store=basic', '--use-mock-keychain',
  '--disable-background-networking', '--disable-extensions', '--disable-component-update',
  '--enable-automation', '--disable-search-engine-choice-screen',
  `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--no-startup-window'];
// Only disable the browser sandbox when this test is explicitly run as root.
if (process.getuid?.() === 0) args.push('--no-sandbox');
const child = spawn(executable,args,{stdio:['ignore','ignore','pipe','pipe','pipe']});
const pending=new Map(); let nextId=0, buffer='', stderr='';
child.stderr.on('data',b=>{stderr=(stderr+b).slice(-6000);});
child.stdio[4].on('data',b=>{
  buffer+=b.toString(); let end;
  while ((end=buffer.indexOf('\0'))>=0) {
    const line=buffer.slice(0,end); buffer=buffer.slice(end+1);
    if (!line) continue;
    const message=JSON.parse(line), waiter=pending.get(message.id);
    if (waiter) {
      pending.delete(message.id); clearTimeout(waiter.timer);
      message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
    }
  }
});
function abort(error) {
  for (const waiter of pending.values()) {clearTimeout(waiter.timer);waiter.reject(error);}
  pending.clear();
}
child.once('error',abort);
child.once('exit',code=>abort(new Error(`Chrome exited (${code})\n${stderr}`)));
function call(method,params={},sessionId) {
  return new Promise((resolve,reject)=>{
    const id=++nextId;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Chrome timed out: ${method}\n${stderr}`));},benchmark?60000:10000);
    pending.set(id,{resolve,reject,timer});
    child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
  });
}
try {
  const target=await call('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await call('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  console.log(version);
  if (!http) {
    const result=await call('Runtime.evaluate',{expression:await browserBundle({benchmark}),awaitPromise:true,returnByValue:true},sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    const report=result.result?.value;
    console.log(JSON.stringify(report,null,2));
    if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');
    if (report?.status!=='PASS') throw new Error('Browser engine tests failed');
  } else {
    const navigation=await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/test/browser.html`},sessionId);
    if (navigation.errorText) throw new Error(`HTTP browser navigation failed: ${navigation.errorText}`);
    const deadline=Date.now()+20000; let status;
    while(Date.now()<deadline) {
      try {
        const result=await call('Runtime.evaluate',{expression:'document.body?.dataset.result',returnByValue:true},sessionId);
        status=result.result?.value;
      } catch(error) {
        if (!/context/i.test(error.message)) throw error;
      }
      if (status==='pass' || status==='fail') break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    const result=await call('Runtime.evaluate',{expression:'document.querySelector("#report")?.textContent',returnByValue:true},sessionId);
    console.log(result.result?.value);
    if (status!=='pass') throw new Error('Browser tests failed or did not complete');
  }
} finally {
  try { await call('Browser.close'); } catch { child.kill('SIGKILL'); }
  await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});
  if (server) await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true,maxRetries:3});
}
