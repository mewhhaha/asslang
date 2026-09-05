import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {cpus,platform,arch} from 'node:os';
import {fileURLToPath} from 'node:url';
import {runBenchmarks,quantiles} from './benchmark-core.mjs';
const args=process.argv.slice(2),outputIndex=args.indexOf('--output'),output=outputIndex<0?null:args[outputIndex+1];
if(outputIndex>=0&&!output)throw new Error('--output needs a filename');
const report=await runBenchmarks({loadSource:path=>readFile(new URL('../examples/'+path,import.meta.url),'utf8')});
report.environment={engine:process.version,platform:`${platform()} ${arch()}`,cpu:cpus()[0]?.model};
const times=[],cwd=fileURLToPath(new URL('../',import.meta.url));
for(let i=0;i<10;i++) {
  const start=performance.now(),result=spawnSync(process.execPath,['src/cli.mjs','examples/algorithms/welford.ass','--check'],{cwd,encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr);times.push(performance.now()-start);
}
report.freshProcessCheckMilliseconds={...quantiles(times),samples:10,includes:'Node startup, file read, compile, validate; no output writes'};
const json=JSON.stringify(report,null,2)+'\n';if(output)await writeFile(output,json);console.log(json);
