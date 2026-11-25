import {createHash} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadManifest,evaluateReport,BACKENDS,AREAS} from './gate.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fail=message=>{throw Error('wave2 runner: '+message);};
export function validateAdapterArgv(argv){
 if(!Array.isArray(argv)||argv.length<3||argv.some(x=>typeof x!=='string'||!x||x.includes('\0')))fail('adapter argv must be nonempty strings without NUL');
 if(!isAbsolute(argv[0]))fail('adapter executable path must be absolute');
 for(const token of ['{file}','{mode}']){
  if(argv.filter(x=>x===token).length!==1||argv.some(x=>x.includes(token)&&x!==token))fail('exactly one standalone '+token+' required');
 }
 if(argv.some(x=>x.includes('{')||x.includes('}'))&&argv.some(x=>x!=='{file}'&&x!=='{mode}'&&/[{}]/.test(x)))fail('other interpolation is forbidden');
 return argv;
}
export async function executeAdapter({backend,area=null,argv,sourceCommit,timeoutMs=10000,spawn=spawnSync}={}){
 if(!BACKENDS.includes(backend)||area!==null&&!AREAS.includes(area))fail('unknown backend/category');
 if(typeof sourceCommit!=='string'||!/^[a-f0-9]{40}$/.test(sourceCommit))fail('exact declared source SHA required');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)fail('invalid timeout');
 validateAdapterArgv(argv);
 const stat=await lstat(argv[0]);
 if(!stat.isFile()||stat.isSymbolicLink())fail('adapter executable must be regular file');
 const adapterSha256=createHash('sha256').update(await readFile(argv[0])).digest('hex');
 const manifest=await loadManifest();
 const cases=manifest.cases.filter(c=>c.targets[backend]==='candidate'&&(area===null||c.area===area));
 if(!cases.length)fail('no candidate cases');
 const observations=[];
 for(const c of cases){
  const source=resolve(ROOT,'fixtures',c.file);
  const args=argv.map(x=>x==='{file}'?source:x==='{mode}'?c.mode:x);
  const out=spawn(args[0],args.slice(1),{
    cwd:ROOT,encoding:'utf8',windowsHide:true,shell:false,timeout:timeoutMs,maxBuffer:1024*1024
  });
  let entry;
  if(out.error||out.signal||out.status!==0||typeof out.stderr!=='string'||out.stderr.length!==0){
   entry={phase:'adapter-error',exitCode:null,stderr:out.error?.code==='ETIMEDOUT'?'adapter timeout':out.error?'adapter process failed':out.signal?'adapter signaled':out.status!==0?'adapter exited nonzero':'adapter wrote to stderr'};
  }else{
   try {
    const message=JSON.parse(out.stdout);
    if(message===null||typeof message!=='object'||Array.isArray(message))throw Error('invalid result object');
    const expectedKeys=c.mode==='execute'?['phase','exitCode','stderr','observed']:['phase','exitCode','stderr'];
    if(Object.keys(message).length!==expectedKeys.length||expectedKeys.some(k=>!Object.hasOwn(message,k)))throw Error('invalid result fields');
    entry=message;
   }catch{
    entry={phase:'adapter-error',exitCode:null,stderr:'invalid adapter JSON result'};
   }
  }
  observations.push({caseId:c.id,gitBlob:c.gitBlob,...entry});
 }
 const report={schemaVersion:1,backend,area,sourceCommit,adapterSha256,observations};
 return {report,evaluation:evaluateReport(manifest,report),note:'Only local adapter-process observations. Adapter output is not self-authenticating compiler/guest evidence; independently verify exact compiler build and executed source.'};
}
