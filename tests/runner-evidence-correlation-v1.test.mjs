import test from 'node:test';
import assert from 'node:assert/strict';
import {correlateRunnerEvidence as correlate, CORRELATION_V1 as contract} from '../verification/runner-evidence-correlation-v1.mjs';
const repo='ores-truffle-oreslang/oreslang-platform-conformance',head='a'.repeat(40);
const route=(number,size)=>'/repos/'+repo+'/actions/runs/42/attempts/2/jobs?per_page='+size+'&page='+number;
const page=(number,total,jobs,size)=>({number,requestMethod:'GET',
  requestHost:'github.com',requestPath:route(number,size),
  response:{total_count:total,jobs}});
function setup(){
 const expected={repo,headSha:head,runId:42,attempt:2,jobId:11,
   jobName:'source-only-runner-receipt',event:'pull_request',perPage:100,
   requiredSteps:['Run tests'],treeSha:'b'.repeat(40),tapSha256:'c'.repeat(64)};
 const run={id:42,run_attempt:2,head_sha:head,event:'pull_request',
   status:'completed',conclusion:'success',repository:{full_name:repo},head_repository:{full_name:repo}};
 const j={id:11,name:expected.jobName,run_id:42,run_attempt:2,head_sha:head,
   status:'completed',conclusion:'success',runner_id:5,runner_name:'GitHub Actions 5',
   runner_group_id:0,runner_group_name:'GitHub Actions',labels:['ubuntu-24.04'],
   url:'https://api.github.com/jobs/11',started_at:'2026-11-07T01:00:00Z',
   completed_at:'2026-11-07T01:00:05Z',steps:[{name:'Run tests',number:1,
     status:'completed',conclusion:'success',started_at:'2026-11-07T01:00:01Z',
     completed_at:'2026-11-07T01:00:02Z'}]};
 const receipt={classification:'SOURCE_ONLY_NODE_TEST_EXECUTED_NOT_GUEST_PARITY',
   hosted_api_independent_job_step_correlation:'NOT_PERFORMED',repo,head,
   run_id:'42',run_attempt:'2',job:expected.jobName,tree:'b'.repeat(40),
   tap_sha256:'c'.repeat(64)};
 return {run,pages:[page(1,1,[j],100)],
   jobDetail:JSON.parse(JSON.stringify(j)),expected,perPage:100,receipt};
}
const fresh=()=>JSON.parse(JSON.stringify(setup()));
const check=v=>correlate(v);
const reject=(name,edit,error)=>test(name,()=>{
 const v=fresh();edit(v);assert.throws(()=>check(v),new RegExp(error));
});
test('complete synthetic API evidence is never trusted as runner or guest proof',()=>{
 const r=check(fresh());assert.equal(r.contract,contract.id);
 assert.equal(r.classification,'STEPFUL_RECORD_REQUIRES_INDEPENDENT_ATTESTATION');
 assert.equal(r.independentHostedLogAttestation,false);
 assert.equal(r.guestExecutionProven,false);
 assert.equal(r.mergeAuthorized,false);
 assert.equal(r.receiptBinding,'SELF_REPORTED_RECEIPT_MATCH_NOT_ATTESTED');
});
test('null receipt is never verified',()=>{
 const v=fresh();v.receipt=null;assert.equal(check(v).receiptBinding,'RECEIPT_ABSENT');
});
test('zero runner completed failure remains API-only not admitted',()=>{
 const v=fresh();v.run.conclusion='failure';v.receipt=null;
 const j=v.pages[0].response.jobs[0];
 j.conclusion='failure';j.runner_id=0;j.runner_name='';j.steps=[];
 v.jobDetail=JSON.parse(JSON.stringify(j));
 assert.equal(check(v).classification,'RUNNER_NOT_ADMITTED');
});
test('null runner with steps missing stays unverified',()=>{
 const v=fresh();v.receipt=null;const j=v.pages[0].response.jobs[0];
 j.runner_id=null;j.runner_name=null;j.steps=null;
 v.jobDetail=JSON.parse(JSON.stringify(j));
 assert.equal(check(v).classification,'RUNNER_ADMISSION_UNVERIFIED');
});
test('complete paged inventory correlated, still API-only',()=>{
 const v=fresh(),j=v.pages[0].response.jobs[0];
 v.expected.perPage=1;v.perPage=1;
 v.pages=[page(1,2,[j],1),page(2,2,[{...j,id:12,name:'unrelated'}],1)];
 assert.equal(check(v).correlation,'COMPLETE_JOB_LIST_AND_DETAIL_API_ONLY');
});
reject('truncated pages',v=>{v.expected.perPage=1;v.perPage=1;
 v.pages[0].requestPath=route(1,1);v.pages[0].response.total_count=2;},'E_PAGE_INCOMPLETE');
reject('wrong page index',v=>{v.pages[0].number=2;},'E_PAGE_ORDER');
reject('unreviewed page size',v=>{v.perPage=1;},'E_PAGE_SIZE');
reject('missing final job in page',v=>{v.pages[0].response.total_count=2;
 v.expected.perPage=2;v.perPage=2;v.pages[0].requestPath=route(1,2);},'E_PAGE_LENGTH');
reject('stale attempt run',v=>{v.run.run_attempt=1;},'E_RUN_IDENTITY');
reject('stale attempt job',v=>{v.jobDetail.run_attempt=1;},'E_DETAIL');
reject('stale attempt in list',v=>{v.pages[0].response.jobs[0].run_attempt=1;
 v.jobDetail.run_attempt=1;},'E_JOB_IDENTITY');
reject('detail runner swap',v=>{v.jobDetail.runner_id=999;},'E_DETAIL');
reject('detail conclusion substitution',v=>{v.jobDetail.conclusion='failure';},'E_DETAIL');
reject('detail timestamp substitution',v=>{v.jobDetail.completed_at='2026-11-07T01:00:06Z';},'E_DETAIL');
reject('detail job URL substitution',v=>{v.jobDetail.url='https://example.invalid';},'E_DETAIL');
reject('detail runner group substitution',v=>{v.jobDetail.runner_group_name='Self Hosted';},'E_DETAIL');
reject('detail runner labels substitution',v=>{v.jobDetail.labels[0]='self-hosted';},'E_DETAIL');
reject('detail step conclusion substitution',v=>{v.jobDetail.steps[0].conclusion='failure';},'E_DETAIL');
reject('missing detail step',v=>{v.jobDetail.steps=[];},'E_DETAIL');
reject('accessor in detail step',v=>{Object.defineProperty(v.jobDetail.steps[0],
 'conclusion',{get(){throw Error('getter')}});},'E_DETAIL');
reject('duplicate across pages',v=>{v.expected.perPage=1;v.perPage=1;
 const j=v.pages[0].response.jobs[0];
 v.pages=[page(1,2,[j],1),page(2,2,[{...j}],1)];},'E_DUPLICATE_JOB');
reject('foreign head in second page',v=>{v.expected.perPage=1;v.perPage=1;
 const j=v.pages[0].response.jobs[0];
 v.pages=[page(1,2,[j],1),page(2,2,[{...j,id:12,name:'other',head_sha:'f'.repeat(40)}],1)];},'E_JOB_IDENTITY');
reject('missing selected job',v=>{v.expected.jobId=99;},'E_JOB_MISSING');
reject('receipt wrong repo',v=>{v.receipt.repo='other/private';},'E_RECEIPT_IDENTITY');
reject('receipt wrong head',v=>{v.receipt.head='f'.repeat(40);},'E_RECEIPT_IDENTITY');
reject('receipt stale attempt',v=>{v.receipt.run_attempt='1';},'E_RECEIPT_IDENTITY');
reject('receipt wrong job',v=>{v.receipt.job='other';},'E_RECEIPT_IDENTITY');
reject('receipt changed tree',v=>{v.receipt.tree='f'.repeat(40);},'E_RECEIPT_TREE');
reject('receipt changed transcript hash',v=>{v.receipt.tap_sha256='f'.repeat(64);},'E_RECEIPT_DIGEST');
reject('receipt invalid digest',v=>{v.receipt.tap_sha256='invalid';},'E_RECEIPT_HASH');
reject('receipt claimed host attestation',v=>{v.receipt.hosted_api_independent_job_step_correlation='PASS';},'E_RECEIPT_CLASS');
reject('receipt invented guest authorization',v=>{v.receipt.guestTestsExecuted=true;},'E_RECEIPT_AUTHORITY');
reject('receipt invented merge authorization',v=>{v.receipt.release_authorized=true;},'E_RECEIPT_AUTHORITY');
reject('receipt wrong optional job ID',v=>{v.receipt.job_id='22';},'E_RECEIPT_JOB');
test('matching optional job ID is still untrusted self report',()=>{
 const v=fresh();v.receipt.job_id='11';
 assert.equal(check(v).receiptBinding,'SELF_REPORTED_RECEIPT_MATCH_NOT_ATTESTED');
});

reject('non-GET attempt route',v=>{v.pages[0].requestMethod='POST';},'E_PAGE_ROUTE');
reject('unexpected GitHub host',v=>{v.pages[0].requestHost='github.enterprise.test';},'E_PAGE_ROUTE');
reject('redirected API host',v=>{v.pages[0].requestHost='evil.example';},'E_PAGE_ROUTE');
reject('stale page attempt route',v=>{v.pages[0].requestPath=v.pages[0].requestPath.replace('/attempts/2/','/attempts/1/');},'E_PAGE_ROUTE');
reject('different API page route',v=>{v.pages[0].requestPath=v.pages[0].requestPath.replace('&page=1','&page=2');},'E_PAGE_ROUTE');
reject('unreviewed pagination route',v=>{v.pages[0].requestPath=v.pages[0].requestPath.replace('per_page=100','per_page=99');},'E_PAGE_ROUTE');
reject('missing page request metadata',v=>{delete v.pages[0].requestPath;},'E_FIELD');
reject('request route accessor execution',v=>{Object.defineProperty(v.pages[0],'requestPath',{get(){throw Error('should not execute')}});},'E_ACCESSOR');
