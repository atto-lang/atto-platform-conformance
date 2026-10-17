/** Read-only GitHub workflow provenance gate. Not a compiler or release attestation. */
import {createHash} from 'node:crypto';
import {classifyRun,validateRequest} from './run-audit.mjs';

const REPO='ores-truffle-oreslang/oreslang-platform-conformance';
export const WORKFLOW=Object.freeze({
  id:387278056,
  path:'.github/workflows/pinned-six-wave-host.yml',
  name:'Pinned six-wave host conformance (not compiler parity)',
  job:'six-wave-host-conformance',
  artifact:'pinned-six-wave-host-report'
});
export const REQUIRED_STEPS=Object.freeze([
  'Check out integration driver','Set up Node 22','Confirm Clang for native format control cases',
  ...Array.from({length:6},(_,i)=>'Checkout wave '+(i+1)+' exact draft head'),
  'Check out 6 pinned wave commits','Test integration runner and provenance denial guards',
  'Run pinned six-wave host suites'
]);
const fail=s=>{throw Error('verified-actions: '+s)};
const positive=n=>Number.isSafeInteger(n)&&n>0;
const sha=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s);
function fields(v,keys){
  if(!v||typeof v!=='object'||Array.isArray(v)||keys.some(k=>!Object.hasOwn(v,k)))fail('missing required API fields: '+keys.filter(k=>!Object.hasOwn(v||{},k)).join(','));
}
function validateBoundRequest({runId,expectedHead,attempt=1,expectedPr}={}){
  const base=validateRequest({repository:REPO,runId,expectedHead,attempt});
  if(!positive(expectedPr))fail('positive expected PR number required');
  return {...base,expectedPr};
}
/** A matching head in an unrelated workflow, fork or PR is not a valid run. */
export function assessBoundRun({run,jobs,artifacts},request){
  const expected=validateBoundRequest(request);
  const basic=classifyRun({run,jobs,artifacts},expected);
  fields(run,['workflow_id','path','head_repository','pull_requests','head_branch']);
  if(run.workflow_id!==WORKFLOW.id||run.path!==WORKFLOW.path||
     run.head_repository?.full_name!==REPO||!Array.isArray(run.pull_requests)||
     !run.pull_requests.some(p=>p?.number===expected.expectedPr&&p?.head?.sha===expected.expectedHead))
    fail('workflow, head repository or PR binding does not match pinned gate');
  if(run.event!=='pull_request')fail('only reviewed PR-triggered runs are accepted');
  if(!Array.isArray(jobs)||jobs.length!==1)fail('unexpected workflow job topology');
  const job=jobs[0];
  fields(job,['name','workflow_name']);
  if(job.name!==WORKFLOW.job||job.workflow_name!==WORKFLOW.name)fail('not the reviewed six-wave job');
  if(artifacts.some(a=>a.workflow_run?.head_sha!==undefined&&a.workflow_run.head_sha!==expected.expectedHead))
    fail('artifact head does not match workflow revision');
  if(new Set(artifacts.map(a=>a.id)).size!==artifacts.length)fail('duplicate artifact id');
  const seen=new Set();
  let next=0,allSuccessful=true,completed=0;
  for(const step of job.steps||[]){
    if(typeof step.name!=='string'||seen.has(step.name))fail('duplicate/missing step names');
    seen.add(step.name);
    const executed=step.status==='completed'&&['success','failure','timed_out'].includes(step.conclusion);
    if(executed)completed++;
    if(next<REQUIRED_STEPS.length&&step.name===REQUIRED_STEPS[next]){
      if(step.status!=='completed'||step.conclusion!=='success')allSuccessful=false;
      next++;
    } else if(REQUIRED_STEPS.includes(step.name)) {
      allSuccessful=false;
    }
  }
  const fullSteps=next===REQUIRED_STEPS.length&&allSuccessful&&completed>=REQUIRED_STEPS.length;
  const reportArtifacts=artifacts.filter(a=>a.name===WORKFLOW.artifact&&!a.expired);
  const reportPresent=reportArtifacts.length===1&&reportArtifacts[0].size_in_bytes>0;
  if(basic.classification==='NO_EXECUTED_TEST_EVIDENCE'&&artifacts.length)fail('artifact appears in run without executed steps');
  let result='NO_EXECUTED_TEST_EVIDENCE';
  if(run.status!=='completed')result='RUN_NOT_FINAL';
  else if(completed>0&&!fullSteps)result='PARTIAL_EXECUTION_NOT_HOST_PROOF';
  else if(fullSteps&&!reportPresent)result='HOST_REPORT_MISSING';
  else if(fullSteps)result='HOST_STEPS_AND_ARTIFACT_METADATA_ONLY';
  const data={
    schemaVersion:1,repository:REPO,runId:expected.runId,attempt:expected.attempt,
    head:expected.expectedHead,pr:expected.expectedPr,workflowId:WORKFLOW.id,
    workflowPath:WORKFLOW.path,jobId:job.id,
    status:result,completedSteps:completed,requiredSteps:REQUIRED_STEPS.length,
    matchingHostArtifactMetadata:reportPresent,
    reportArtifactId:reportPresent?reportArtifacts[0].id:null,
    artifactsDownloaded:false,reportContentsValidated:false,runnerIdentityIndependentlyAttested:false,
    sourceCompilerExecuted:false,guestExecuted:false,hostConformanceCertified:false,
    backendParityCertified:false,releaseCertified:false
  };
  return Object.freeze({...data,contentSha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')});
}
/** Bounded byte-stream reader: never buffer an unbounded .text() response. */
export async function readBoundedGitHubJson(url,{fetchImpl=fetch,token,maxBytes=1048576}={}){
  if(typeof url!=='string'||!url.startsWith('https://api.github.com/repos/'+REPO+'/actions/runs/')||
    typeof fetchImpl!=='function'||(token!==undefined&&(typeof token!=='string'||token.length>4096))||
    !Number.isSafeInteger(maxBytes)||maxBytes<128||maxBytes>2097152)fail('invalid transport arguments');
  const headers={accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'oreslang-parity-verified-actions'};
  if(token)headers.authorization='Bearer '+token;
  const response=await fetchImpl(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response||response.status!==200)fail('GitHub API rejected query: '+String(response?.status));
  if(response.url&&response.url!==url)fail('redirect or response origin changed');
  const type=response.headers?.get?.('content-type')||'';
  if(!/^(application\/json|application\/vnd\.github\+json)(;|$)/i.test(type))fail('non-JSON response type');
  const length=response.headers?.get?.('content-length');
  if(length!==null&&length!==undefined&&(!/^(0|[1-9]\d*)$/.test(length)||Number(length)>maxBytes))fail('invalid or oversized declared content length');
  const reader=response.body?.getReader?.();
  if(!reader)fail('GitHub body must provide a bounded reader');
  const chunks=[];let total=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array)||value.length===0)fail('invalid response chunk');
      total+=value.length;
      if(total>maxBytes)fail('GitHub JSON exceeded byte budget');
      chunks.push(value);
    }
  }catch(e){await reader.cancel?.().catch(()=>{});throw e}finally{reader.releaseLock?.()}
  if(total===0)fail('empty API response');
  const buf=Buffer.concat(chunks,total);
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buf))}catch{fail('invalid UTF-8 JSON body')}
  return data;
}
export async function collectBoundRun({runId,expectedHead,attempt=1,expectedPr,token,fetchImpl=fetch}={}){
  const args=validateBoundRequest({runId,expectedHead,attempt,expectedPr});
  const base='https://api.github.com/repos/'+REPO+'/actions/runs/'+args.runId;
  const run=await readBoundedGitHubJson(base,{token,fetchImpl});
  if(run.id!==args.runId||run.head_sha!==args.expectedHead||run.run_attempt!==args.attempt)fail('primary run identity mismatch');
  const jobs=await readBoundedGitHubJson(base+'/jobs?per_page=100',{token,fetchImpl});
  const artifacts=await readBoundedGitHubJson(base+'/artifacts?per_page=100',{token,fetchImpl});
  fields(jobs,['total_count','jobs']);fields(artifacts,['total_count','artifacts']);
  if(!Array.isArray(jobs.jobs)||jobs.total_count!==jobs.jobs.length||jobs.total_count!==1||
     !Array.isArray(artifacts.artifacts)||artifacts.total_count!==artifacts.artifacts.length||
     artifacts.total_count>100)fail('incomplete or unreviewed pagination/topology');
  return assessBoundRun({run,jobs:jobs.jobs,artifacts:artifacts.artifacts},args);
}
