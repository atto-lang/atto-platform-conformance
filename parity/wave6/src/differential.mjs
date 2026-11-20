/** Differential *observations*, never a five-backend certification by themselves. */
import {verify,createHash} from 'node:crypto';
const bad=s=>{throw Error('differential: '+s)};
const ok=(x,s)=>{if(!x)bad(s)};
const SHA=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const GIT=x=>typeof x==='string'&&/^[0-9a-f]{40}$/.test(x);
export const BACKENDS=Object.freeze(['java','llvm','net','forge','wasm']);
export const CASES=Object.freeze(['checked-i64-42','actor-lifecycle','typed-messages','cleanup-cancel','ownership-isolation']);
function shape(x,k){ok(x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===k.length&&k.every(y=>Object.hasOwn(x,y)),'evidence schema changed')}
const values=['pass','reject'];
export function validateObservation(o){
 shape(o,['backend','caseId','sourceSha256','sourceGitSha','compilerSha256','artifactSha256','runId','steps','outcome','diagnostic','value','actorTrace','metrics']);
 ok(BACKENDS.includes(o.backend)&&CASES.includes(o.caseId),'unknown backend or case');
 ok(SHA(o.sourceSha256)&&GIT(o.sourceGitSha)&&SHA(o.compilerSha256)&&SHA(o.artifactSha256),'unbound source/guest artifact');
 ok(typeof o.runId==='string'&&/^[1-9][0-9]{4,20}$/.test(o.runId),'missing executed run identifier');
 ok(Array.isArray(o.steps)&&o.steps.length<=30&&o.steps.includes('build-source')&&o.steps.includes('run-guest')&&new Set(o.steps).size===o.steps.length,'no actual compile/execute steps');
 ok(values.includes(o.outcome),'invalid outcome');
 ok(typeof o.diagnostic==='string'&&o.diagnostic.length<=2048,'invalid diagnostic');
 ok(typeof o.value==='string'&&o.value.length<=1000,'invalid result');
 ok(Array.isArray(o.actorTrace)&&o.actorTrace.length<=256,'unbounded actor trace');
 shape(o.metrics,['peakBytes','stepsExecuted','elapsedUs']);
 ok(Number.isSafeInteger(o.metrics.peakBytes)&&o.metrics.peakBytes>=0&&Number.isSafeInteger(o.metrics.stepsExecuted)&&o.metrics.stepsExecuted>0&&Number.isSafeInteger(o.metrics.elapsedUs)&&o.metrics.elapsedUs>=0,'invalid measurement');
 if(o.outcome==='pass')ok(o.diagnostic===''&&/^-?(0|[1-9]\d*)$/.test(o.value),'positive result must be exact decimal text');
 else ok(o.value===''&&/^(error:|E[A-Z0-9_-]+:)/.test(o.diagnostic),'reject needs primary semantic diagnostic');
 for(const evt of o.actorTrace){shape(evt,['id','parent','kind','data']);ok(/^[a-zA-Z0-9_-]{1,48}$/.test(evt.id)&&evt.parent!==evt.id&&(evt.parent===null||/^[a-zA-Z0-9_-]{1,48}$/.test(evt.parent)),'invalid event id');ok(['spawn','send','receive','ready','done','panic','cleanup','cancel'].includes(evt.kind),'unknown event kind');ok(typeof evt.data==='string'&&evt.data.length<=128,'invalid event data');}
 const ids=new Set(),ordered=new Set();
 for(const evt of o.actorTrace){ok(!ids.has(evt.id),'duplicate event ID');ids.add(evt.id);ok(evt.parent===null||ordered.has(evt.parent),'causal parent absent or out of order');ordered.add(evt.id)}
 return o;
}
// Canonicalize scheduling-independent trace by causal event identity, not wall-clock order.
export function semanticProjection(o){validateObservation(o);const trace=[...o.actorTrace].sort((a,b)=>a.id.localeCompare(b.id));return JSON.stringify({caseId:o.caseId,outcome:o.outcome,value:o.value,diagnostic:o.diagnostic,trace});}
export function compareEvidence(records,{requiredCases=CASES}={}){
 ok(Array.isArray(records)&&records.length<=500,'bad evidence batch');
 ok(Array.isArray(requiredCases)&&requiredCases.length>0&&requiredCases.every(c=>CASES.includes(c))&&new Set(requiredCases).size===requiredCases.length,'bad selected cases');
 const matrix=new Map();
 for(const r of records){validateObservation(r);const key=r.caseId+':'+r.backend;ok(!matrix.has(key),'duplicate backend outcome');matrix.set(key,r)}
 const mismatches=[],missing=[];
 for(const c of requiredCases){
  const available=BACKENDS.map(b=>matrix.get(c+':'+b));
  for(let i=0;i<5;i++)if(!available[i])missing.push({caseId:c,backend:BACKENDS[i]});
  if(available.some(x=>!x))continue;
  if(new Set(available.map(x=>x.sourceSha256)).size!==1)mismatches.push({caseId:c,reason:'different source files'});
  if(new Set(available.map(semanticProjection)).size!==1)mismatches.push({caseId:c,reason:'different guest semantics'});
  if(available.every(x=>x.outcome==='reject'))mismatches.push({caseId:c,reason:'reject-all is not parity evidence'});
 }
 return Object.freeze({status:missing.length?'INCOMPLETE':mismatches.length?'DIVERGENT':'OBSERVED_MATCH_NOT_CERTIFIED',missing,mismatches,observed:matrix.size,sourceAndRunnerProvenanceIndependentlyVerified:false,certifiedParity:false});
}
export function verifySignedObservation({payload,signature,publicKey}){
 ok(Buffer.isBuffer(payload)&&payload.length>0&&payload.length<=128*1024,'bounded payload');
 ok(Buffer.isBuffer(signature)&&signature.length===64,'Ed25519 signature length');
 let valid=false;try{valid=verify(null,payload,publicKey,signature)}catch{valid=false}ok(valid,'signed receipt did not verify');
 let obj;try{obj=JSON.parse(payload.toString('utf8'))}catch{bad('invalid JSON observation')}
 validateObservation(obj);
 ok(Buffer.from(JSON.stringify(obj),'utf8').equals(payload),'noncanonical signed JSON');
 return Object.freeze({status:'SIGNATURE_VALID_FOR_CALLER_SUPPLIED_KEY',observation:obj,trustRootIndependentlyApproved:false,certifiedParity:false,payloadSha256:createHash('sha256').update(payload).digest('hex')});
}
