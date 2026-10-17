/* Fail closed on incomplete/stale CI step receipts. Caller JSON is NOT trusted attestation. */
const fail=x=>{throw Error('integration-ci: '+x)};
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const keys=(v,k)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==k.length||k.some(x=>!Object.hasOwn(v,x)))fail('missing/unknown evidence field')};
const stepNames=['Check out integration driver','Set up Node 22','Confirm Clang for native format control cases',...Array.from({length:6},(_,i)=>'Checkout wave '+(i+1)+' exact draft head'),'Check out 6 pinned wave commits','Test integration runner and provenance denial guards','Run pinned six-wave host suites'];
export function assessWorkflow(input,{expectedHead}={}){
 keys(input,['repository','runId','attempt','head','conclusion','jobs']);
 if(input.repository!=='ores-truffle-oreslang/oreslang-platform-conformance'||!sha(input.head)||!sha(expectedHead)||input.head!==expectedHead)fail('wrong source repository or head');
 if(!Number.isSafeInteger(input.runId)||input.runId<=0||!Number.isSafeInteger(input.attempt)||input.attempt<=0||input.conclusion!=='success')fail('no successful execution attempt');
 if(!Array.isArray(input.jobs)||input.jobs.length!==1)fail('missing or duplicate job');
 const job=input.jobs[0];keys(job,['name','runId','attempt','head','conclusion','steps']);
 if(job.name!=='six-wave-host-conformance'||job.runId!==input.runId||job.attempt!==input.attempt||job.head!==input.head||job.conclusion!=='success')fail('stale/incorrect job attempt');
 if(!Array.isArray(job.steps)||job.steps.length<stepNames.length||job.steps.length>30)fail('job has zero/too many steps');
 const seen=new Set();
 for(const s of job.steps){
  keys(s,['name','status','conclusion','attempt']);
  if(typeof s.name!=='string'||!s.name||seen.has(s.name)||s.attempt!==input.attempt||s.status!=='completed'||s.conclusion!=='success')fail('missing, stale or failed job step');
  seen.add(s.name);
 }
 if(stepNames.some(x=>!seen.has(x)))fail('required checkout/execution steps missing');
 const positions=stepNames.map(x=>job.steps.findIndex(s=>s.name===x));
 if(positions.some((value,i)=>i>0&&value<=positions[i-1]))fail('required trusted step order is wrong');
 return Object.freeze({status:'UNTRUSTED_CI_STEP_RECEIPT_SHAPE_VALID',
  stepNamesObserved:stepNames,runId:input.runId,head:input.head,
  fetchedIndependentlyFromGitHub:false,runnerIdentityTrusted:false,
  sourceAndGuestProvenanceVerified:false,compilerParityVerified:false,releaseCertified:false});
}
export function checkNoRunAsProof({runConclusions}={}){
 if(!Array.isArray(runConclusions)||!runConclusions.length)fail('no workflows supplied');
 const jobs=runConclusions.flatMap(x=>Array.isArray(x.jobs)?x.jobs:[]);
 const executed=jobs.filter(j=>Array.isArray(j.steps)&&j.steps.length>0);
 return Object.freeze({ranActualSteps:executed.length>0,
  blockedRunCount:jobs.length-executed.length,recordedJobCount:jobs.length,
  safeConclusion:executed.length?'SOME_STEPS_RECORDED_NOT_CERTIFIED':'NO_EXECUTED_TEST_EVIDENCE',
  compilerParityVerified:false});
}
