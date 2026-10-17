/** Real JS compiler + generated ESM smoke evidence. No compiler is bundled. */
import {readFile,lstat,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {isAbsolute,join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=data=>createHash('sha256').update(data).digest('hex');
const SOURCE_SHA=/^[0-9a-f]{40}$/;
const runtimeCode=`import {pathToFileURL} from 'node:url';
const ns=await import(pathToFileURL(process.argv[1]).href);
if(typeof ns.main!=='function') process.exit(5);
const value=ns.main();
if(value!==42n) process.exit(6);
process.stdout.write('42\\n');`;

export async function runJsRuntimeEvidence({
  compilerScript,declaredSourceSha,timeoutMs=10000
}={}){
  if(!compilerScript)
    return {backend:'js',configured:false,ok:false,status:'UNCONFIGURED',verified:0};
  if(typeof compilerScript!=='string'||!isAbsolute(compilerScript))
    throw Error('compilerScript must be an absolute file path');
  if(!SOURCE_SHA.test(declaredSourceSha||''))
    throw Error('declaredSourceSha must be an exact lowercase 40-hex commit');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)
    throw Error('timeoutMs must be 100..120000');
  const fileStat=await lstat(compilerScript);
  if(!fileStat.isFile()||fileStat.isSymbolicLink())
    throw Error('compiler script must be a regular non-symlink file');
  const fixture=join(root,'fixtures/int-arithmetic.ores');
  const fixtureStat=await lstat(fixture);
  if(!fixtureStat.isFile()||fixtureStat.isSymbolicLink())
    throw Error('fixture must be a regular non-symlink file');
  const fixtureSha256=sha(await readFile(fixture));
  const compilerScriptSha256=sha(await readFile(compilerScript));
  const temp=await mkdtemp(join(tmpdir(),'ores-js-evidence-'));
  try{
    const emitted=join(temp,'verified.mjs');
    const compiled=spawnSync(process.execPath,[compilerScript,fixture,'--out='+emitted],{
      cwd:temp,encoding:'utf8',timeout:timeoutMs,maxBuffer:1024*1024,windowsHide:true
    });
    const common={
      backend:'js',configured:true,declaredSourceSha,compilerScriptSha256,
      fixtureSha256,provenanceNote:'Compiler source commit is declared, NOT cryptographically tied to the compiler script; separately attest its build/checkout.',
      verified:0,ok:false
    };
    if(compiled.error||compiled.signal||compiled.status!==0)
      return {...common,status:compiled.error?.code==='ETIMEDOUT'?'TIMEOUT':'COMPILE_FAILED',compilerExit:compiled.status,compilerStderr:(compiled.stderr||'').slice(0,4096)};
    let moduleBytes;
    try{moduleBytes=await readFile(emitted);}
    catch{return {...common,status:'MISSING_EMITTED_MODULE'};}
    if(moduleBytes.length===0||moduleBytes.length>4194304)
      return {...common,status:'INVALID_MODULE_SIZE'};
    const moduleSha256=sha(moduleBytes);
    const ran=spawnSync(process.execPath,['--input-type=module','-e',runtimeCode,emitted],{
      cwd:temp,encoding:'utf8',timeout:timeoutMs,maxBuffer:1024*1024,windowsHide:true
    });
    if(ran.error||ran.signal||ran.status!==0||ran.stdout!=='42\n'||ran.stderr)
      return {...common,moduleSha256,status:ran.error?.code==='ETIMEDOUT'?'TIMEOUT':'RUNTIME_FAILED',
        runtimeExit:ran.status,runtimeStdout:(ran.stdout||'').slice(0,4096),runtimeStderr:(ran.stderr||'').slice(0,4096)};
    return {...common,moduleSha256,status:'VERIFIED',verified:1,ok:true,runtimeOutput:'42'};
  }finally{await rm(temp,{recursive:true,force:true});}
}
