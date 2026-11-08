import test from 'node:test';
import assert from 'node:assert/strict';
import {collectProtectedWave} from '../src/merge-wave-protected-v1.mjs';
import {makeGitHubReadOnlyClient} from '../src/merge-wave-provider-v1.mjs';
const H='a'.repeat(40),B='b'.repeat(40);
const PRS=[['org/site',1],['org/site',2],['org/editor',3],['org/cli',4],['org/cli',5]];
const manifest=()=>({prs:PRS.map(([repo,number])=>({repo,number,expectedHead:H,expectedBaseSha:B,
  requiredStepNames:['Test'],requiredWorkflows:[{workflowId:7,workflowName:'CI',jobName:'tests',testStepName:'Test'}]}))});
function mock({approval=true,admin=true,check=true,policy=true,rule=[]}={}) {
 const calls=[];
 const get=async(path,kind)=>{
  calls.push([path,kind]);
  const match=/^\/repos\/([^/]+\/[^/]+)\/(.+)$/.exec(path);
  if(!match)throw Error('unknown mock URL '+path);
  const repo=match[1],resource=match[2];
  const number=Number(/^pulls\/(\d+)/.exec(resource)?.[1]);
  const basePr=()=>({number,state:'open',draft:false,merged:false,mergeable:true,merged_at:null,
    user:{login:'the1mills'},head:{sha:H,repo:{full_name:repo}},
    base:{sha:B,ref:'main',repo:{full_name:repo}}});
  if(/^pulls\/\d+$/.test(resource))return basePr();
  if(/^pulls\/\d+\/reviews$/.test(resource))return approval?[
    {id:100+number,user:{login:'ORESoftware'},state:'APPROVED',commit_id:H,
      submitted_at:'2026-11-07T23:00:00Z'}]:[];
  if(resource.startsWith('actions/runs?'))return [{
    id:1000+Number(repo==='org/site'?1:repo==='org/editor'?3:4),name:'CI',
    event:'pull_request',head_sha:H,status:'completed',conclusion:'success',
    workflow_id:7,run_attempt:1,repository:{full_name:repo},head_repository:{full_name:repo},
    pull_requests:(repo==='org/site'?[1,2]:repo==='org/cli'?[4,5]:[3]).map(n=>({
      number:n,base:{repo:{full_name:repo}}}))}];
  if(/^actions\/runs\/\d+\/jobs\?filter=latest$/.test(resource)){
    const runId=Number(/^actions\/runs\/(\d+)/.exec(resource)[1]);
    return [{id:runId+5000,name:'tests',run_id:runId,run_attempt:1,runner_id:99,
      conclusion:'success',steps:[{name:'Test',status:'completed',conclusion:'success',number:1}]}];
  }
  if(resource==='branches/main')return {name:'main',protected:true,commit:{sha:B}};
  if(resource==='branches/main/protection'){
    if(!policy)throw Error('GitHub 403 policy unreadable');
    return {enforce_admins:{enabled:admin},
      required_pull_request_reviews:{required_approving_review_count:1},
      required_status_checks:{checks:[{context:'CI',app_id:15368}]}};
  }
  if(resource==='rules/branches/main')return rule;
  if(resource.startsWith('commits/'+H+'/check-runs?'))return check?[{
    id:333,name:'CI',head_sha:H,status:'completed',conclusion:'success',
    app:{id:15368,slug:'github-actions'}}]:[];
  throw Error('unhandled mock resource '+path);
 };
 return {client:{get},calls};
}
test('missing provider blocks without a network request',async()=>{
 await assert.rejects(collectProtectedWave(manifest(),null),/Missing read-only provider/);
});
test('positive mock never grants merge authority, even when governance succeeds',async()=>{
 const {client}=mock();
 const report=await collectProtectedWave(manifest(),client);
 assert.equal(report.mergeAuthorized,false);
 assert.equal(report.governanceChecked,true);
 assert.ok(report.governance.every(g=>g.readyForHumanGovernanceReview));
});
test('policy branch unreadable fails closed without bypassing existing PR checks',async()=>{
 const {client}=mock({policy:false});
 const report=await collectProtectedWave(manifest(),client);
 assert.equal(report.readyForHumanFinalReview,false);
 assert.ok(report.governance.every(g=>g.blockers.includes('GOVERNANCE_PROVIDER_UNAVAILABLE')));
});
test('missing independent approvals remain blocked independently of policy',async()=>{
 const {client}=mock({approval:false});const report=await collectProtectedWave(manifest(),client);
 assert.equal(report.readyForHumanFinalReview,false);
 assert.ok(report.prs.every(p=>p.blockers.includes('MISSING_EXACT_HEAD_INDEPENDENT_APPROVAL')));
});
test('disabled admin enforcement denies governance',async()=>{
 const {client}=mock({admin:false});const report=await collectProtectedWave(manifest(),client);
 assert.ok(report.governance.every(p=>p.blockers.includes('ADMIN_ENFORCEMENT_UNVERIFIED')));
});
test('required check missing denies governance even when source CI job passes',async()=>{
 const {client}=mock({check:false});const report=await collectProtectedWave(manifest(),client);
 assert.ok(report.governance.every(p=>p.blockers.includes('REQUIRED_CHECK_AMBIGUOUS_OR_MISSING')));
});
test('merge queue cannot be mistaken for directly mergeable PR',async()=>{
 const {client}=mock({rule:[{type:'merge_queue'}]});const report=await collectProtectedWave(manifest(),client);
 assert.ok(report.governance.every(p=>p.blockers.includes('MERGE_QUEUE_REQUIRED')));
});
test('governance requires three readbacks per PR after baseline collector',async()=>{
 const {client,calls}=mock();await collectProtectedWave(manifest(),client);
 assert.equal(calls.filter(x=>x[0]==='/repos/org/editor/rules/branches/main').length,3);
 assert.equal(calls.filter(x=>x[0]==='/repos/org/editor/branches/main/protection').length,3);
});
test('per-PR policy drift between first and second read is denied',async()=>{
 const {client}=mock();const original=client.get;let seen=0;
 client.get=async(path,kind)=>{
  const x=await original(path,kind);
  if(path==='/repos/org/editor/branches/main/protection'&&++seen===2)
    return {...x,enforce_admins:{enabled:false}};
  return x;
 };
 const report=await collectProtectedWave(manifest(),client);
 assert.ok(report.governance[2].blockers.includes('GOVERNANCE_EVIDENCE_CHANGED'));
});
test('late policy drift after per-PR comparison is denied by wave-wide third read',async()=>{
 const {client}=mock();const original=client.get;let seen=0;
 client.get=async(path,kind)=>{
  const x=await original(path,kind);
  if(path==='/repos/org/editor/branches/main/protection'&&++seen===3)
    return {...x,required_pull_request_reviews:{required_approving_review_count:2}};
  return x;
 };
 const report=await collectProtectedWave(manifest(),client);
 assert.ok(report.governance[2].blockers.includes('GOVERNANCE_CHANGED_DURING_WAVE'));
});
test('approval dismissal on a later governance read denies readiness',async()=>{
 const {client}=mock();const original=client.get;let seen=0;
 client.get=async(path,kind)=>{
  const x=await original(path,kind);
  if(path==='/repos/org/editor/pulls/3/reviews'&&++seen>=4)
    return x.map(v=>({...v,dismissed_at:'2026-11-07T23:09:00Z'}));
  return x;
 };
 const report=await collectProtectedWave(manifest(),client);
 assert.ok(report.governance[2].blockers.includes('GOVERNANCE_CHANGED_DURING_WAVE')||
           report.governance[2].blockers.includes('GOVERNANCE_EVIDENCE_CHANGED'));
});
test('source head move during the final baseline recheck invalidates qualification',async()=>{
 const {client}=mock();const original=client.get;let seen=0;
 client.get=async(path,kind)=>{
  const x=await original(path,kind);
  if(path==='/repos/org/editor/pulls/3'&&++seen>=6)
    return {...x,head:{...x.head,sha:B}};
  return x;
 };
 const report=await collectProtectedWave(manifest(),client);
 assert.equal(report.readyForHumanFinalReview,false);
 assert.ok(report.blockers.includes('BASELINE_CHANGED_DURING_GOVERNANCE')||
           report.prs[2].blockers.includes('HEAD_CHANGED'));
});
test('a policy provider network error is not silently converted into an approval',async()=>{
 const {client}=mock();const original=client.get;
 client.get=async(path,kind)=>path.includes('/check-runs?')?Promise.reject(Error('timeout')):original(path,kind);
 const report=await collectProtectedWave(manifest(),client);
 assert.ok(report.governance.every(g=>g.blockers.includes('GOVERNANCE_PROVIDER_UNAVAILABLE')));
});
test('read-only governance never calls a mutation method',async()=>{
 const {client,calls}=mock();await collectProtectedWave(manifest(),client);
 assert.ok(calls.every(([path])=>path.startsWith('/repos/')));
 assert.equal(typeof client.post,'undefined');
});
test('HTTP check-run pages are read and combined through GET only',async()=>{
 const requests=[];
 const api=makeGitHubReadOnlyClient({token:'not-for-logs',pageSize:2,fetchImpl:async(url,options)=>{
  requests.push({url,options});
  const page=Number(new URL(url).searchParams.get('page'));
  return {ok:true,status:200,json:async()=>({check_runs:page===1?[{id:1},{id:2}]:[{id:3}]})};
 }});
 const rows=await api.get('/repos/org/repo/commits/'+H+'/check-runs?filter=latest','checks');
 assert.deepEqual(rows.map(x=>x.id),[1,2,3]);
 assert.equal(requests.length,2);
 assert.ok(requests.every(x=>x.options.method==='GET'&&x.options.redirect==='error'));
});
test('invalid check-run envelope is refused',async()=>{
 const api=makeGitHubReadOnlyClient({token:'x',fetchImpl:async()=>({ok:true,status:200,json:async()=>({check_runs:null})})});
 await assert.rejects(api.get('/repos/org/repo/commits/'+H+'/check-runs','checks'),/Malformed provider pagination/);
});


test('protected branch HTTP 403 is identified without treating it as absent policy',async()=>{
 const {client}=mock();const original=client.get;
 client.get=async(path,kind)=>{
   if(path.endsWith('/branches/main/protection')){
     const error=new Error('private credentials must never appear in report');
     error.status=403;throw error;
   }
   return original(path,kind);
 };
 const r=await collectProtectedWave(manifest(),client);
 assert.equal(r.readyForHumanFinalReview,false);
 assert.ok(r.governance.every(x=>x.blockers.includes('GOVERNANCE_PROTECTION_UNAVAILABLE')));
 assert.ok(r.governance.every(x=>x.unavailableSources.some(s=>s.source==='PROTECTION'&&s.httpStatus===403)));
 assert.doesNotMatch(JSON.stringify(r),/private credentials/i);
});
test('unsupported branch-rules HTTP 400 is reported distinctly from protection failure',async()=>{
 const {client}=mock();const original=client.get;
 client.get=async(path,kind)=>{
   if(path.endsWith('/rules/branches/main')){
     const e=new Error('unsupported endpoint');e.status=400;throw e;
   }
   return original(path,kind);
 };
 const r=await collectProtectedWave(manifest(),client);
 assert.ok(r.governance.every(x=>x.blockers.includes('GOVERNANCE_RULES_UNAVAILABLE')));
 assert.ok(r.governance.every(x=>x.unavailableSources.some(s=>s.source==='RULES'&&s.httpStatus===400)));
});
test('two simultaneous provider failures retain both restricted source categories',async()=>{
 const {client}=mock();const original=client.get;
 client.get=async(path,kind)=>{
   if(path.endsWith('/branches/main/protection')||path.endsWith('/rules/branches/main')){
     const e=new Error('do not log provider secret');e.status=path.includes('/protection')?403:400;throw e;
   }
   return original(path,kind);
 };
 const r=await collectProtectedWave(manifest(),client);
 assert.ok(r.governance.every(x=>x.blockers.includes('GOVERNANCE_PROTECTION_UNAVAILABLE')&&
   x.blockers.includes('GOVERNANCE_RULES_UNAVAILABLE')));
 assert.ok(r.governance.every(x=>x.unavailableSources.length===2));
 assert.doesNotMatch(JSON.stringify(r),/provider secret/);
});
test('check-run permission denied cannot be bypassed by executed workflow steps',async()=>{
 const {client}=mock();const original=client.get;
 client.get=async(path,kind)=>{
   if(path.includes('/check-runs?')){const e=new Error('restricted');e.status=403;throw e;}
   return original(path,kind);
 };
 const r=await collectProtectedWave(manifest(),client);
 assert.ok(r.governance.every(x=>x.blockers.includes('GOVERNANCE_CHECKS_UNAVAILABLE')));
 assert.equal(r.mergeAuthorized,false);
});
test('network failure has source category without misleading invented HTTP status',async()=>{
 const {client}=mock();const original=client.get;
 client.get=async(path,kind)=>path.endsWith('/rules/branches/main')
   ? Promise.reject(new Error('connection reset')) : original(path,kind);
 const r=await collectProtectedWave(manifest(),client);
 assert.ok(r.governance.every(x=>x.blockers.includes('GOVERNANCE_RULES_UNAVAILABLE')));
 assert.ok(r.governance.every(x=>x.unavailableSources.some(s=>s.source==='RULES'&&s.httpStatus===undefined)));
});
test('late rules permission revocation is caught by third wave-wide readback',async()=>{
 const {client}=mock();const original=client.get;let seen=0;
 client.get=async(path,kind)=>{
   if(path==='/repos/org/editor/rules/branches/main'&&++seen===3){
     const e=new Error('policy permission revoked');e.status=403;throw e;
   }
   return original(path,kind);
 };
 const r=await collectProtectedWave(manifest(),client);
 assert.equal(r.readyForHumanFinalReview,false);
 assert.ok(r.governance[2].blockers.includes('GOVERNANCE_RULES_UNAVAILABLE'));
 assert.ok(r.governance[2].unavailableSources.some(s=>s.httpStatus===403));
});
test('HTTP client preserves safe status metadata without echoing credential',async()=>{
 const api=makeGitHubReadOnlyClient({token:'PRIVATE_BEARER_SENTINEL',fetchImpl:async()=>({
   ok:false,status:403,json:async()=>({message:'PRIVATE_BEARER_SENTINEL'})
 })});
 await assert.rejects(async()=>{
   try{await api.get('/repos/org/repo/branches/main/protection')}
   catch(e){
     assert.equal(e.status,403);
     assert.doesNotMatch(e.message,/PRIVATE_BEARER_SENTINEL/);
     throw e;
   }
 },/GitHub provider error 403/);
});


test('live branch response with protected=false blocks the entire wave',async()=>{
 const {client}=mock();const original=client.get;
 client.get=async(path,kind)=>/^\/repos\/[^/]+\/[^/]+\/branches\/main$/.test(path)
   ? {name:'main',protected:false,commit:{sha:B}} : original(path,kind);
 const report=await collectProtectedWave(manifest(),client);
 assert.equal(report.readyForHumanFinalReview,false);
 assert.ok(report.governance.every(x=>x.blockers.includes('MAIN_NOT_PROTECTED')));
 assert.equal(report.mergeAuthorized,false);
});
test('branch commit diverging from PR base is rejected even if protected=true',async()=>{
 const {client}=mock();const original=client.get;
 client.get=async(path,kind)=>/^\/repos\/[^/]+\/[^/]+\/branches\/main$/.test(path)
   ? {name:'main',protected:true,commit:{sha:H}} : original(path,kind);
 const report=await collectProtectedWave(manifest(),client);
 assert.ok(report.governance.every(x=>x.blockers.includes('MAIN_BASE_SHA_CHANGED')));
});
test('main branch metadata unreadable reports branch-specific provider denial',async()=>{
 const {client}=mock();const original=client.get;
 client.get=async(path,kind)=>{
   if(/^\/repos\/[^/]+\/[^/]+\/branches\/main$/.test(path)){const e=new Error('restricted');e.status=403;throw e;}
   return original(path,kind);
 };
 const report=await collectProtectedWave(manifest(),client);
 assert.equal(report.readyForHumanFinalReview,false);
 assert.ok(report.governance.every(x=>x.blockers.includes('GOVERNANCE_BRANCH_UNAVAILABLE')));
 assert.ok(report.governance.every(x=>x.unavailableSources.some(y=>y.source==='BRANCH'&&y.httpStatus===403)));
});
test('main protection change between policy reads is detected',async()=>{
 const {client}=mock();const original=client.get;let seen=0;
 client.get=async(path,kind)=>{
   if(path==='/repos/org/editor/branches/main'&&++seen===2)
     return {name:'main',protected:false,commit:{sha:B}};
   return original(path,kind);
 };
 const report=await collectProtectedWave(manifest(),client);
 assert.ok(report.governance[2].blockers.includes('GOVERNANCE_EVIDENCE_CHANGED'));
});
test('main head movement after per-PR reads is detected wave-wide',async()=>{
 const {client}=mock();const original=client.get;let seen=0;
 client.get=async(path,kind)=>{
   if(path==='/repos/org/editor/branches/main'&&++seen===3)
     return {name:'main',protected:true,commit:{sha:H}};
   return original(path,kind);
 };
 const report=await collectProtectedWave(manifest(),client);
 assert.ok(report.governance[2].blockers.includes('GOVERNANCE_CHANGED_DURING_WAVE'));
});
