// Cross-check an AttoLang guest claim against GitHub API data, without
// pretending that job metadata independently authenticates guest artifacts.
// The live entrypoint uses a read-only GITHUB_TOKEN against api.github.com.
import {validateSpecAuditGuestClaim} from './spec-audit-guest-evidence.mjs';

const REPOS = Object.freeze({
  java: {name:'ores-truffle-oreslang/oreslang-source.java', id:1400792274},
  llvm: {name:'ores-truffle-oreslang/oreslang-source.llvm', id:1410897874}
});
const CONFORMANCE = Object.freeze({name:'ores-truffle-oreslang/oreslang-platform-conformance', id:1413795502});
const SHA1 = /^[a-f0-9]{40}$/;
const SAFE_PATH = /^\.github\/workflows\/[a-zA-Z0-9._-]+\.ya?ml$/;
function reject(reason) {throw Error('SPEC_AUDIT_GITHUB_NOT_VERIFIED: '+reason);}
function int(value){return Number.isSafeInteger(value)&&value>0;}
function obj(value){return value!==null && typeof value==='object' && !Array.isArray(value);}
function boundedString(value,limit=160){return typeof value==='string'&&value.length>0&&value.length<=limit&&!/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/.test(value);}
function checkPins(pins,expected){
  if(!obj(pins)||Object.keys(pins).sort().join(',')!=='jobName,workflowGitBlob,workflowPath')reject('independent CI pins required');
  if(!SAFE_PATH.test(pins.workflowPath)||!boundedString(pins.jobName)||
     typeof pins.workflowGitBlob!=='string'||!SHA1.test(pins.workflowGitBlob))
    reject('invalid workflow/job/blob pins');
  if(!REPOS[expected.backend])reject('only Java and LLVM first-wave backends are supported');
}
function checkStepEquivalence(receipt,job,expected){
  if(!Array.isArray(job.steps)||job.steps.length===0||job.steps.length>256)reject('steps=null/[]: runner admission not proven');
  const used = new Set();
  for(const step of job.steps){
    if(!obj(step)||!int(step.number)||used.has(step.number)||!boundedString(step.name))reject('malformed or duplicate API job step');
    used.add(step.number);
  }
  if(job.steps.some(step=>step.status!=='completed'||!['success','skipped'].includes(step.conclusion)))
    reject('API job contains non-successful executed step');
  for(const required of expected.requiredSteps){
    const matches=job.steps.filter(x=>x.name===required);
    if(matches.length!==1||matches[0].status!=='completed'||matches[0].conclusion!=='success')
      reject('required API step absent/duplicate/failed: '+required);
  }
  for(const claimed of receipt.steps){
    const found=job.steps.filter(x=>x.number===claimed.number);
    if(found.length!==1||found[0].name!==claimed.name||found[0].status!==claimed.status||found[0].conclusion!==claimed.conclusion)
      reject('claimed step differs from authenticated API job');
  }
}
export function assessSpecAuditGithubSnapshots(manifest,receipt,expected,pins,snapshots){
  // This structural prerequisite fails closed on forged guest result fields.
  validateSpecAuditGuestClaim(manifest,receipt,expected);
  checkPins(pins,expected);
  const repo=REPOS[expected.backend];
  if(!obj(snapshots))reject('GitHub response collection required');
  const {run,jobs,compilerCommit,compilerTree,conformanceCommit,conformanceTree}=snapshots;
  if(!obj(run)||!obj(run.repository)||!obj(run.head_repository)||
     run.repository.id!==repo.id||run.head_repository.id!==repo.id||
     run.repository.full_name!==repo.name||run.head_repository.full_name!==repo.name||
     run.id!==receipt.runId||run.run_attempt!==receipt.runAttempt||
     run.head_sha!==expected.compilerHead||run.status!=='completed'||run.conclusion!=='success'||
     !['pull_request','push'].includes(run.event)||
     !(run.path===pins.workflowPath||
       (typeof run.path==='string'&&run.path.startsWith(pins.workflowPath+'@'))))
    reject('API run repository/head/attempt/path/status does not match independent pins');
  if(!obj(jobs)||!int(jobs.total_count)||jobs.total_count>100||
     !Array.isArray(jobs.jobs)||jobs.jobs.length!==jobs.total_count)reject('partial job inventory');
  const selected=jobs.jobs.filter(j=>obj(j)&&j.name===pins.jobName);
  if(selected.length!==1)reject('selected job name missing or duplicated');
  const job=selected[0];
  if(job.id!==receipt.jobId||job.run_id!==receipt.runId||
     job.run_attempt!==receipt.runAttempt||job.head_sha!==expected.compilerHead||
     job.runner_id!==receipt.runnerId||!int(job.runner_id)||
     job.status!=='completed'||job.conclusion!==receipt.jobConclusion||
     job.conclusion!=='success')reject('job identity/runner/attempt/status mismatch');
  checkStepEquivalence(receipt,job,expected);
  if(!obj(compilerCommit)||compilerCommit.sha!==expected.compilerHead||
     compilerCommit.tree?.sha!==expected.compilerTree||
     !obj(conformanceCommit)||conformanceCommit.sha!==expected.conformanceHead||
     conformanceCommit.tree?.sha!==expected.conformanceTree)
    reject('API Git commit/tree identity mismatch');
  if(!obj(compilerTree)||compilerTree.sha!==expected.compilerTree||
     compilerTree.truncated!==false||!Array.isArray(compilerTree.tree)||
     compilerTree.tree.length===0||compilerTree.tree.length>10000)
    reject('incomplete or mismatched compiler tree');
  const workflowEntries=compilerTree.tree.filter(e=>e&&e.path===pins.workflowPath);
  if(workflowEntries.length!==1||workflowEntries[0].type!=='blob'||
     workflowEntries[0].sha!==pins.workflowGitBlob)
    reject('workflow blob does not match independently reviewed SHA');
  if(!obj(conformanceTree)||conformanceTree.sha!==expected.conformanceTree||
     conformanceTree.truncated!==false||!Array.isArray(conformanceTree.tree)||
     conformanceTree.tree.length===0||conformanceTree.tree.length>10000)
    reject('incomplete or mismatched conformance tree');
  const files=new Map();
  for(const entry of conformanceTree.tree){
    if(!obj(entry)||typeof entry.path!=='string'||entry.path.startsWith('/')||
       entry.path.includes('..')||!SHA1.test(entry.sha))reject('invalid tree member');
    if(files.has(entry.path))reject('duplicate tree path');
    files.set(entry.path,entry);
  }
  const ids=new Map(manifest.cases.map(x=>[x.id,x]));
  for(const claimed of receipt.cases){
    const c=ids.get(claimed.id);
    const source=files.get(c.source);
    if(!source||source.type!=='blob'||source.sha!==c.source_git_blob_sha1)reject('API source fixture blob mismatch: '+claimed.id);
    if(c.kind==='negative'){
      const control=files.get(c.control_source);
      if(!control||control.type!=='blob'||control.sha!==c.control_git_blob_sha1)
        reject('API negative control blob mismatch: '+claimed.id);
    }
  }
  // API metadata cannot establish that a compiler artifact or guest binary
  // was the program actually executed. Require independent artifact/log proof.
  return Object.freeze({classification:'GITHUB_EXECUTION_METADATA_MATCHED_ARTIFACTS_UNVERIFIED',
    apiRunId:run.id,apiJobId:job.id,apiRunAttempt:run.run_attempt,
    recordedRequiredSteps:expected.requiredSteps.length,
    conformanceTreeMatched:true,sourceFixtureBlobsMatched:true,
    compilerBinaryAuthenticated:false,guestArtifactAuthenticated:false,
    guestParityCertified:false,independentReviewRequired:true});
}

// The only production transport: authenticated read-only GitHub REST requests.
// No user-supplied URL, redirect, or external provider is accepted.
async function readGithubJson(path,token,transport=fetch){
  if(!/^\/repos\/ores-truffle-oreslang\/[A-Za-z0-9._/-]+(?:\?(?:per_page=100|recursive=1))?$/.test(path)||
     path.includes('..')||path.includes('//'))reject('nonallowlisted GitHub API path');
  if(typeof token!=='string'||token.length<10)reject('GitHub token required');
  const response=await transport('https://api.github.com'+path,{
    method:'GET',redirect:'manual',signal:AbortSignal.timeout(12000),
    headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28'}
  });
  if(!response||response.status!==200||response.redirected)reject('GitHub API did not return direct HTTP 200');
  const length=Number(response.headers?.get('content-length'));
  if(Number.isFinite(length)&&length>2000000)reject('oversized GitHub API response');
  if(!response.body||typeof response.body.getReader!=='function')reject('missing API response stream');
  const reader=response.body.getReader();
  const chunks=[];let total=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;
      total+=value.length;if(total>2000000)reject('oversized API stream');chunks.push(value);
    }
  }finally{reader.releaseLock();}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{reject('malformed GitHub API JSON');}
  return data;
}
export async function checkSpecAuditGithubApi(manifest,receipt,expected,pins,{token,transport}={}){
  validateSpecAuditGuestClaim(manifest,receipt,expected);
  checkPins(pins,expected);
  const repo=REPOS[expected.backend];
  const get=(path)=>readGithubJson(path,token,transport);
  const base='/repos/'+repo.name;
  const [run,jobs,compilerCommit,compilerTree,conformanceCommit,conformanceTree]=await Promise.all([
    get(base+'/actions/runs/'+receipt.runId),
    get(base+'/actions/runs/'+receipt.runId+'/attempts/'+receipt.runAttempt+'/jobs?per_page=100'),
    get(base+'/git/commits/'+expected.compilerHead),
    get(base+'/git/trees/'+expected.compilerTree+'?recursive=1'),
    get('/repos/'+CONFORMANCE.name+'/git/commits/'+expected.conformanceHead),
    get('/repos/'+CONFORMANCE.name+'/git/trees/'+expected.conformanceTree+'?recursive=1')
  ]);
  return assessSpecAuditGithubSnapshots(manifest,receipt,expected,pins,
    {run,jobs,compilerCommit,compilerTree,conformanceCommit,conformanceTree});
}
