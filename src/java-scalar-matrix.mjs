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

function validateArgv(argv,label){
 if(!Array.isArray(argv)||argv.length===0||argv.some(x=>typeof x!=='string'||!x||x.includes('\0')))
   throw Error(label+' must be nonempty strings');
 if(!isAbsolute(argv[0]))throw Error(label+' executable must be absolute');
 if(argv.filter(x=>x==='{file}').length!==1)throw Error(label+' requires exactly one standalone {file}');
 return argv;
}
function classify(stderr=''){
 const s=String(stderr);
 if(/unresolved|unknown (?:identifier|name|symbol)|not defined|cannot find/i.test(s))return 'unresolved';
 if(/arity|expects .* argument|argument count/i.test(s))return 'arity';
 if(/duplicate|already has arity|already defined/i.test(s))return 'duplicate';
 if(/integer literal overflows signed 64-bit|signed 64-bit|integer.*overflow/i.test(s))return 'integer-overflow';
 if(/float.*int|cannot.*assign.*float|return.*float|division.*float/i.test(s))return 'division-float';
 return 'other';
}
function instrumentRuntimeSource(source){
 const marker='pub fnc main(): int {';
 const start=source.indexOf(marker);
 if(start<0)throw Error('matrix runtime case lacks canonical main');
 const ret=source.indexOf('return ',start+marker.length);
 const semi=source.indexOf(';',ret);
 if(ret<0||semi<0)throw Error('matrix runtime case lacks canonical main return');
 const expr=source.slice(ret+'return '.length,semi).trim();
 return source.slice(0,ret)+'stdio.println('+expr+'); return 0'+source.slice(semi);
}
function subst(argv,file){return argv.map(x=>x==='{file}'?file:x);}

export async function runJavaScalarMatrix({
 checkArgv,runArgv,artifactPath,expectedArtifactSha256,declaredSourceSha,
 timeoutMs=20000
}={}){
 validateArgv(checkArgv,'checkArgv'); validateArgv(runArgv,'runArgv');
 if(!HEX40.test(declaredSourceSha||''))throw Error('exact declared Java source SHA required');
 if(!HEX64.test(expectedArtifactSha256||''))throw Error('independently pinned Java artifact SHA-256 required');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw Error('timeoutMs must be 100..120000');
 if(typeof artifactPath!=='string'||!isAbsolute(artifactPath))throw Error('absolute artifactPath required');
 const st=await lstat(artifactPath);
 if(!st.isFile()||st.isSymbolicLink())throw Error('Java artifact must be a regular non-symlink file');
 const artifactSha256=sha(await readFile(artifactPath));
 if(artifactSha256!==expectedArtifactSha256)
   return {contract:'scalar-int64-v1',backend:'java',ok:false,status:'ARTIFACT_DIGEST_MISMATCH',artifactSha256};
 const matrixBytes=await readFile(join(root,'fixtures/scalar-int64-v1.json'));
 const matrix=JSON.parse(matrixBytes),matrixSha256=sha(matrixBytes);
 if(matrix?.contract!=='scalar-int64-v1'||!Array.isArray(matrix.cases)||matrix.cases.length!==32)
   throw Error('invalid scalar matrix');
 if(matrix.javaReferenceSha!==declaredSourceSha)
   throw Error('matrix Java reference SHA does not match declaredSourceSha');
 const temp=await mkdtemp(join(tmpdir(),'ores-java-scalar-matrix-'));
 const results=[];
 try{
  for(const c of matrix.cases){
   const file=join(temp,c.id+'.ores');
   const source=c.expect==='runtime'||c.expect==='runtime-reject'
     ? instrumentRuntimeSource(c.source):c.source;
   await writeFile(file,source,{flag:'wx',mode:0o600});
   if(c.expect==='compile-reject'){
    const cmd=subst(checkArgv,file);
    const p=spawnSync(cmd[0],cmd.slice(1),{cwd:temp,encoding:'utf8',timeout:timeoutMs,maxBuffer:1024*1024,windowsHide:true});
    const actual=p.error?'spawn-error':p.signal?'signaled':p.status===0?'accepted':classify((p.stderr||'')+'\n'+(p.stdout||''));
    results.push({id:c.id,expect:c.expect,expectedCategory:c.category,actual,
      ok:p.status!==0&&actual===c.category,exit:p.status});
    continue;
   }
   const cmd=subst(runArgv,file);
   const p=spawnSync(cmd[0],cmd.slice(1),{cwd:temp,encoding:'utf8',timeout:timeoutMs,maxBuffer:1024*1024,windowsHide:true});
   if(c.expect==='runtime-reject'){
    const ok=!p.error&&!p.signal&&p.status!==0;
    results.push({id:c.id,expect:c.expect,category:c.category,actual:ok?'runtime-reject':'unexpected-runtime-result',ok,exit:p.status});
    continue;
   }
   const actual=(p.stdout||'').trim();
   const ok=!p.error&&!p.signal&&p.status===0&&actual===c.resultInt64;
   results.push({id:c.id,expect:c.expect,expected:c.resultInt64,actual,ok,exit:p.status,
     stderr:(p.stderr||'').slice(0,1024)});
  }
 }finally{await rm(temp,{recursive:true,force:true});}
 const passed=results.filter(x=>x.ok).length;
 return {contract:matrix.contract,backend:'java',declaredSourceSha,artifactSha256,matrixSha256,
  passed,total:results.length,ok:passed===results.length,status:passed===results.length?'VERIFIED':'MISMATCH',
  provenanceNote:'The source SHA is independently declared and must be attested to the artifact outside this runner.',
  results};
}
