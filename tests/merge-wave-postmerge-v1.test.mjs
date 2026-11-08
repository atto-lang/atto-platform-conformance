import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPostMerge,validatePostMergeManifest,collectPostMergeWave} from '../src/merge-wave-postmerge-v1.mjs';

const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),D='d'.repeat(40),E='e'.repeat(40);
const policy={workflowId:10,workflowName:'Main CI',jobName:'tests',testStepName:'Run integration tests'};
const spec=(repo='org/site',number=1,extra={})=>({
 repo,number,expectedSourceHead:A,expectedMergeCommit:B,expectedMergeTree:C,
 requiredPostMergeWorkflows:[policy],...extra
});
const clone=x=>structuredClone(x);
function fixture(s=spec()){
 const pr={number:s.number,state:'closed',merged:true,merged_at:'2026-11-08T02:00:00Z',
   head:{sha:s.expectedSourceHead,repo:{full_name:s.repo}},
   base:{ref:'main',repo:{full_name:s.repo}},merge_commit_sha:s.expectedMergeCommit};
 const main={name:'main',protected:true,commit:{sha:s.expectedMergeCommit,
   commit:{tree:{sha:s.expectedMergeTree}}}};
 const run={id:7,workflow_id:10,name:'Main CI',head_sha:s.expectedMergeCommit,
   event:'push',head_branch:'main',status:'completed',conclusion:'success',
   run_attempt:1,repository:{full_name:s.repo},head_repository:{full_name:s.repo}};
 const job={id:8,name:'tests',run_id:7,run_attempt:1,runner_id:3,
   status:'completed',conclusion:'success',steps:[{name:'Run integration tests',
     status:'completed',conclusion:'success'}]};
 return {spec:s,pr,prAfter:clone(pr),mainBefore:main,mainAfter:clone(main),
   mergeCommit:{sha:s.expectedMergeCommit,commit:{tree:{sha:s.expectedMergeTree}},
     parents:[{sha:A}]},
   mainCommit:{sha:s.expectedMergeCommit,commit:{tree:{sha:s.expectedMergeTree}}},
   comparison:{base_commit:{sha:s.expectedMergeCommit},
     head_commit:{sha:s.expectedMergeCommit},status:'identical',ahead_by:0,behind_by:0},
   runs:[run],jobsByRun:{'7':[job]}};
}
test('passing postmerge proof reports source, integrated tree, actual merge and no authority',()=>{
 const r=assessPostMerge(fixture());
 assert.equal(r.verified,true,JSON.stringify(r.blockers));
 assert.equal(r.mergeCommit,B);assert.equal(r.mergeTree,C);
 assert.equal(r.mergeAuthorized,false);
});
test('main may advance while preserving merge as ancestor, with a new tree',()=>{
 const f=fixture();f.mainBefore.commit.sha=D;f.mainAfter.commit.sha=D;
 f.mainBefore.commit.commit.tree.sha=E;f.mainAfter.commit.commit.tree.sha=E;
 f.mainCommit={sha:D,commit:{tree:{sha:E}}};
 f.comparison={base_commit:{sha:B},head_commit:{sha:D},
   status:'ahead',ahead_by:1,behind_by:0};
 f.runs[0].head_sha=D;
 assert.equal(assessPostMerge(f).verified,true);
});
const failures=[
 ['not merged',x=>x.pr.merged=false,'PR_MERGE_IDENTITY_UNVERIFIED'],
 ['PR still open',x=>x.pr.state='open','PR_MERGE_IDENTITY_UNVERIFIED'],
 ['wrong PR number',x=>x.pr.number=2,'PR_MERGE_IDENTITY_UNVERIFIED'],
 ['source head changed',x=>x.pr.head.sha=D,'PR_MERGE_IDENTITY_UNVERIFIED'],
 ['foreign source repository',x=>x.pr.head.repo.full_name='evil/repo','PR_MERGE_IDENTITY_UNVERIFIED'],
 ['feature base',x=>x.pr.base.ref='feature','PR_MERGE_IDENTITY_UNVERIFIED'],
 ['missing merged date',x=>x.pr.merged_at=null,'PR_MERGE_IDENTITY_UNVERIFIED'],
 ['invalid merged date',x=>x.pr.merged_at='2026-02-30T00:00:00Z','PR_MERGE_IDENTITY_UNVERIFIED'],
 ['wrong declared merge',x=>x.pr.merge_commit_sha=D,'PR_MERGE_IDENTITY_UNVERIFIED'],
 ['wrong fetched commit',x=>x.mergeCommit.sha=D,'MERGE_COMMIT_OR_TREE_UNVERIFIED'],
 ['wrong integrated tree',x=>x.mergeCommit.commit.tree.sha=D,'MERGE_COMMIT_OR_TREE_UNVERIFIED'],
 ['missing merge parents',x=>x.mergeCommit.parents=[],'MERGE_COMMIT_OR_TREE_UNVERIFIED'],
 ['unprotected main',x=>x.mainBefore.protected=false,'MAIN_PROTECTION_UNVERIFIED'],
 ['newly unprotected main',x=>x.mainAfter.protected=false,'MAIN_PROTECTION_UNVERIFIED'],
 ['main moved',x=>x.mainAfter.commit.sha=D,'MAIN_MOVED_DURING_VERIFICATION'],
 ['main tree mismatch',x=>x.mainCommit.commit.tree.sha=D,'MAIN_TREE_UNVERIFIED'],
 ['compare diverged',x=>x.comparison.status='diverged','MERGE_NOT_ANCESTOR_OF_MAIN'],
 ['compare reversed',x=>x.comparison.base_commit.sha=D,'MERGE_NOT_ANCESTOR_OF_MAIN'],
 ['compare behind',x=>x.comparison.behind_by=1,'MERGE_NOT_ANCESTOR_OF_MAIN'],
 ['compare false ahead',x=>x.comparison.status='ahead','MERGE_NOT_ANCESTOR_OF_MAIN'],
 ['PR updated mid readback',x=>x.prAfter.merge_commit_sha=D,'PR_CHANGED_DURING_POSTMERGE_READBACK'],
 ['missing push CI',x=>x.runs=[],'MAIN_CI_RUN_AMBIGUOUS_OR_REPLAYED'],
 ['replayed workflow',x=>x.runs.push(clone(x.runs[0])),'MAIN_CI_RUN_AMBIGUOUS_OR_REPLAYED'],
 ['failed main CI',x=>x.runs[0].conclusion='failure','MAIN_CI_RUN_NOT_PINNED'],
 ['wrong CI app repository',x=>x.runs[0].repository.full_name='evil/repo','MAIN_CI_RUN_NOT_PINNED'],
 ['wrong CI source repository',x=>x.runs[0].head_repository.full_name='evil/repo','MAIN_CI_RUN_NOT_PINNED'],
 ['run on feature branch',x=>x.runs[0].head_branch='feature','MAIN_CI_RUN_NOT_PINNED'],
 ['runner not admitted',x=>x.jobsByRun['7'][0].runner_id=0,'MAIN_EXECUTED_TEST_NOT_VERIFIED'],
 ['zero CI steps',x=>x.jobsByRun['7'][0].steps=[],'MAIN_EXECUTED_TEST_NOT_VERIFIED'],
 ['stale job attempt',x=>x.jobsByRun['7'][0].run_attempt=2,'MAIN_EXECUTED_TEST_NOT_VERIFIED'],
 ['missing named test',x=>x.jobsByRun['7'][0].steps[0].name='Setup','MAIN_EXECUTED_TEST_NOT_VERIFIED'],
 ['failed companion job',x=>x.jobsByRun['7'].push({name:'security',conclusion:'failure'}),'MAIN_CI_INCOMPLETE_OR_RUNNERLESS']
];
for(const [label,mutate,reason] of failures)test('deny '+label,()=>{
 const f=fixture();mutate(f);const result=assessPostMerge(f);
 assert.equal(result.verified,false,label);
 assert.ok(result.blockers.includes(reason),JSON.stringify(result.blockers));
 assert.equal(result.mergeAuthorized,false);
});
const invalid=[
 ['empty', {prs:[]}],
 ['missing source head',{prs:[spec('org/site',1,{expectedSourceHead:null})]}],
 ['missing merge SHA',{prs:[spec('org/site',1,{expectedMergeCommit:null})]}],
 ['missing tree SHA',{prs:[spec('org/site',1,{expectedMergeTree:null})]}],
 ['no CI policy',{prs:[spec('org/site',1,{requiredPostMergeWorkflows:[]})]}],
 ['invalid test step',{prs:[spec('org/site',1,{requiredPostMergeWorkflows:[{...policy,testStepName:'  '}]})]}],
 ['duplicate PR',{prs:[spec(),spec()]}],
 ['self dependent',{prs:[spec('org/site',1,{dependsOn:1,expectedParentHead:A})]}],
 ['parent absent',{prs:[spec('org/site',1,{dependsOn:2,expectedParentHead:A})]}],
 ['parent SHA wrong',{prs:[spec('org/site',1,{dependsOn:2,expectedParentHead:D}),spec('org/site',2)]}]
];
for(const [label,value] of invalid)test('manifest refuses '+label,()=>
 assert.throws(()=>validatePostMergeManifest(value)));
test('stacked parent can be declared with exact head even if child appears first',()=>{
 const p=spec('org/cli',4),child=spec('org/cli',5,{dependsOn:4,expectedParentHead:A});
 assert.equal(validatePostMergeManifest({prs:[child,p]}).prs.length,2);
});
function wave(){
 const specs=[
   spec('org/site',1,{expectedMergeCommit:'1'.repeat(40)}),
   spec('org/site',2,{expectedMergeCommit:'2'.repeat(40)}),
   spec('org/editor',3,{expectedMergeCommit:'3'.repeat(40)}),
   spec('org/cli',4,{expectedMergeCommit:'4'.repeat(40)}),
   spec('org/cli',5,{expectedMergeCommit:'5'.repeat(40),
     dependsOn:4,expectedParentHead:A})
 ];
 const newest={'org/site':'2'.repeat(40),'org/editor':'3'.repeat(40),
   'org/cli':'5'.repeat(40)};
 const objects=specs.map((s,i)=>{
   const f=fixture(s),head=newest[s.repo];
   f.pr.merged_at='2026-11-08T0'+(i+1)+':00:00Z';f.prAfter=clone(f.pr);
   f.mainBefore.commit.sha=head;f.mainAfter.commit.sha=head;
   f.mainCommit.sha=head;f.runs[0].head_sha=head;
   f.comparison={base_commit:{sha:s.expectedMergeCommit},
     head_commit:{sha:head},status:head===s.expectedMergeCommit?'identical':'ahead',
     ahead_by:head===s.expectedMergeCommit?0:1,behind_by:0};
   return f;
 });
 const calls=[];
 const client={get:async(path,kind)=>{
   calls.push({path,kind});
   const match=/^\/repos\/([^/]+\/[^/]+)\/(.+)$/.exec(path);
   if(!match)throw Error('unknown provider route');
   const repo=match[1],rest=match[2],number=Number(/^pulls\/(\d+)$/.exec(rest)?.[1]);
   const f=number?objects.find(v=>v.spec.repo===repo&&v.spec.number===number):
     objects.find(v=>v.spec.repo===repo);
   if(!f)throw Error('unknown fixture');
   if(number)return clone(f.pr);
   if(rest==='branches/main')return clone(f.mainBefore);
   if(rest.startsWith('commits/')){
     const hash=rest.slice(8),specific=objects.find(v=>v.spec.repo===repo&&
       v.spec.expectedMergeCommit===hash);
     return clone(specific?specific.mergeCommit:f.mainCommit);
   }
   if(rest.startsWith('compare/')){
     const hash=rest.slice(8).split('...')[0],specific=objects.find(v=>v.spec.repo===repo&&
       v.spec.expectedMergeCommit===hash);
     return clone(specific.comparison);
   }
   if(rest.startsWith('actions/runs?'))return clone(f.runs);
   if(rest.startsWith('actions/runs/')&&rest.endsWith('/jobs?filter=latest'))
     return clone(f.jobsByRun['7']);
   throw Error('unknown resource '+rest);
 }};
 return {manifest:{prs:specs},objects,client,calls};
}
test('five merged PRs spanning three repos count only after source-owned main CI',async()=>{
 const f=wave(),r=await collectPostMergeWave(f.manifest,f.client);
 assert.equal(r.verifiedCount,5,JSON.stringify(r.prs));
 assert.equal(r.distinctVerifiedRepos,3);assert.equal(r.waveVerified,true);
 assert.equal(r.mergeAuthorized,false);
});
test('read-only provider never has a mutation API',async()=>{
 const f=wave();await collectPostMergeWave(f.manifest,f.client);
 assert.equal(typeof f.client.post,'undefined');
 assert.ok(f.calls.every(c=>c.path.startsWith('/repos/')));
});
test('missing compare API evidence refuses all candidate merges',async()=>{
 const f=wave(),old=f.client.get;
 f.client.get=(path,kind)=>path.includes('/compare/')?
   Promise.reject(Error('private token do not leak')):old(path,kind);
 const r=await collectPostMergeWave(f.manifest,f.client);
 assert.equal(r.waveVerified,false);
 assert.ok(r.prs.every(x=>x.blockers.includes('POSTMERGE_PROVIDER_EVIDENCE_UNAVAILABLE')));
 assert.doesNotMatch(JSON.stringify(r),/private token/);
});
test('one missing main merge blocks five-merge count',async()=>{
 const f=wave(),old=f.client.get;
 f.client.get=async(path,kind)=>{
   const v=await old(path,kind);
   return path==='/repos/org/editor/pulls/3'?{...v,merged:false}:v;
 };
 const r=await collectPostMergeWave(f.manifest,f.client);
 assert.equal(r.verifiedCount,4);
 assert.ok(r.blockers.includes('FEWER_THAN_FIVE_VERIFIED_MERGES'));
});
test('failed CLI parent invalidates already assessed stacked child',async()=>{
 const f=wave(),old=f.client.get;
 f.client.get=async(path,kind)=>{
   const v=await old(path,kind);
   return path==='/repos/org/cli/pulls/4'?{...v,merged:false}:v;
 };
 const r=await collectPostMergeWave(f.manifest,f.client);
 assert.equal(r.verifiedCount,3,JSON.stringify(r.prs));
 assert.ok(r.prs[4].blockers.includes('PARENT_NOT_VERIFIED_BEFORE_CHILD'));
});
