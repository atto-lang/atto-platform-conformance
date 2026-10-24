#!/usr/bin/env node
// Read-only companion to diagnose-actions.mjs for zero-step CI admission.
// Requires a user's GitHub token locally; neither token nor private
// annotation text is emitted or sent to any alternate CI organization.
import {pathToFileURL} from 'node:url';
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA=/^[a-f0-9]{40}$/;
const HINTS=[
  ['BILLING_OR_SPENDING','billing|spending|payment|included minutes|minutes quota|usage limit|account spending'],
  ['ACTIONS_POLICY','not permitted|not allowed|actions policy|workflow is disabled|disabled by|organization policy'],
  ['RUNNER_CAPACITY','runner|hosted runner|no matching labels|runner group|runner offline']
];
const RULES=HINTS.map(([name,pattern])=>[name,new RegExp(pattern,'i')]);
export function summarizeAdmission({run,jobs,annotations}){
  if(!run||!Number.isSafeInteger(run.id)||run.id<=0||!SHA.test(run.head_sha)||
     !Number.isSafeInteger(run.run_attempt)||run.run_attempt<1||
     !Array.isArray(jobs)||!annotations||typeof annotations!=='object')
    throw Error('incomplete or invalid GitHub run identity');
  const ids=new Set(),out=[];
  for(const job of jobs){
    if(!job||!Number.isSafeInteger(job.id)||job.id<=0||ids.has(job.id))
      throw Error('duplicate or invalid GitHub job');
    ids.add(job.id);
    if(job.run_id!==run.id||job.head_sha!==run.head_sha||
       job.run_attempt!==run.run_attempt)
      throw Error('run/attempt/job identity mismatch');
    const zeroStep=job.status==='completed'&&job.conclusion==='failure'&&
      Array.isArray(job.steps)&&job.steps.length===0;
    const obj=annotations[String(job.id)];
    if(!obj||!['read','unavailable'].includes(obj.access)||
       (obj.access==='read'&&!Array.isArray(obj.items)))
      throw Error('missing or malformed check-run annotation record');
    if(obj.access==='read'&&(obj.items.length>100||obj.items.some(x=>
      !x||typeof x.message!=='string'||x.message.length>100000)))
      throw Error('invalid or truncated annotation content');
    // Hints are untrusted annotation messages, never verified billing data.
    const hints=zeroStep&&obj.access==='read'
      ? [...new Set(obj.items.flatMap(x=>RULES.filter(([n,re])=>re.test(x.message))
          .map(([n])=>n)))].sort() : [];
    out.push({jobId:job.id,jobName:String(job.name||'').slice(0,80),
      zeroStepFailure:zeroStep,annotationAccess:obj.access,
      annotationCount:obj.access==='read'?obj.items.length:null,
      unverifiedHints:hints});
  }
  return {schemaVersion:1,contract:'oreslang.ci/prestep-admission-diagnostics-v1',
    runId:run.id,attempt:run.run_attempt,headSha:run.head_sha,
    observedJobCount:out.length,zeroStepJobCount:out.filter(x=>x.zeroStepFailure).length,
    jobs:out,rootCauseConfirmed:false,compilerTestsExecuted:false,
    privateSourceTransferAuthorized:false,
    guidance:'Hints come from check-run annotations, not independent billing/runner/policy verification. Review GitHub organization billing, Actions permissions and job details as an authorized administrator.'};
}
async function request(path,token){
  let response;
  try{
    response=await fetch('https://api.github.com'+path,{
      headers:{Accept:'application/vnd.github+json',
        Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28',
        'User-Agent':'oreslang-readonly-prestep-diagnostic'},
      signal:AbortSignal.timeout(10000),redirect:'error'
    });
  }catch{throw Error('GitHub read-only API request unavailable')}
  if(!response.ok)throw Error('GitHub read-only API HTTP '+response.status);
  try{return await response.json()}catch{throw Error('invalid GitHub JSON')}
}
export async function collectAdmission(repo,runId,requester){
  if(!REPO.test(repo)||repo.split('/').some(s=>s==='.'||s==='..')||
     !Number.isSafeInteger(runId)||runId<=0)
    throw Error('repo and positive run-id required');
  const prefix='/repos/'+repo;
  const before=await requester(prefix+'/actions/runs/'+runId);
  const jobs=[];
  let total=null;
  for(let page=1;page<=10;page++){
    const p=await requester(prefix+'/actions/runs/'+runId+'/jobs?filter=latest&per_page=100&page='+page);
    if(!p||!Number.isSafeInteger(p.total_count)||!Array.isArray(p.jobs)||
       p.jobs.length>100||(total!==null&&total!==p.total_count))
      throw Error('incomplete GitHub jobs response');
    total=p.total_count;jobs.push(...p.jobs);
    if(jobs.length===total)break;
    if(jobs.length>total||p.jobs.length!==100)throw Error('incomplete jobs pagination');
  }
  if(jobs.length!==total)throw Error('job pagination limit');
  const annotations={};
  for(const job of jobs){
    try{
      const data=await requester(prefix+'/check-runs/'+job.id+'/annotations?per_page=100');
      if(!Array.isArray(data)||data.length===100)
        throw Error('annotation page incomplete');
      annotations[String(job.id)]={access:'read',items:data};
    }catch{annotations[String(job.id)]={access:'unavailable'}}
  }
  const after=await requester(prefix+'/actions/runs/'+runId);
  if(before.id!==after.id||before.run_attempt!==after.run_attempt||
     before.head_sha!==after.head_sha||before.conclusion!==after.conclusion||
     before.status!==after.status)throw Error('run changed during diagnostic');
  return summarizeAdmission({run:before,jobs,annotations});
}
async function main(){
  if(process.argv.length!==4)throw Error('usage: node bin/diagnose-prestep-admission.mjs owner/repo run-id');
  const token=process.env.GITHUB_TOKEN||process.env.GH_TOKEN;
  if(!token)throw Error('run locally with read-only GITHUB_TOKEN or GH_TOKEN');
  const result=await collectAdmission(process.argv[2],Number(process.argv[3]),
    path=>request(path,token));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(result.zeroStepJobCount>0)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(e=>{process.stderr.write('CI_ADMISSION_UNVERIFIED: '+e.message+'\n');process.exitCode=2});
