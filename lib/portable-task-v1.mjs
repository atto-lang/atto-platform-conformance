import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const ids=["eager-before-await","fire-and-continue","typed-int","typed-string","generic-hasfuture-once","actorref-readiness","cancel-before-start","cancel-while-suspended","cancel-owned-descendants","physical-cleanup-before-done","reject-duck-hasfuture","reject-actor-self-capture","reject-mut-borrow-capture","reject-await-in-critical"];
const backends=['java','llvm','wasm','forge','net'];
const sha40=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const sha64=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
export const statuses=Object.freeze(['passed','failed','unsupported','not_executed']);
export function validateManifest(m){
 if(!m||m.schema!=='atto.portable-task.v1'||m.contractVersion!==1||m.executionVerified!==false||!Array.isArray(m.cases)||m.cases.length!==ids.length||JSON.stringify(m.backends)!==JSON.stringify(backends)||JSON.stringify(m.statuses)!==JSON.stringify(statuses))throw Error('invalid portable Task manifest');
 for(let i=0;i<ids.length;i++){
  const c=m.cases[i];
  if(!c||c.id!==ids[i]||c.file!==c.id+'.atto'||!['positive','negative'].includes(c.expect)||c.proposedSyntax!==true||
    c.expectedGuestExit!==(c.expect==='positive'?42:null)||!Array.isArray(c.mustObserve)||!Array.isArray(c.mustNotObserve)||
    c.mustObserve.some(x=>typeof x!=='string'||x.length>100)||c.mustNotObserve.some(x=>typeof x!=='string'||x.length>100)||
    !c.baseline||backends.some(b=>c.baseline[b]!=='not_executed')||Object.keys(c.baseline).length!==5)throw Error('invalid portable Task case '+ids[i]);
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
  const fixtureBlobSha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\\0')).update(bytes).digest('hex');
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
    !sha64(r.compilerSha256)||!Array.isArray(r.compileArgv)||r.compileArgv.length<2||r.compileArgv.some(x=>typeof x!=='string'||!x||x.includes('\\0'))||
    !Number.isSafeInteger(r.completedSteps)||r.completedSteps<1||typeof r.runnerJobUrl!=='string'||!/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\\d+/.test(r.runnerJobUrl)||
    !Number.isSafeInteger(r.compilerExit)||typeof r.compilerOutput!=='string'||r.compilerOutput.length>131072){
   return {status:'failed',releaseQualified:false,reason:'invalid or incomplete compiler evidence'};
 }
 if(r.status==='not_executed')return {status:'not_executed',releaseQualified:false,reason:'executed compiler not guest certification'};
 if(r.status==='unsupported'){
  const ok=r.compilerExit!==0&&/unsupported|unimplemented|not supported/i.test(r.compilerOutput)&&r.guestExecuted===false&&r.artifactSha256===null;
  return {status:ok?'unsupported':'failed',releaseQualified:false,reason:ok?'explicit compiler rejection':'invalid unsupported claim'};
 }
 if(r.status==='failed')return {status:'failed',releaseQualified:false,reason:'executed failure recorded; not parity'};
 const positive=c.expect==='positive';
 const valid=positive ? (r.compilerExit===0&&r.guestExecuted===true&&sha64(r.artifactSha256)&&Array.isArray(r.guestArgv)&&r.guestArgv.length>0&&r.guestExit===42&&typeof r.guestOutput==='string'&&r.guestOutput.length<=131072&&c.mustObserve.every(t=>r.guestOutput.includes(t))&&c.mustNotObserve.every(t=>!r.guestOutput.includes(t))) : (r.compilerExit!==0&&r.guestExecuted===false&&r.artifactSha256===null&&typeof r.compilerOutput==='string'&&/error\b/i.test(r.compilerOutput));
 if(!valid)return {status:'failed',releaseQualified:false,reason:'compiler/guest result does not match fixture'};
 return {status:'passed',releaseQualified:false,reason:'candidate passed with complete structural receipt; external exact-head review required'};
}
export function summarize(cases,receipts){
 const out={};
 for(const backend of backends){
  out[backend]={passed:0,failed:0,unsupported:0,not_executed:0,releaseQualified:false};
  for(const c of cases){const item=classifyReceipt(c,backend,receipts?.[backend]?.[c.id]);out[backend][item.status]++;}
 }
 return out;
}
