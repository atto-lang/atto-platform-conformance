import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSpecAuditGithubSnapshots as assess,checkSpecAuditGithubApi as check} from '../lib/spec-audit-github-evidence.mjs';
const a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40),d='d'.repeat(40),z='e'.repeat(64);
const manifest={schema:'atto.spec-audit-candidates/1',cases:[
 {id:'guard-scalar-positive',kind:'positive',source:'fixtures/guard-v1/canonical-scalar.atto',source_git_blob_sha1:a,expected_guest_i64:'42'},
 {id:'guard-else-negative',kind:'negative',source:'fixtures/guard-v1/reject-else.atto',source_git_blob_sha1:b,control_source:'fixtures/spec-audit-v1/guard-else-control.atto',control_git_blob_sha1:c,expected_diagnostic_class:'GUARD_ELSE_FORBIDDEN'}]};
const expected=()=>({backend:'llvm',compilerHead:a,compilerTree:b,conformanceHead:c,conformanceTree:d,requiredCaseIds:['guard-scalar-positive','guard-else-negative'],requiredSteps:['Compile AttoLang candidates','Execute compiled guest']});
const pins=()=>({workflowPath:'.github/workflows/spec-audit-compiler-guest.yml',jobName:'compiler-guest'});
const receipt=()=>({schema:'atto.spec-audit-guest-claim/1',backend:'llvm',compilerRepository:'ores-truffle-oreslang/oreslang-source.llvm',compilerHead:a,compilerTree:b,compilerSha256:z,conformanceHead:c,conformanceTree:d,runId:123,runAttempt:2,jobId:456,runnerId:77,jobConclusion:'success',steps:[
  {number:3,name:'Compile AttoLang candidates',status:'completed',conclusion:'success'},
  {number:4,name:'Execute compiled guest',status:'completed',conclusion:'success'}],cases:[
  {id:'guard-scalar-positive',kind:'positive',sourceBlob:a,compileExit:0,guestExecuted:true,resultI64:'42',resultChannel:'native-return',runExit:0,guestArtifactSha256:z},
  {id:'guard-else-negative',kind:'negative',sourceBlob:b,compileExit:1,guestExecuted:false,failureStage:'semantic',diagnosticClass:'GUARD_ELSE_FORBIDDEN',control:{sourceBlob:c,compileExit:0,guestExecuted:false}}]});
const response=()=>({
 run:{repository:{id:1410897874,full_name:'ores-truffle-oreslang/oreslang-source.llvm'},head_repository:{id:1410897874,full_name:'ores-truffle-oreslang/oreslang-source.llvm'},id:123,run_attempt:2,head_sha:a,status:'completed',conclusion:'success',event:'pull_request',path:'.github/workflows/spec-audit-compiler-guest.yml'},
 jobs:{total_count:1,jobs:[{id:456,run_id:123,run_attempt:2,head_sha:a,runner_id:77,status:'completed',conclusion:'success',name:'compiler-guest',steps:[
 {number:1,name:'Set up job',status:'completed',conclusion:'success'},
 {number:3,name:'Compile AttoLang candidates',status:'completed',conclusion:'success'},
 {number:4,name:'Execute compiled guest',status:'completed',conclusion:'success'}]}]},
 compilerCommit:{sha:a,tree:{sha:b}},conformanceCommit:{sha:c,tree:{sha:d}},
 conformanceTree:{sha:d,truncated:false,tree:[
  {path:'fixtures/guard-v1/canonical-scalar.atto',type:'blob',sha:a},
  {path:'fixtures/guard-v1/reject-else.atto',type:'blob',sha:b},
  {path:'fixtures/spec-audit-v1/guard-else-control.atto',type:'blob',sha:c}
 ]}
});
function mutate(name,fn,error){test('mutation: '+name,()=>{
 const x=response();fn(x);assert.throws(()=>assess(manifest,receipt(),expected(),pins(),x),error);
});}
test('passing API-shaped metadata does not certify a compiled guest',()=>{
 const v=assess(manifest,receipt(),expected(),pins(),response());
 assert.equal(v.classification,'GITHUB_EXECUTION_METADATA_MATCHED_ARTIFACTS_UNVERIFIED');
 assert.equal(v.guestParityCertified,false);
 assert.equal(v.compilerBinaryAuthenticated,false);
});
mutate('wrong source repo id',x=>x.run.repository.id=99,/API run/);
mutate('foreign PR head',x=>x.run.head_repository.full_name='outside/fork',/API run/);
mutate('wrong run attempt',x=>x.run.run_attempt=1,/API run/);
mutate('wrong run source head',x=>x.run.head_sha=b,/API run/);
mutate('wrong workflow',x=>x.run.path='.github/workflows/other.yml',/API run/);
mutate('failed workflow',x=>x.run.conclusion='failure',/API run/);
mutate('incomplete paged jobs',x=>x.jobs.total_count=101,/partial job/);
mutate('duplicate job name',x=>{x.jobs.total_count=2;x.jobs.jobs.push({...x.jobs.jobs[0],id:90})},/selected job name/);
mutate('unassigned runner',x=>x.jobs.jobs[0].runner_id=0,/job identity/);
mutate('no steps',x=>x.jobs.jobs[0].steps=null,/steps=null/);
mutate('empty steps',x=>x.jobs.jobs[0].steps=[],/steps=null/);
mutate('duplicate step number',x=>x.jobs.jobs[0].steps[1].number=1,/duplicate/);
mutate('fake step status',x=>x.jobs.jobs[0].steps[1].conclusion='failure',/required API step/);
mutate('wrong step label',x=>x.jobs.jobs[0].steps[1].name='Compile something else',/required API step/);
mutate('wrong API compiler tree',x=>x.compilerCommit.tree.sha=c,/API Git commit/);
mutate('wrong API conformance tree',x=>x.conformanceCommit.tree.sha=a,/API Git commit/);
mutate('truncated fixture tree',x=>x.conformanceTree.truncated=true,/incomplete/);
mutate('missing fixture',x=>x.conformanceTree.tree.pop(),/control blob/);
mutate('forged fixture blob',x=>x.conformanceTree.tree[0].sha='f'.repeat(40),/source fixture/);
mutate('forged control blob',x=>x.conformanceTree.tree[2].sha='f'.repeat(40),/control blob/);
mutate('wrong source type',x=>x.conformanceTree.tree[0].type='tree',/source fixture/);
mutate('wrong job source head',x=>x.jobs.jobs[0].head_sha=b,/job identity/);
test('missing independent workflow pin fails closed',()=>assert.throws(()=>assess(manifest,receipt(),expected(),{},response()),/pins required/));
test('unknown backend fails closed',()=>{const r=receipt();r.backend='net';assert.throws(()=>assess(manifest,r,{...expected(),backend:'net'},pins(),response()),/only Java and LLVM|source identity/);});
test('authenticated HTTP fetch path and bearer constraints are enforced',async()=>{
 const values=response(),routes=new Map([
  ['/repos/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/123',values.run],
  ['/repos/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/123/attempts/2/jobs?per_page=100',values.jobs],
  ['/repos/ores-truffle-oreslang/oreslang-source.llvm/git/commits/'+a,values.compilerCommit],
  ['/repos/ores-truffle-oreslang/oreslang-platform-conformance/git/commits/'+c,values.conformanceCommit],
  ['/repos/ores-truffle-oreslang/oreslang-platform-conformance/git/trees/'+d+'?recursive=1',values.conformanceTree]
 ]);
 let invoked=0;
 const transport=async(uri,options)=>{
  const u=new URL(uri);assert.equal(u.origin,'https://api.github.com');
  assert.equal(options.headers.Authorization,'Bearer test-token-123456789');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');
  assert.ok(routes.has(u.pathname+u.search),u.pathname+u.search);invoked++;
  return new Response(JSON.stringify(routes.get(u.pathname+u.search)),{status:200});
 };
 const v=await check(manifest,receipt(),expected(),pins(),{token:'test-token-123456789',transport});
 assert.equal(v.guestParityCertified,false);assert.equal(invoked,5);
});
test('unauthenticated HTTP API is rejected',async()=>{
 await assert.rejects(()=>check(manifest,receipt(),expected(),pins(),{token:''}),/token required/);
});
test('GitHub API 302 redirect is rejected',async()=>{
 const transport=async()=>new Response(null,{status:302,headers:{location:'https://evil.test'}});
 await assert.rejects(()=>check(manifest,receipt(),expected(),pins(),{token:'test-token-123456789',transport}),/direct HTTP 200/);
});
test('GitHub API error response is rejected',async()=>{
 const transport=async()=>new Response('error',{status:403});
 await assert.rejects(()=>check(manifest,receipt(),expected(),pins(),{token:'test-token-123456789',transport}),/direct HTTP 200/);
});
test('GitHub API oversized response is rejected',async()=>{
 const transport=async()=>new Response('x'.repeat(2000100),{status:200});
 await assert.rejects(()=>check(manifest,receipt(),expected(),pins(),{token:'test-token-123456789',transport}),/oversized/);
});
