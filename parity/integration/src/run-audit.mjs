/* Exact-head GitHub Actions audit. Zero steps are not compiler test results. */
import {createHash} from 'node:crypto';

const REPOSITORY='ores-truffle-oreslang/oreslang-platform-conformance';
const fail=s=>{throw Error('actions-audit: '+s)};
const safeInt=n=>Number.isSafeInteger(n)&&n>0;
const sha=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const shape=(x,ks)=>{if(!x||typeof x!=='object'||Array.isArray(x)||ks.some(k=>!Object.hasOwn(x,k)))fail('incomplete API evidence: '+ks.filter(k=>!Object.hasOwn(x||{},k)).join(','))};

export function validateRequest({repository=REPOSITORY,runId,expectedHead,attempt=1}={}){
 if(repository!==REPOSITORY||!safeInt(runId)||!sha(expectedHead)||!safeInt(attempt)||attempt>1000)fail('invalid immutable repository/run/head/attempt selection');
 return Object.freeze({repository,runId,expectedHead,attempt});
}
export function classifyRun(input,request){
 const selection=validateRequest(request);
 shape(input,['run','jobs','artifacts']);
 const {run,jobs,artifacts}=input;
 shape(run,['id','head_sha','run_attempt','status','conclusion','repository','event']);
 if(run.id!==selection.runId||run.head_sha!==selection.expectedHead||run.run_attempt!==selection.attempt||run.repository?.full_name!==selection.repository||!['pull_request','workflow_dispatch'].includes(run.event))fail('wrong run, repo, event, attempt or head');
 if(!Array.isArray(jobs)||jobs.length===0||jobs.length>100||!Array.isArray(artifacts)||artifacts.length>100)fail('missing/unbounded job or artifact response');
 const seen=new Set(),results=[];
 for(const j of jobs){
  shape(j,['id','run_id','run_attempt','head_sha','status','conclusion','steps']);
  if(!safeInt(j.id)||seen.has(j.id)||j.run_id!==run.id||j.run_attempt!==run.run_attempt||j.head_sha!==run.head_sha)fail('duplicate/mismatched job identity');
  seen.add(j.id);
  if(!['queued','in_progress','completed','waiting','pending','requested'].includes(j.status))fail('invalid job status');
  if(j.steps!==null&&!Array.isArray(j.steps))fail('malformed job steps');
  const steps=j.steps||[];
  if(steps.length>100)fail('unbounded job steps');
  let stepExecutions=0;
  for(const s of steps){
   shape(s,['name','status','conclusion']);
   if(typeof s.name!=='string'||s.name.length>150||!['queued','in_progress','completed','pending'].includes(s.status))fail('malformed step status');
   if(s.status==='completed'&&['success','failure','timed_out'].includes(s.conclusion))stepExecutions++;
  }
  results.push({jobId:j.id,status:j.status,conclusion:j.conclusion??null,recordedSteps:steps.length,completedSteps:stepExecutions,
    classification:stepExecutions===0?'NO_CONFIRMED_EXECUTION_STEPS':j.conclusion==='success'?'STEPS_RECORDED_REVIEW_REQUIRED':'STEPS_RECORDED_FAILED_OR_UNFINISHED'});
 }
 const artifactsSafe=[];
 for(const a of artifacts){
  shape(a,['id','name','size_in_bytes','expired','workflow_run']);
  if(!safeInt(a.id)||typeof a.name!=='string'||a.name.length>150||!Number.isSafeInteger(a.size_in_bytes)||a.size_in_bytes<0||a.workflow_run?.id!==run.id)fail('artifact not attached to selected run');
  artifactsSafe.push({artifactId:a.id,name:a.name,bytes:a.size_in_bytes,expired:a.expired===true});
 }
 const completed=run.status==='completed';
 const noSteps=results.every(j=>j.completedSteps===0);
 const classification=!completed?'NOT_FINAL':noSteps?'NO_EXECUTED_TEST_EVIDENCE':run.conclusion==='success'?'STEPS_RECORDED_NOT_COMPILER_PROOF':'JOB_EXECUTED_WITH_ERRORS_OR_PARTIAL_STEPS';
 const evidence={schemaVersion:1,source:'github-actions-rest-api-response',repository:selection.repository,runId:run.id,head:run.head_sha,attempt:run.run_attempt,
    status:run.status,conclusion:run.conclusion??null,classification,jobs:results,artifacts:artifactsSafe,
    recordedStepCount:results.reduce((n,j)=>n+j.recordedSteps,0),logsExamined:false,
    compilerExecuted:false,guestExecuted:false,hostConformanceCertified:false,backendParityCertified:false,releaseCertified:false,
    limits:['API response metadata alone does not verify runner provenance or source compiler execution','zero steps cannot establish any test outcome','artifacts or successful steps are not semantic compiler parity']};
 const canonical=JSON.stringify(evidence);
 return Object.freeze({...evidence,reportSha256:createHash('sha256').update(canonical).digest('hex')});
}
async function readJson(url,{fetchImpl,token,limitBytes=1048576}){
 const headers={'accept':'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'oreslang-parity-actions-audit'};
 if(token)headers.authorization='Bearer '+token;
 const response=await fetchImpl(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response||response.status!==200)fail('GitHub API request unsuccessful: '+String(response?.status));
 const body=await response.text();if(body.length>limitBytes)fail('GitHub API response too large');
 try{return JSON.parse(body)}catch{fail('non-JSON GitHub API response')}
}
export async function collectRun({runId,expectedHead,attempt=1,token,fetchImpl=fetch}={}){
 const sel=validateRequest({runId,expectedHead,attempt});
 if(typeof fetchImpl!=='function'||(token!==undefined&&(typeof token!=='string'||token.length>4096)))fail('invalid fetch/token');
 const root='https://api.github.com/repos/'+REPOSITORY+'/actions/runs/'+runId;
 const run=await readJson(root,{fetchImpl,token});
 if(run.id!==sel.runId||run.head_sha!==sel.expectedHead||run.run_attempt!==sel.attempt||run.repository?.full_name!==REPOSITORY)fail('GitHub API run did not match pinned source');
 const jobsPage=await readJson(root+'/jobs?per_page=100',{fetchImpl,token});
 const artifactsPage=await readJson(root+'/artifacts?per_page=100',{fetchImpl,token});
 shape(jobsPage,['total_count','jobs']);shape(artifactsPage,['total_count','artifacts']);
 if(!Number.isSafeInteger(jobsPage.total_count)||jobsPage.total_count<1||jobsPage.total_count>100||jobsPage.jobs.length!==jobsPage.total_count||
    !Number.isSafeInteger(artifactsPage.total_count)||artifactsPage.total_count<0||artifactsPage.total_count>100||artifactsPage.artifacts.length!==artifactsPage.total_count)
    fail('pagination incomplete; refuse partial evidence');
 return classifyRun({run,jobs:jobsPage.jobs,artifacts:artifactsPage.artifacts},sel);
}
