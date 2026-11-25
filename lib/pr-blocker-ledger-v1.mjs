// Proposal-only, read-only GitHub evidence and coverage kernel. No source-export calls.
export const STATES=Object.freeze({
  EXECUTED_PASS:"EXECUTED_PASS",EXECUTED_FAIL:"EXECUTED_FAIL",
  OBSERVED_NO_STEP_FAILURE:"OBSERVED_NO_STEP_FAILURE",UNOBSERVED:"UNOBSERVED",
  PENDING:"PENDING",SKIPPED:"SKIPPED",CANCELLED:"CANCELLED",UNSUPPORTED:"UNSUPPORTED"
});
const sha40=x=>typeof x==="string"&&/^[0-9a-f]{40}$/.test(x);
export function utcDays(start,end){
  const valid=x=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+"T00:00:00Z"))&&new Date(x+"T00:00:00Z").toISOString().slice(0,10)===x;
  if(!valid(start)||!valid(end))throw Error("invalid UTC date");
  const a=Date.parse(start+"T00:00:00Z"),b=Date.parse(end+"T00:00:00Z");
  if(b<a||b-a>3660*86400000)throw Error("invalid interval");
  const days=[];for(let t=a;t<=b;t+=86400000)days.push(new Date(t).toISOString().slice(0,10));
  return days;
}
export function classifyJobEvidence({expectedHead,run,job,steps,trustedStepNames=[]}={}){
  const state=(s,reason)=>({state:s,reason,guestCertified:false,confidence:s===STATES.UNOBSERVED?"LOW":"HIGH"});
  if(!sha40(expectedHead)||!run||!job||run.head_sha!==expectedHead||(job.head_sha&&job.head_sha!==expectedHead))
    return state(STATES.UNOBSERVED,"head SHA missing or mismatched");
  if(job.conclusion==="skipped")return state(STATES.SKIPPED,"skipped");
  if(job.conclusion==="cancelled"||run.conclusion==="cancelled")return state(STATES.CANCELLED,"cancelled");
  if(job.status!=="completed"||run.status!=="completed")return state(STATES.PENDING,"not completed");
  if(!Array.isArray(steps))return state(STATES.UNOBSERVED,"individual steps unavailable");
  if(steps.length===0)return job.conclusion==="failure"
    ?state(STATES.OBSERVED_NO_STEP_FAILURE,"failed job, explicitly no steps; root cause unverified")
    :state(STATES.UNOBSERVED,"zero steps without failed job");
  if(!Array.isArray(trustedStepNames)||trustedStepNames.length===0||!Number.isInteger(job.runner_id)||job.runner_id<=0)
    return state(STATES.UNOBSERVED,"trusted execution manifest or real runner unavailable");
  const selected=steps.filter(x=>trustedStepNames.includes(x.name));
  if(selected.length!==trustedStepNames.length||new Set(selected.map(x=>x.name)).size!==selected.length)
    return state(STATES.UNOBSERVED,"execution steps missing or duplicated");
  if(selected.some(x=>x.status==="completed"&&x.conclusion==="failure"))
    return state(STATES.EXECUTED_FAIL,"reviewed execution step completed with failure");
  if(job.conclusion==="success"&&run.conclusion==="success"&&selected.every(x=>x.status==="completed"&&x.conclusion==="success"))
    return state(STATES.EXECUTED_PASS,"host-side step evidence; guest NOT certified");
  return state(STATES.UNOBSERVED,"no verified executed failure or pass");
}
export async function discoverOpenPRs({listRepositories,searchPage,readHead,start,end,perPage=100,maxPages=10}={}){
  if(typeof listRepositories!=="function"||typeof searchPage!=="function")throw Error("read-only adapters required");
  if(!Number.isInteger(perPage)||perPage<1||perPage>100||!Number.isInteger(maxPages)||maxPages<1||maxPages>10)throw Error("invalid pagination");
  const days=utcDays(start,end),inventory=new Map(),gaps=[],partitions=[];
  let repos;
  try{repos=await listRepositories();}catch(e){return{prs:[],partitions:[],gaps:[{kind:"REPO_LIST_ERROR",message:String(e)}],complete:false};}
  if(!Array.isArray(repos?.items)||repos.complete!==true)gaps.push({kind:"REPO_LIST_INCOMPLETE",detail:repos?.error??"pagination or permissions unverified"});
  for(const repo of repos?.items??[]){
    if(typeof repo!=="string"||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)){
      gaps.push({kind:"INVALID_REPO",repo:String(repo)});continue;
    }
    for(const day of days){
      let seen=0,total=null,complete=false,invalid=false;
      const unique=new Set();
      const issue=(kind,detail={})=>{invalid=true;gaps.push({kind,repo,day,...detail});};
      for(let page=1;page<=maxPages;page++){
        let r;
        try{r=await searchPage({repo,day,page,perPage,sort:"created",order:"asc"});}
        catch(e){issue("SEARCH_ERROR",{page,status:e?.status??null,message:String(e)});break;}
        if(!Array.isArray(r?.items)){issue("SEARCH_UNOBSERVED",{page});break;}
        if(r.items.length>perPage)issue("PAGE_OVERSIZED",{page,size:r.items.length,perPage});
        if(r.incompleteResults===true)issue("SEARCH_INCOMPLETE",{page});
        if(!Number.isSafeInteger(r.totalCount)||r.totalCount<0)issue("COUNT_UNKNOWN",{page});
        else if(total===null)total=r.totalCount;
        else if(total!==r.totalCount)
          issue("TOTAL_COUNT_CHANGED",{page,previous:total,current:r.totalCount});
        for(const item of r.items){
          const number=item?.number;
          if(!item||typeof item!=="object"||Array.isArray(item)||
             (item.repository_full_name&&item.repository_full_name!==repo)||
             !Number.isSafeInteger(number)||number<1){
            issue("UNTRUSTED_ITEM",{page});continue;
          }
          if(unique.has(number)){issue("DUPLICATE_PR_PAGE",{page,number});continue;}
          unique.add(number);
          seen++;
          inventory.set(repo+"#"+number,{repository:repo,number,url:"https://github.com/"+repo+"/pull/"+number,
            title:item.title??null,head:null,headVerified:false});
        }
        // A repeated page cannot fill missing unique PRs or certify completeness.
        if(total!==null&&seen>=total){complete=!invalid;break;}
        if(r.items.length===0){issue("EARLY_EMPTY_PAGE",{page,seen,total});break;}
        if(page===maxPages)issue("PAGE_LIMIT",{page,seen,total});
      }
      if(total!==null&&total>=1000)issue("SEARCH_1000_CAP",{total});
      partitions.push({repo,day,seen,total,complete:complete&&!invalid&&total!==null&&total<1000});
      if(!complete||invalid||total===null||total>=1000)
        gaps.push({kind:"PARTITION_INCOMPLETE",repo,day,seen,total});
    }
  }
  if(typeof readHead==="function"){
    for(const pr of inventory.values()){
      try{const h=await readHead(pr.repository,pr.number);
        if(sha40(h?.head_sha)&&h.state==="open"){pr.head=h.head_sha;pr.headVerified=true;}
        else gaps.push({kind:"HEAD_UNVERIFIED",repo:pr.repository,number:pr.number});
      }catch(e){gaps.push({kind:"HEAD_ERROR",repo:pr.repository,number:pr.number,message:String(e)});}
    }
  }else if(inventory.size)gaps.push({kind:"HEAD_LOOKUP_NOT_PROVIDED",count:inventory.size});
  return{prs:[...inventory.values()].sort((a,b)=>a.repository.localeCompare(b.repository)||a.number-b.number),
    partitions,gaps,complete:gaps.length===0};
}
export async function collectExactHeadEvidence({repo,head,listRuns,listJobs,listSteps,trustedStepNames=[]}={}){
  if(!sha40(head)||typeof listRuns!=="function"||typeof listJobs!=="function"||typeof listSteps!=="function")
    throw Error("exact head plus read-only run/job/step adapters required");
  const records=[],gaps=[],seenRuns=new Set();
  const validId=x=>Number.isSafeInteger(x)&&x>0;
  let runs;
  try{runs=await listRuns(repo,head);}catch(e){return{records,gaps:[{kind:"RUN_ERROR",message:String(e)}],complete:false};}
  if(runs?.complete!==true)gaps.push({kind:"RUN_PAGINATION_UNVERIFIED"});
  if(!Array.isArray(runs?.items)){
    gaps.push({kind:"RUN_LIST_UNOBSERVED"});
    return{records,gaps,complete:false};
  }
  if(runs.items.length===0)gaps.push({kind:"NO_RUNS_FOUND"});
  for(const run of runs.items){
    if(!run||!validId(run.id)||!validId(run.run_attempt)){
      gaps.push({kind:"RUN_IDENTITY_UNVERIFIED"});
      continue;
    }
    const runKey=run.id+":"+run.run_attempt;
    if(seenRuns.has(runKey)){
      gaps.push({kind:"DUPLICATE_RUN_ATTEMPT",runId:run.id,attempt:run.run_attempt});
      continue;
    }
    seenRuns.add(runKey);
    if(run.head_sha!==head){gaps.push({kind:"RUN_SHA_MISMATCH",runId:run.id});continue;}
    let jobs;
    try{jobs=await listJobs(repo,run.id,run.run_attempt);}
    catch(e){gaps.push({kind:"JOB_ERROR",runId:run.id,message:String(e)});continue;}
    if(jobs?.complete!==true)gaps.push({kind:"JOB_PAGINATION_UNVERIFIED",runId:run.id});
    if(!Array.isArray(jobs?.items)){
      gaps.push({kind:"JOB_LIST_UNOBSERVED",runId:run.id});
      continue;
    }
    if(jobs.items.length===0)gaps.push({kind:"NO_JOBS_FOUND",runId:run.id});
    const seenJobs=new Set();
    for(const job of jobs.items){
      if(!job||!validId(job.id)){
        gaps.push({kind:"JOB_IDENTITY_UNVERIFIED",runId:run.id});
        continue;
      }
      if(seenJobs.has(job.id)){
        gaps.push({kind:"DUPLICATE_JOB",runId:run.id,jobId:job.id});
        continue;
      }
      seenJobs.add(job.id);
      let steps=null;
      try{steps=(await listSteps(repo,job.id))?.steps;}catch(e){
        gaps.push({kind:"STEPS_UNOBSERVED",runId:run.id,jobId:job.id,message:String(e)});
      }
      if(!Array.isArray(steps)&&!gaps.some(x=>x.kind==="STEPS_UNOBSERVED"&&x.runId===run.id&&x.jobId===job.id))
        gaps.push({kind:"STEPS_UNOBSERVED",runId:run.id,jobId:job.id});
      records.push({repository:repo,head,runId:run.id,attempt:run.run_attempt,jobId:job.id,
        ...classifyJobEvidence({expectedHead:head,run,job,steps,trustedStepNames})});
    }
  }
  return{records,gaps,complete:gaps.length===0};
}
export function alertDelta(previous=[],current=[]){
  const key=x=>JSON.stringify([x.repository,x.number,x.cause,x.scope,x.impact]);
  const known=new Map(previous.map(x=>[key(x),x]));
  return current.filter(x=>x.actionable===true&&(!known.has(key(x))||
    known.get(key(x)).status!==x.status||known.get(key(x)).severity!==x.severity));
}
export function exportCandidateGate(facts={}){
  const required=["incidentsIndependentlyResolved","independentSecurityReview","destinationPolicyMerged",
    "destinationPolicyProtected","destinationNumericIdBound","destinationVisibilityPrivate",
    "destinationPermissionsVerified","destinationRetentionVerified","sourceHeadAndTreePinned",
    "allowlistExplicitForExactDestination","noActiveIncidentHold"];
  const missing=required.filter(k=>facts[k]!==true);
  return{eligibleForFurtherIndependentAuthorization:missing.length===0,missing,exportPerformed:false};
}
// Release identity is fixed; never allow callers to shrink or substitute the backend set.
export const CANONICAL_RELEASE_BACKENDS=Object.freeze(["java","llvm","wasm","net","forge"]);
export function releaseReadiness({requiredBackends=CANONICAL_RELEASE_BACKENDS,evidence={},securityIncidentsClear=false,
  approvalPolicyReadable=false,approvalsVerified=false}={}){
  const reasons=[];
  const validBackends=Array.isArray(requiredBackends)&&
    requiredBackends.length===CANONICAL_RELEASE_BACKENDS.length&&
    new Set(requiredBackends).size===CANONICAL_RELEASE_BACKENDS.length&&
    CANONICAL_RELEASE_BACKENDS.every(b=>requiredBackends.includes(b));
  if(!validBackends)reasons.push("BACKEND_SET_INVALID");
  if(securityIncidentsClear!==true)reasons.push("SECURITY_HOLD");
  if(approvalPolicyReadable!==true||approvalsVerified!==true)reasons.push("APPROVAL_UNKNOWN");
  // Inspect the complete canonical set even if caller supplied an invalid subset.
  for(const b of CANONICAL_RELEASE_BACKENDS){
    if(evidence?.[b]?.state!==STATES.EXECUTED_PASS||evidence[b]?.guestCertified!==true)
      reasons.push("BACKEND_NOT_CERTIFIED:"+b);
  }
  return{status:reasons.length?"NOT_CERTIFIED":"CANDIDATE_ONLY",reasons};
}
export async function persistSnapshot(file,snapshot){
  // Explicit opt-in local JSON file; no GitHub writes or source transfer.
  if(typeof file!=="string"||!file.endsWith(".json"))throw Error("JSON file required");
  if(snapshot===null||typeof snapshot!=="object"||Array.isArray(snapshot)||
     (Object.hasOwn(snapshot,"schema")&&snapshot.schema!==1))
    throw Error("invalid schema-versioned snapshot");
  const {mkdir,writeFile,rename,rm}=await import("node:fs/promises");
  const {dirname}=await import("node:path");
  const {randomUUID}=await import("node:crypto");
  await mkdir(dirname(file),{recursive:true});
  const temp=file+"."+randomUUID()+".tmp";
  try{await writeFile(temp,JSON.stringify({...snapshot,schema:1},null,2)+"\n",{flag:"wx",mode:0o600});
    await rename(temp,file);}
  catch(e){await rm(temp,{force:true});throw e;}
  return file;
}
