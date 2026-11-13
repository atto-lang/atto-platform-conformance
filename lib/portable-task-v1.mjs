import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const ids=["eager-before-await","fire-and-continue","typed-int","typed-string","generic-hasfuture-once","actorref-readiness","cancel-before-start","cancel-while-suspended","cancel-owned-descendants","physical-cleanup-before-done","reject-duck-hasfuture","reject-actor-self-capture","reject-mut-borrow-capture","reject-await-in-critical","no-resume-before-physical-exit","stop-while-suspending"];
const backends=['java','llvm','wasm','rs','forge','net'];
const sha40=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const sha64=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function receiptStepsValid(c,r){
 const names=r?.stepNames;
 if(!Array.isArray(names)||names.length!==r.completedSteps)return false;
 // These are the only sequences emitted by the source-owned candidate runner.
 // Names alone never independently attest to executed CI or compiled guests.
 if(r.status==='passed')return c.expect==='positive'
  ? names.length===2&&names[0]==='compile'&&names[1]==='guest'
  : names.length===1&&names[0]==='compile';
 if(r.status==='unsupported')return names.length===1&&names[0]==='compile';
 return names.length>=1&&names[0]==='compile';
}
export const statuses=Object.freeze(['passed','failed','unsupported','not_executed']);
export function selectCases(cases,requested){
 const known=new Set(cases.map(c=>c.id));
 if(!Array.isArray(requested)||!requested.length||requested.length>known.size||
    requested.some(id=>typeof id!=='string'||!known.has(id))||
    new Set(requested).size!==requested.length)throw Error('fixture selection must contain distinct known IDs');
 return cases.filter(c=>requested.includes(c.id));
}

export function validateManifest(m){
 if(!m||m.schema!=='atto.portable-task.v1'||m.contractVersion!==1||m.executionVerified!==false||!Array.isArray(m.cases)||m.cases.length!==ids.length||JSON.stringify(m.backends)!==JSON.stringify(backends)||JSON.stringify(m.statuses)!==JSON.stringify(statuses))throw Error('invalid portable Task manifest');
 for(let i=0;i<ids.length;i++){
  const c=m.cases[i];
  if(!c||c.id!==ids[i]||c.file!==c.id+'.atto'||!['positive','negative'].includes(c.expect)||c.proposedSyntax!==true||
    c.expectedGuestExit!==(c.expect==='positive'?42:null)|| (c.expect==='negative'?c.expectedDiagnosticCode!==({"reject-duck-hasfuture":"ATTO_TASK_E_HASFUTURE_WITNESS","reject-actor-self-capture":"ATTO_TASK_E_ACTOR_SELF_CAPTURE","reject-mut-borrow-capture":"ATTO_TASK_E_MUT_BORROW_CAPTURE","reject-await-in-critical":"ATTO_TASK_E_CRITICAL_SUSPEND"})[c.id]:c.expectedDiagnosticCode!==undefined)||!Array.isArray(c.mustObserve)||!Array.isArray(c.mustNotObserve)||
    c.mustObserve.some(x=>typeof x!=='string'||x.length>100)||c.mustNotObserve.some(x=>typeof x!=='string'||x.length>100)||
    !c.baseline||backends.some(b=>c.baseline[b]!=='not_executed')||Object.keys(c.baseline).length!==backends.length)throw Error('invalid portable Task case '+ids[i]);
 }
 return m;
}
export async function loadSuite(){
 const url=new URL('../fixtures/portable-task-v1/manifest.json',import.meta.url);
 const m=validateManifest(JSON.parse(await readFile(url,'utf8')));
 const cases=[];
 for(const c of m.cases){
  const bytes=await readFile(new URL('../fixtures/portable-task-v1/'+c.file,import.meta.url));
  if(!bytes.length||bytes.length>65536||!bytes.toString('utf8').includes('pub ')&&!bytes.toString('utf8').includes('define actor'))throw Error('invalid source '+c.id);
  const fixtureSha256=createHash('sha256').update(bytes).digest('hex');
  const fixtureBlobSha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
  cases.push({...c,fixtureSha256,fixtureBlobSha});
 }
 return {manifest:m,cases};
}
/** Candidate structural admission only. A GitHub reviewer must independently verify runner log and artifact. */
export function classifyReceipt(c,backend,r){
 if(!backends.includes(backend))throw Error('unknown backend');
 if(!r)return {status:'not_executed',releaseQualified:false,reason:'no executed receipt'};
 if(!r||typeof r!=='object'||Array.isArray(r)||!statuses.includes(r.status)||r.caseId!==c.id||r.backend!==backend||r.releaseQualified!==undefined||
    !sha40(r.compilerCommit)||!sha40(r.fixtureCommit)||r.fixtureBlobSha!==c.fixtureBlobSha||r.fixtureSha256!==c.fixtureSha256||
    !sha64(r.compilerSha256)||!Array.isArray(r.compileArgv)||r.compileArgv.length<2||r.compileArgv.some(x=>typeof x!=='string'||!x||x.includes('\0'))||!r.compileArgv[0].startsWith('/')||
    !Number.isSafeInteger(r.completedSteps)||r.completedSteps<1||!Array.isArray(r.stepNames)||r.stepNames.length<1||r.stepNames.length!==r.completedSteps||r.stepNames.some(x=>typeof x!=='string'||!x)||!receiptStepsValid(c,r)||(r.runnerJobUrl!==null&&(typeof r.runnerJobUrl!=='string'||!/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(r.runnerJobUrl)))||
    r.rejectedEmittedArtifact!==false||!Number.isSafeInteger(r.compilerExit)||typeof r.compilerOutput!=='string'||r.compilerOutput.length>131072){
   return {status:'failed',releaseQualified:false,reason:'invalid or incomplete compiler evidence'};
 }
 if(r.status==='not_executed')return {status:'not_executed',releaseQualified:false,reason:'executed compiler not guest certification'};
 if(r.status==='unsupported'){
  const ok=r.compilerExit!==0&&/unsupported|unimplemented|not supported/i.test(r.compilerOutput)&&r.guestExecuted===false&&r.artifactSha256===null;
  return {status:ok?'unsupported':'failed',releaseQualified:false,reason:ok?'explicit compiler rejection':'invalid unsupported claim'};
 }
 if(r.status==='failed')return {status:'failed',releaseQualified:false,reason:'executed failure recorded; not parity'};
 const positive=c.expect==='positive';
 const traceValid=typeof r.guestOutput==='string'&&r.guestOutput.length<=131072&&(()=>{
  const lines=r.guestOutput.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(c.mustNotObserve.some(marker=>lines.includes(marker)))return false;
  let last=-1;
  for(const marker of c.mustObserve){
   const positions=lines.flatMap((line,i)=>line===marker?[i]:[]);
   if(positions.length!==1)return false;
   if(c.id!=='fire-and-continue'&&positions[0]<=last)return false;
   last=positions[0];
  }
  return true;
 })();
 const semanticDiagnostic=typeof r.compilerOutput==='string'&&r.compilerOutput.split(/\r?\n/).some(line=>line.trimStart().startsWith('error: '+c.expectedDiagnosticCode+' '));
 const valid=positive ? (r.compilerExit===0&&r.guestExecuted===true&&r.stepNames.includes('guest')&&sha64(r.artifactSha256)&&Array.isArray(r.guestArgv)&&r.guestArgv.length>0&&r.guestArgv.every(x=>typeof x==='string'&&x.length>0&&!x.includes('\0'))&&r.guestArgv[0].startsWith('/')&&r.guestExit===42&&traceValid) : (r.compilerExit!==0&&r.guestExecuted===false&&r.artifactSha256===null&&semanticDiagnostic);
 if(!valid)return {status:'failed',releaseQualified:false,reason:'compiler/guest result does not match fixture'};
 return {status:'passed',releaseQualified:false,reason:r.runnerJobUrl===null?'local subprocess candidate; no GitHub runner evidence':'unverified GitHub URL metadata; independent exact-head review required'};
}
export function summarize(cases,receipts){
 const out={};
 for(const backend of backends){
  out[backend]={passed:0,failed:0,unsupported:0,not_executed:0,releaseQualified:false};
  for(const c of cases){const item=classifyReceipt(c,backend,receipts?.[backend]?.[c.id]);out[backend][item.status]++;}
 }
 return out;
}
