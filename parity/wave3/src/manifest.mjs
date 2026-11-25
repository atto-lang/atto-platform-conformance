import {createHash} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {isAbsolute,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BACKENDS} from './reference.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fail=s=>{throw Error('wave3: '+s)};
const keys=(x,required)=>{if(x===null||typeof x!=='object'||Array.isArray(x)||required.some(k=>!Object.hasOwn(x,k))||Object.keys(x).some(k=>!required.includes(k)))fail('invalid shape')};
export function validateManifest(m){
 keys(m,['schemaVersion','wave','sourceBackends','status','certifiedParity','tasks','sourceCases','proofRules']);
 if(m.schemaVersion!==1||m.wave!==3||m.status!=='reference-model-and-source-candidates-only'||m.certifiedParity!==false)fail('invalid proof status');
 if(JSON.stringify(m.sourceBackends)!==JSON.stringify(BACKENDS))fail('backend inventory changed');
 if(!Array.isArray(m.tasks)||m.tasks.length!==5||!Array.isArray(m.sourceCases)||m.sourceCases.length!==6)fail('wrong count');
 if(!Array.isArray(m.proofRules)||m.proofRules.length<3)fail('missing release proof rules');
 const categories=['errors-cleanup','core-std','private-actor-hooks','actorref-identity','single-flight'];
 for(let i=0;i<5;i++){
  const t=m.tasks[i];keys(t,['id','category','lead','secondary','exit_gate']);
  if(t.id!==11+i||t.category!==categories[i]||typeof t.exit_gate!=='string'||!t.exit_gate)fail('task contract mismatch');
 }
 const ids=new Set();
 for(const c of m.sourceCases){
  keys(c,['id','task','path','gitBlobSha1','sha256','mode','rule','backendReadiness']);
  if(!/^[a-z][a-z0-9-]{1,60}$/.test(c.id)||ids.has(c.id)||c.path!=='fixtures/'+c.id+'.ores')fail('invalid/duplicate fixture');
  ids.add(c.id);
  if(![11,13,15].includes(c.task)||!['candidate-check','candidate-reject'].includes(c.mode))fail('invalid case');
  if(!/^[0-9a-f]{40}$/.test(c.gitBlobSha1)||!/^[0-9a-f]{64}$/.test(c.sha256)||typeof c.rule!=='string'||!c.rule)fail('invalid fixture pin');
  keys(c.backendReadiness,BACKENDS);
  if(BACKENDS.some(x=>c.backendReadiness[x]!=='pending'))fail('unapproved parity promotion');
 }
 if(m.sourceCases.filter(x=>x.mode==='candidate-reject').length!==2)fail('missing semantic negatives');
 return m;
}
async function regular(file){const st=await lstat(file);if(!st.isFile()||st.isSymbolicLink())fail('non-regular file');}
export async function loadManifest(){
 const path=resolve(root,'manifest.json');await regular(path);
 const m=validateManifest(JSON.parse(await readFile(path,'utf8')));
 for(const c of m.sourceCases){
  const path=resolve(root,c.path);await regular(path);const bytes=await readFile(path);
  const blob=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
  if(blob!==c.gitBlobSha1||createHash('sha256').update(bytes).digest('hex')!==c.sha256)fail('tampered fixture '+c.id);
 }
 return m;
}
export function expectedPrivateHookDiagnostic(output){
 if(typeof output!=='string')return false;
 return output.split(/\r?\n/).some(line=>{
  const m=/(?:^|:\d+(?::\d+)?:\s*)(?:fatal\s+)?error(?:\[[a-zA-Z0-9_-]+\])?\s*:\s*(.*)$/i.exec(line.trim());
  return !!m&&/\breceive\b/i.test(m[1])&&/\b(private|inaccessible|not accessible|sealed|framework.?only|not callable|method reference|method capture|hidden superclass)\b/i.test(m[1]);
 });
}
export async function runCompilerCandidates({backend,argv,sourceSha,timeoutMs=10000,spawn=spawnSync}={}){
 if(!BACKENDS.includes(backend))fail('unknown backend');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)fail('invalid timeout');
 const manifest=await loadManifest();
 if(argv===undefined)return {backend,configured:false,verified:false,parityVerified:false,status:'UNCONFIGURED',cases:manifest.sourceCases.map(c=>({id:c.id,status:'UNCONFIGURED'}))};
 if(!Array.isArray(argv)||argv.length<2||argv.some(x=>typeof x!=='string'||!x||x.includes('\0'))||!isAbsolute(argv[0])||argv.filter(x=>x==='{file}').length!==1||argv.some(x=>x.includes('{file}')&&x!=='{file}'))fail('invalid command');
 if(!/^[0-9a-f]{40}$/.test(sourceSha||''))fail('source SHA required');
 await regular(argv[0]);
 const compilerSha256=createHash('sha256').update(await readFile(argv[0])).digest('hex');
 const cases=[];
 for(const c of manifest.sourceCases){
  const path=resolve(root,c.path);const cmd=argv.map(x=>x==='{file}'?path:x);
  const p=spawn(cmd[0],cmd.slice(1),{cwd:root,encoding:'utf8',timeout:timeoutMs,maxBuffer:65536,shell:false,windowsHide:true});
  const output=(p.stdout||'')+'\n'+(p.stderr||'');let status='MISMATCH';
  if(p.error)status=p.error.code==='ETIMEDOUT'?'TIMEOUT':'SPAWN_ERROR';
  else if(p.signal)status='SIGNALED';
  else if(!Number.isSafeInteger(p.status)||p.status<0)status='INVALID_EXIT';
  else if(c.mode==='candidate-check'&&p.status===0&&!/(?:^|\n)\s*(?:fatal\s+)?error\s*:/i.test(output))status='ADMISSION_OBSERVED';
  else if(c.mode==='candidate-reject'&&p.status===1&&!p.stdout&&expectedPrivateHookDiagnostic(p.stderr||''))status='SEMANTIC_REJECTION_OBSERVED';
  cases.push({id:c.id,status,exitCode:p.status??null,fixtureSha256:c.sha256});
 }
 return {backend,configured:true,compilerSha256,sourceShaDeclared:sourceSha,
  status:cases.every(c=>c.status.endsWith('_OBSERVED'))?'SOURCE_ADMISSION_OBSERVED':'INCOMPLETE',verified:false,parityVerified:false,provenanceVerified:false,
  note:'Compiler admission only. No source-binary provenance or actor runtime semantic attestation.',cases};
}
