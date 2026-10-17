import {readFile,lstat,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=data=>createHash('sha256').update(data).digest('hex');
const HEX40=/^[0-9a-f]{40}$/;
const HEX64=/^[0-9a-f]{64}$/;
const runtimeCode=`import {pathToFileURL} from 'node:url';
const ns=await import(pathToFileURL(process.argv[1]).href);
if(typeof ns.main!=='function') process.exit(90);
const v=ns.main();
if(typeof v!=='bigint') process.exit(91);
process.stdout.write(v.toString(10)+'\\n');`;

function classifyCompile(stderr=''){
 const s=String(stderr);
 if(/unresolved identifier|unknown (?:identifier|name|symbol)|not defined/i.test(s))return 'unresolved';
 if(/arity mismatch|expects .* argument|arity/i.test(s))return 'arity';
 if(/duplicate function|already has arity|duplicate declaration/i.test(s))return 'duplicate';
 if(/positive int outside signed i64|integer literal overflows signed 64-bit|integer literal length/i.test(s))return 'integer-overflow';
 if(/unsupported operator \/|division.*float|cannot.*float.*int/i.test(s))return 'division-float';
 return 'other';
}

export async function runJsScalarMatrix({
 compilerScript,declaredSourceSha,expectedCompilerScriptSha256,timeoutMs=10000
}={}){
 if(typeof compilerScript!=='string'||!isAbsolute(compilerScript))throw Error('absolute compilerScript required');
 if(!HEX40.test(declaredSourceSha||''))throw Error('exact declared source SHA required');
 if(!HEX64.test(expectedCompilerScriptSha256||''))throw Error('independently pinned compiler script SHA-256 required');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw Error('timeoutMs must be 100..120000');
 const stat=await lstat(compilerScript);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('compiler script must be a regular non-symlink file');
 const compilerBytes=await readFile(compilerScript);
 const compilerScriptSha256=sha(compilerBytes);
 if(compilerScriptSha256!==expectedCompilerScriptSha256)
   return {contract:'scalar-int64-v1',ok:false,status:'COMPILER_DIGEST_MISMATCH',compilerScriptSha256};
 const matrixBytes=await readFile(join(root,'fixtures/scalar-int64-v1.json'));
 const matrixSha256=sha(matrixBytes);
 const matrix=JSON.parse(matrixBytes);
 if(matrix?.schemaVersion!==1||matrix.contract!=='scalar-int64-v1'||!Array.isArray(matrix.cases)||matrix.cases.length!==32)
   throw Error('invalid scalar matrix');
 const temp=await mkdtemp(join(tmpdir(),'ores-js-scalar-matrix-'));
 const results=[];
 try{
  for(const c of matrix.cases){
   const dir=join(temp,c.id); await import('node:fs/promises').then(fs=>fs.mkdir(dir));
   const source=join(dir,'case.ores'),emitted=join(dir,'case.mjs');
   await writeFile(source,c.source,{flag:'wx',mode:0o600});
   const compiled=spawnSync(process.execPath,[compilerScript,source,'--out='+emitted],{
    cwd:dir,encoding:'utf8',timeout:timeoutMs,maxBuffer:1024*1024,windowsHide:true
   });
   if(c.expect==='compile-reject'){
    const actual=compiled.error?'spawn-error':compiled.signal?'signaled':compiled.status===0?'accepted':classifyCompile(compiled.stderr);
    results.push({id:c.id,expect:c.expect,expectedCategory:c.category,actual,
      ok:compiled.status!==0&&actual===c.category,compilerExit:compiled.status});
    continue;
   }
   if(compiled.error||compiled.signal||compiled.status!==0){
    results.push({id:c.id,expect:c.expect,actual:'compile-failed',ok:false,compilerExit:compiled.status,
      stderr:(compiled.stderr||'').slice(0,2048)});continue;
   }
   const moduleBytes=await readFile(emitted);
   if(moduleBytes.length===0||moduleBytes.length>4194304){
    results.push({id:c.id,expect:c.expect,actual:'invalid-module-size',ok:false});continue;
   }
   const moduleSha256=sha(moduleBytes);
   const ran=spawnSync(process.execPath,['--input-type=module','-e',runtimeCode,emitted],{
    cwd:dir,encoding:'utf8',timeout:timeoutMs,maxBuffer:1024*1024,windowsHide:true
   });
   if(c.expect==='runtime-reject'){
    const ok=!ran.error&&!ran.signal&&ran.status!==0;
    results.push({id:c.id,expect:c.expect,category:c.category,actual:ok?'runtime-reject':'unexpected-runtime-result',
      ok,moduleSha256,runtimeExit:ran.status});continue;
   }
   const actual=(ran.stdout||'').trim();
   const ok=!ran.error&&!ran.signal&&ran.status===0&&ran.stderr===''&&actual===c.resultInt64;
   results.push({id:c.id,expect:c.expect,expected:c.resultInt64,actual,ok,moduleSha256,runtimeExit:ran.status});
  }
 } finally {await rm(temp,{recursive:true,force:true});}
 const passed=results.filter(x=>x.ok).length;
 return {contract:matrix.contract,javaReferenceSha:matrix.javaReferenceSha,declaredSourceSha,
  compilerScriptSha256,matrixSha256,passed,total:results.length,ok:passed===results.length,
  status:passed===results.length?'VERIFIED':'MISMATCH',results};
}
