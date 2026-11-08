// Advisory-only post-merge evidence: never creates, approves, or merges PRs.
import {validRepoName} from './merge-wave-readiness-v1.mjs';
const isSha=x=>typeof x==='string'&&/^[0-9a-f]{40}$/.test(x);
const validName=x=>typeof x==='string'&&x.trim().length>0&&x.length<=160;
const distinct=xs=>[...new Set(xs)];
const validDate=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(x)&&
 Number.isFinite(Date.parse(x))&&new Date(Date.parse(x)).toISOString().slice(0,19)===x.slice(0,19);

export function validatePostMergeManifest(manifest){
 if(!Array.isArray(manifest?.prs)||manifest.prs.length<1||manifest.prs.length>20)
   throw Error('Expected 1-20 pinned PRs');
 const known=new Set();
 for(const p of manifest.prs){
   const w=p?.requiredPostMergeWorkflows;
   if(!validRepoName(p?.repo)||!Number.isSafeInteger(p?.number)||p.number<1||
     !isSha(p.expectedSourceHead)||!isSha(p.expectedMergeCommit)||!isSha(p.expectedMergeTree)||
     !Array.isArray(w)||!w.length||w.some(x=>!Number.isSafeInteger(x?.workflowId)||
       x.workflowId<1||!validName(x.workflowName)||!validName(x.jobName)||
       !validName(x.testStepName))||
     distinct(w.map(x=>x.workflowId+':'+x.jobName+':'+x.testStepName)).length!==w.length||
     (p.dependsOn!=null&&(!Number.isSafeInteger(p.dependsOn)||p.dependsOn<1||
       p.dependsOn===p.number||!isSha(p.expectedParentHead))))
     throw Error('Invalid pinned post-merge identity');
   const id=p.repo+'#'+p.number;
   if(known.has(id))throw Error('Duplicate pinned PR');
   known.add(id);
 }
 for(const p of manifest.prs)if(p.dependsOn!=null&&!manifest.prs.some(parent=>
   parent.repo===p.repo&&parent.number===p.dependsOn&&
   parent.expectedSourceHead===p.expectedParentHead))
   throw Error('Missing pinned parent in post-merge wave');
 return manifest;
}
const prIdentity=p=>JSON.stringify({number:p?.number,state:p?.state,merged:p?.merged,
 merged_at:p?.merged_at,merge_commit_sha:p?.merge_commit_sha,head:p?.head?.sha,
 headRepo:p?.head?.repo?.full_name,base:p?.base?.ref,baseRepo:p?.base?.repo?.full_name});
const mainIdentity=b=>JSON.stringify({name:b?.name,protected:b?.protected,head:b?.commit?.sha,
 tree:b?.commit?.commit?.tree?.sha});

export function assessPostMerge({spec,pr,mergeCommit,mainBefore,mainCommit,comparison,
 mainAfter,prAfter,runs,jobsByRun}={}){
 const blockers=[],fail=code=>{if(!blockers.includes(code))blockers.push(code)};
 if(pr?.number!==spec?.number||pr?.state!=='closed'||pr?.merged!==true||
   !validDate(pr?.merged_at)||pr?.head?.sha!==spec.expectedSourceHead||
   pr?.head?.repo?.full_name!==spec.repo||pr?.base?.ref!=='main'||
   pr?.base?.repo?.full_name!==spec.repo||
   pr?.merge_commit_sha!==spec.expectedMergeCommit)fail('PR_MERGE_IDENTITY_UNVERIFIED');
 if(mergeCommit?.sha!==spec?.expectedMergeCommit||
   mergeCommit?.commit?.tree?.sha!==spec?.expectedMergeTree||
   !Array.isArray(mergeCommit?.parents)||mergeCommit.parents.length<1||
   mergeCommit.parents.some(p=>!isSha(p?.sha)))fail('MERGE_COMMIT_OR_TREE_UNVERIFIED');
 const current=mainBefore?.commit?.sha;
 if(mainBefore?.name!=='main'||mainAfter?.name!=='main'||
   mainBefore?.protected!==true||mainAfter?.protected!==true)
   fail('MAIN_PROTECTION_UNVERIFIED');
 if(!isSha(current)||mainAfter?.commit?.sha!==current||
   mainIdentity(mainBefore)!==mainIdentity(mainAfter))
   fail('MAIN_MOVED_DURING_VERIFICATION');
 if(!isSha(current)||mainCommit?.sha!==current||
   !isSha(mainCommit?.commit?.tree?.sha)||
   (mainBefore?.commit?.commit?.tree?.sha!=null&&
     mainBefore.commit.commit.tree.sha!==mainCommit.commit.tree.sha))
   fail('MAIN_TREE_UNVERIFIED');
 if(!isSha(current)||comparison?.base_commit?.sha!==spec?.expectedMergeCommit||
   comparison?.merge_base_commit?.sha!==spec?.expectedMergeCommit||
   !['ahead','identical'].includes(comparison?.status)||
   !Number.isSafeInteger(comparison?.ahead_by)||comparison.ahead_by<0||
   comparison?.behind_by!==0||
   (current===spec.expectedMergeCommit ? comparison?.status!=='identical'||
     comparison.ahead_by!==0 : comparison?.status!=='ahead'||comparison.ahead_by<1))
   fail('MERGE_NOT_ANCESTOR_OF_MAIN');
 if(prIdentity(pr)!==prIdentity(prAfter))fail('PR_CHANGED_DURING_POSTMERGE_READBACK');
 const requirements=spec?.requiredPostMergeWorkflows;
 if(!Array.isArray(runs)||!Array.isArray(requirements)||!requirements.length)
   fail('POSTMERGE_CI_UNVERIFIED');
 if(Array.isArray(requirements))for(const req of requirements){
   const relevant=Array.isArray(runs)?runs.filter(r=>r?.workflow_id===req.workflowId&&
     r?.name===req.workflowName&&r?.head_sha===current&&r?.event==='push'):[];
   if(relevant.length!==1){fail('MAIN_CI_RUN_AMBIGUOUS_OR_REPLAYED');continue}
   const matching=Array.isArray(runs)?runs.filter(r=>r?.workflow_id===req.workflowId&&
     r?.name===req.workflowName&&r?.head_sha===current&&r?.event==='push'&&
     r?.status==='completed'&&r?.conclusion==='success'&&
     r?.repository?.full_name===spec.repo&&r?.head_repository?.full_name===spec.repo&&
     r?.head_branch==='main'&&Number.isSafeInteger(r?.id)&&r.id>0&&
     Number.isSafeInteger(r?.run_attempt)&&r.run_attempt>0):[];
   if(matching.length!==1){fail('MAIN_CI_RUN_NOT_PINNED');continue}
   const run=matching[0],jobs=jobsByRun?.[String(run.id)];
   if(!Array.isArray(jobs)||!jobs.length||
     new Set(jobs.map(j=>j?.name)).size!==jobs.length){
     fail('MAIN_CI_JOBS_UNVERIFIED');continue
   }
   const requiredJob=jobs.filter(j=>j?.name===req.jobName&&j?.run_id===run.id&&
     j?.run_attempt===run.run_attempt&&j?.status==='completed'&&
     j?.conclusion==='success'&&Number.isSafeInteger(j?.runner_id)&&
     j.runner_id>0&&Array.isArray(j?.steps)&&j.steps.length>0&&
     j.steps.some(s=>s?.name===req.testStepName&&s?.status==='completed'&&
       s?.conclusion==='success'));
   if(requiredJob.length!==1)fail('MAIN_EXECUTED_TEST_NOT_VERIFIED');
   if(jobs.some(j=>!['success','skipped'].includes(j?.conclusion)||
     (j?.conclusion==='success'&&(!Number.isSafeInteger(j?.runner_id)||
       j.runner_id<1||!Array.isArray(j.steps)||j.steps.length===0))))
     fail('MAIN_CI_INCOMPLETE_OR_RUNNERLESS');
 }
 return {repo:spec?.repo,number:spec?.number,sourceHead:spec?.expectedSourceHead,
   mergeCommit:spec?.expectedMergeCommit,mergeTree:spec?.expectedMergeTree,
   mainHead:isSha(current)?current:null,
   mainTree:isSha(mainCommit?.commit?.tree?.sha)?mainCommit.commit.tree.sha:null,
   mergedAt:pr?.merged_at,verified:blockers.length===0,blockers,
   advisoryOnly:true,mergeAuthorized:false};
}
export async function collectPostMergeWave(manifest,client){
 validatePostMergeManifest(manifest);
 if(typeof client?.get!=='function')throw TypeError('Missing read-only provider');
 const entries=[];
 for(const spec of manifest.prs){
   const root='/repos/'+spec.repo;
   try{
     const [pr,mainBefore,mergeCommit]=await Promise.all([
       client.get(root+'/pulls/'+spec.number,'object'),
       client.get(root+'/branches/main','object'),
       client.get(root+'/commits/'+spec.expectedMergeCommit,'object')]);
     const mainSha=mainBefore?.commit?.sha;
     if(!isSha(mainSha))throw Error('Main SHA unavailable');
     const [mainCommit,comparison,runs]=await Promise.all([
       client.get(root+'/commits/'+mainSha,'object'),
       client.get(root+'/compare/'+spec.expectedMergeCommit+'...'+mainSha,'object'),
       client.get(root+'/actions/runs?head_sha='+mainSha+'&event=push','runs')]);
     const exact=Array.isArray(runs)?runs.filter(r=>r?.event==='push'&&
       r?.head_sha===mainSha):[];
     const jobsByRun=Object.create(null);
     for(const run of exact){
       if(!Number.isSafeInteger(run?.id)||run.id<1)throw Error('Invalid run ID');
       jobsByRun[String(run.id)]=await client.get(root+'/actions/runs/'+run.id+
         '/jobs?filter=latest','jobs');
     }
     const [mainAfter,prAfter]=await Promise.all([
       client.get(root+'/branches/main','object'),
       client.get(root+'/pulls/'+spec.number,'object')]);
     entries.push(assessPostMerge({spec,pr,mergeCommit,mainBefore,mainCommit,
       comparison,runs:exact,jobsByRun,mainAfter,prAfter}));
   }catch{
     entries.push({repo:spec.repo,number:spec.number,
       sourceHead:spec.expectedSourceHead,mergeCommit:spec.expectedMergeCommit,
       mergeTree:spec.expectedMergeTree,verified:false,
       blockers:['POSTMERGE_PROVIDER_EVIDENCE_UNAVAILABLE'],
       advisoryOnly:true,mergeAuthorized:false});
   }
 }
 const byID=new Map(entries.map(e=>[e.repo+'#'+e.number,e]));
 // Propagate dependency failures to every transitive child independently of manifest order.
 // A parent in this exact attested wave must precede its child in actual merge time.
 for(let pass=0;pass<manifest.prs.length;pass++){
   let changed=false;
   for(const spec of manifest.prs)if(spec.dependsOn!=null){
     const child=byID.get(spec.repo+'#'+spec.number);
     const parent=byID.get(spec.repo+'#'+spec.dependsOn);
     if(!parent?.verified||!validDate(parent.mergedAt)||!validDate(child.mergedAt)||
       Date.parse(parent.mergedAt)>=Date.parse(child.mergedAt)){
       if(child.verified)changed=true;
       child.verified=false;
       child.blockers=distinct([...child.blockers,'PARENT_NOT_VERIFIED_BEFORE_CHILD']);
     }
   }
   if(!changed)break;
 }
 const verified=entries.filter(e=>e.verified),repos=distinct(verified.map(e=>e.repo));
 const blockers=[];
 if(verified.length<5)blockers.push('FEWER_THAN_FIVE_VERIFIED_MERGES');
 if(repos.length<3)blockers.push('FEWER_THAN_THREE_VERIFIED_REPOS');
 return {advisoryOnly:true,mergeAuthorized:false,
   waveVerified:blockers.length===0,verifiedCount:verified.length,
   distinctVerifiedRepos:repos.length,blockers,prs:entries};
}
