import {readFile, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {isAbsolute, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const BACKENDS=Object.freeze(['java','llvm','net','wasm','forge']);
export const TASKS=Object.freeze({6:'values',7:'dispatch',8:'capture',9:'ownership',10:'effects'});
const MODES=new Set(['check','execute','reject']);
const ERRORS=new Set(['type-mismatch','nonexhaustive','self-capture','receiver-borrow','state-loan','read-mutate','loan-suspend']);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function bad(s){throw Error('wave2: '+s);}
function exact(o,req,optional=[]){
 if(!o||Array.isArray(o)||typeof o!=='object'||Object.keys(o).some(k=>![...req,...optional].includes(k))||req.some(k=>!own(o,k)))bad('invalid object shape');
}
export function validateManifest(m){
 exact(m,['schemaVersion','phase','status','backends','tasks','cases']);
 if(m.schemaVersion!==2||m.phase!=='wave2'||m.status!=='experimental-source-contracts-not-backend-verification')bad('unreviewed manifest schema');
 if(JSON.stringify(m.backends)!==JSON.stringify(BACKENDS))bad('backend list changed');
 if(!Array.isArray(m.tasks)||m.tasks.length!==5||!Array.isArray(m.cases)||m.cases.length<10||m.cases.length>50)bad('task/case count');
 for(const [i,t] of m.tasks.entries()){
  exact(t,['id','category','leader','nativeLeader','proof']);
  if(t.id!==i+6||t.category!==TASKS[t.id]||t.leader!=='java'||t.nativeLeader!=='llvm'||!t.proof)bad('task contract changed');
 }
 const ids=new Set(), files=new Set(), covered=new Map();
 for(const c of m.cases){
  exact(c,['id','task','category','file','gitBlob','mode','candidates','verified'],['expectedValue','diagnostic']);
  if(!/^[a-z][a-z0-9-]{2,70}$/.test(c.id)||ids.has(c.id))bad('duplicate or invalid id');
  ids.add(c.id);
  if(c.file!==c.id+'.ores'||files.has(c.file))bad('fixture path invalid');
  files.add(c.file);
  if(!/^[0-9a-f]{40}$/.test(c.gitBlob)||c.category!==TASKS[c.task])bad('fixture identity/task invalid');
  if(!MODES.has(c.mode)||c.verified!==false)bad('untrusted verification claim');
  if(!Array.isArray(c.candidates)||!c.candidates.length||new Set(c.candidates).size!==c.candidates.length||c.candidates.some(b=>!BACKENDS.includes(b)))bad('unsupported candidate');
  if(c.mode==='execute'){
   if(typeof c.expectedValue!=='string'||!/^(0|-?[1-9]\d*)$/.test(c.expectedValue)||own(c,'diagnostic'))bad('invalid result oracle');
  }else if(own(c,'expectedValue'))bad('unexpected result oracle');
  if(c.mode==='reject'){
   if(!ERRORS.has(c.diagnostic))bad('missing category-specific rejection');
  }else if(own(c,'diagnostic'))bad('positive may not claim diagnostic');
  if(!covered.has(c.task))covered.set(c.task,new Set());
  covered.get(c.task).add(c.mode==='reject'?'reject':'accept');
 }
 for(const task of [6,7,8,9,10])if(!covered.get(task)?.has('accept')||!covered.get(task)?.has('reject'))bad('unpaired task '+task);
 return m;
}
async function regular(file){
 const st=await lstat(file);
 if(!st.isFile()||st.isSymbolicLink())bad('fixture/executable must be a regular file');
}
export async function loadManifest(){
 const file=resolve(root,'manifest.json');await regular(file);
 const m=validateManifest(JSON.parse(await readFile(file,'utf8')));
 for(const c of m.cases){
  const f=resolve(root,'fixtures',c.file);
  await regular(f);const bytes=await readFile(f);
  const blob=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
  if(blob!==c.gitBlob)bad('tampered fixture '+c.id);
 }
 return m;
}
function command(argv){
 if(!Array.isArray(argv)||argv.length<1||argv.some(x=>typeof x!=='string'||!x||x.includes('\0')))bad('invalid command');
 if(!isAbsolute(argv[0])||argv.filter(x=>x==='{file}').length!==1||argv.some(x=>x.includes('{file}')&&x!=='{file}'))bad('absolute executable with exactly one standalone {file} required');
 return argv;
}
export function primaryDiagnostic(output,category){
 if(typeof output!=='string'||!ERRORS.has(category))return false;
 const patterns={
  'type-mismatch':/\b(type mismatch|incompatible types?|cannot (?:assign|convert).*float|float.*(?:int|integer)|expected int.*(?:float|division))\b/i,
  nonexhaustive:/\b(non.?exhaustive|missing (?:variant|case|pattern)|not all (?:cases|variants|patterns))\b/i,
  'self-capture':/\bself\b.*\b(?:not captured|not visible|not in scope|not allowed|excluded|implicit)|\b(?:implicit|unbound|unknown)\b.*\bself\b/i,
  'receiver-borrow':/\b(?:borrow|escaping|escape|loan)\b.*\b(?:self|receiver)\b|\b(?:self|receiver)\b.*\b(?:borrow|escaping|escape|loan)\b/i,
  'state-loan':/\bstate.?loan\b|\bloan\b.*\b(?:escape|return|borrow|leak)\b|\b(?:escape|return)\b.*\b(?:state|loan)\b/i,
  'read-mutate':/\bread.?only\b|\b(?:read|write)\b.*\b(?:capability|mutation|mutable|write|mutate)\b/i,
  'loan-suspend':/\b(?:loan|state)\b.*\b(?:suspend|cooperate|await|select)\b|\b(?:suspend|cooperate|await|select)\b.*\bloan\b/i
 };
 for(const line of output.split(/\r?\n/)){
  const e=/(?:^|:\d+(?::\d+)?:\s*)(?:fatal\s+)?error(?:\[[A-Za-z0-9_-]{1,30}\])?\s*:\s*(.*)$/i.exec(line.trim());
  if(e)return patterns[category].test(e[1]);
 }
 return false;
}
function errorSeverity(output){return /(?:^|\n)\s*(?:[^\n]*?:\d+(?::\d+)?:\s*)?(?:fatal\s+)?error(?:\[[A-Za-z0-9_-]+\])?\s*:/i.test(output);}
export async function runWave2({backend,task,checkArgv,executeArgv,sourceSha,timeoutMs=10000,requireAll=false,spawn=spawnSync}={}){
 if(!BACKENDS.includes(backend))bad('unknown backend');
 if(task!==undefined&&!own(TASKS,task))bad('unknown task');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)bad('invalid timeout');
 const m=await loadManifest(),selected=m.cases.filter(c=>task===undefined||c.task===Number(task));
 const candidate=selected.filter(c=>c.candidates.includes(backend));
 const needCheck=candidate.some(c=>c.mode!=='execute'),needExecute=candidate.some(c=>c.mode==='execute');
 const configured=(!needCheck||!!checkArgv)&&(!needExecute||!!executeArgv);
 if(checkArgv)command(checkArgv);if(executeArgv)command(executeArgv);
 const commandSha256={};
 if(configured&&candidate.length){
  if(!/^[0-9a-f]{40}$/.test(sourceSha||''))bad('exact declared source SHA required');
  for(const [kind,argv] of [['check',checkArgv],['execute',executeArgv]])if(argv){
   await regular(argv[0]);
   commandSha256[kind]=createHash('sha256').update(await readFile(argv[0])).digest('hex');
  }
 }
 const results=[];
 for(const c of selected){
  if(!c.candidates.includes(backend)){results.push({id:c.id,status:'UNSUPPORTED',certified:false});continue;}
  if(!configured){results.push({id:c.id,status:'UNCONFIGURED',certified:false});continue;}
  const argv=(c.mode==='execute'?executeArgv:checkArgv),path=resolve(root,'fixtures',c.file);
  const bytes=await readFile(path),digest=createHash('sha256').update(bytes).digest('hex');
  const cmd=argv.map(x=>x==='{file}'?path:x);
  const p=spawn(cmd[0],cmd.slice(1),{encoding:'utf8',timeout:timeoutMs,cwd:root,maxBuffer:65536,shell:false,windowsHide:true});
  let status='MISMATCH';
  const stdout=p.stdout||'',stderr=p.stderr||'';
  if(p.error)status=p.error.code==='ETIMEDOUT'?'TIMEOUT':'SPAWN_ERROR';
  else if(p.signal)status='SIGNALED';
  else if(!Number.isSafeInteger(p.status)||p.status<0)status='INVALID_EXIT';
  else if(c.mode==='check'&&p.status===0&&!errorSeverity(stdout+'\n'+stderr))status='OBSERVED_PASS';
  else if(c.mode==='reject'&&p.status===1&&!stdout&&primaryDiagnostic(stderr,c.diagnostic))status='OBSERVED_PASS';
  else if(c.mode==='execute'&&p.status===0&&!stderr){
   try{
    // JSON.parse accepts duplicate keys, and therefore is not a strict
    // one-field result oracle. Only one literal decimal string is admitted.
    const one=/^\s*\{\s*"result"\s*:\s*"(-?(?:0|[1-9]\d*))"\s*\}\s*$/.exec(stdout);
    if(one&&one[1]===c.expectedValue)status='OBSERVED_PASS';
   }catch{/* Fail closed; a real guest adapter must produce one exact JSON result. */}
  }
  results.push({id:c.id,status,certified:false,expected:c.expectedValue??c.diagnostic??null,fixtureSha256:digest,exitCode:p.status??null,signal:p.signal||null});
 }
 const attempted=results.filter(x=>x.status==='OBSERVED_PASS'||x.status==='MISMATCH'||x.status==='TIMEOUT'||x.status==='SPAWN_ERROR'||x.status==='SIGNALED'||x.status==='INVALID_EXIT').length;
 const observedPass=results.filter(x=>x.status==='OBSERVED_PASS').length;
 const missing=results.filter(x=>x.status==='UNSUPPORTED'||x.status==='UNCONFIGURED').length;
 const observedOnly=attempted>0&&attempted===observedPass&&(!requireAll||missing===0);
 return {schemaVersion:2,backend,task:task??'all',configured:configured&&candidate.length>0,
  status:observedOnly?'ADMISSION_OR_RESULT_OBSERVED':'INCOMPLETE',ok:observedOnly,observedPass,
  missing,total:selected.length,verified:false,parityVerified:false,provenanceVerified:false,
  declaredSourceSha:sourceSha||null,commandSha256,
  note:'Source fixtures and local adapter outcomes only; no independent compiler provenance, guest authenticity, or full feature parity is certified.',
  results};
}
