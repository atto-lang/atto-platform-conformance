import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTrustedWorkflowAdmission as verify, createAuthenticatedGitHubReaders} from '../verification/trusted-workflow-admission.mjs';
const R='ores-truffle-oreslang/oreslang-source.java', S='a'.repeat(40), TREE='b'.repeat(40);
const t0='2026-11-01T12:00:00Z',t1='2026-11-01T12:00:01Z',t2='2026-11-01T12:00:02Z';
const options=()=>({backend:'java',repository:R,runId:1001,attempt:2,commitSha:S,treeSha:TREE,
  workflowPath:'.github/workflows/source-local.yml',workflowId:345,pullRequestNumber:42,
  requiredJobs:['compiler-guest'],
  readRun:async()=>({id:1001,run_attempt:2,head_sha:S,repository:{full_name:R},head_repository:{full_name:R},
    path:'.github/workflows/source-local.yml',workflow_id:345,pull_requests:[{number:42}],
    event:'pull_request',status:'completed',conclusion:'success'}),
  readCommit:async()=>({sha:S,tree:{sha:TREE}}),
  readJobs:async()=>({total_count:1,jobs:[{id:2001,run_id:1001,run_attempt:2,head_sha:S,
    name:'compiler-guest',runner_id:32,runner_name:'verified-runner',status:'completed',
    conclusion:'success',started_at:t0,completed_at:t2,
    steps:[{number:1,name:'checkout',status:'completed',conclusion:'success',started_at:t0,completed_at:t1},
           {number:2,name:'guest',status:'completed',conclusion:'success',started_at:t1,completed_at:t2}]}]})});
function mutate(name, edit, reason=/workflow admission:/) {
  test(name, async()=>{const x=options();const run=await x.readRun(),commit=await x.readCommit(),jobs=await x.readJobs();
    x.readRun=async()=>run;x.readCommit=async()=>commit;x.readJobs=async()=>jobs;
    edit(x,run,commit,jobs);await assert.rejects(verify(x),reason);});
}
test('genuine-looking API observations are only metadata, not guest attestation',async()=>{
  const got=await verify(options());assert.equal(got.classification,'executed_success_api_metadata_only');
  assert.equal(got.checkedJobs[0].executedStepCount,2);
  assert.equal(got.nativeVerified,false);assert.equal(got.sourceTransferAuthorized,false);
  assert.equal(got.independentlyReviewed,false);
});
mutate('wrong exact source commit',x=>x.commitSha='c'.repeat(40));
mutate('wrong exact Git tree',x=>x.treeSha='c'.repeat(40));
mutate('invalid backend',x=>x.backend='untrusted');
mutate('source repo cannot be another organization',x=>x.repository='scintilla-run/scintilla-e2e');
mutate('run ID mismatch',(_x,run)=>run.id=1111);
mutate('run attempt mismatch',(_x,run)=>run.run_attempt=1);
mutate('run head mismatch',(_x,run)=>run.head_sha='c'.repeat(40));
mutate('wrong head repository',(_x,run)=>run.head_repository.full_name='foreign/repo');
mutate('workflow path mismatch',(_x,run)=>run.path='.github/workflows/other.yml');
mutate('workflow event mismatch',(_x,run)=>run.event='workflow_dispatch');
mutate('failed run',(_x,run)=>run.conclusion='failure');
mutate('missing job page',(_x,_r,_c,jobs)=>jobs.jobs=[]);
mutate('job page truncated',(_x,_r,_c,jobs)=>jobs.total_count=2);
mutate('job count exceeds cap',(_x,_r,_c,jobs)=>jobs.total_count=33);
mutate('job with wrong head',(_x,_r,_c,jobs)=>jobs.jobs[0].head_sha='c'.repeat(40));
mutate('job with wrong run attempt',(_x,_r,_c,jobs)=>jobs.jobs[0].run_attempt=1);
mutate('job with zero runner',(_x,_r,_c,jobs)=>jobs.jobs[0].runner_id=0);
mutate('job with no steps',(_x,_r,_c,jobs)=>jobs.jobs[0].steps=[]);
mutate('skipped step',(_x,_r,_c,jobs)=>jobs.jobs[0].steps[1].conclusion='skipped');
mutate('duplicate step ordinal',(_x,_r,_c,jobs)=>jobs.jobs[0].steps[1].number=1);
mutate('step outside job interval',(_x,_r,_c,jobs)=>jobs.jobs[0].steps[1].completed_at='2026-11-01T13:00:00Z');
mutate('step with backwards timestamps',(_x,_r,_c,jobs)=>jobs.jobs[0].steps[1].started_at=t2+'z');
mutate('bad job times',(_x,_r,_c,jobs)=>jobs.jobs[0].started_at='invalid');
mutate('runner newline spoofing',(_x,_r,_c,jobs)=>jobs.jobs[0].runner_name='runner\nFAKE');
mutate('step bidi spoofing',(_x,_r,_c,jobs)=>jobs.jobs[0].steps[0].name='step\u202ePASS');
mutate('duplicate job name',(_x,_r,_c,jobs)=>{jobs.total_count=2;jobs.jobs.push({...jobs.jobs[0],id:2002})});
mutate('recycled job id',(_x,_r,_c,jobs)=>{jobs.total_count=2;jobs.jobs.push({...jobs.jobs[0]})});
mutate('required job allowlist absent',x=>x.requiredJobs=['nonexistent']);
mutate('required job allowlist duplicate',x=>x.requiredJobs=['compiler-guest','compiler-guest']);
mutate('untrusted API reader missing',x=>x.readJobs=undefined);
mutate('jobs payload with self-certified success but no execution',(_x,_r,_c,jobs)=>{jobs.jobs[0].status='completed';jobs.jobs[0].conclusion='success';jobs.jobs[0].steps=[]});
test('256 validated steps at job cap remain admissible',async()=>{
 const x=options(),r=await x.readJobs();const steps=[];
 for(let i=0;i<256;i++)steps.push({number:i+1,name:`s${i+1}`,status:'completed',conclusion:'success',
   started_at:`2026-11-01T12:00:00.${String(i).padStart(9,'0')}Z`,
   completed_at:`2026-11-01T12:00:00.${String(i+1).padStart(9,'0')}Z`});
 r.jobs[0].steps=steps;x.readJobs=async()=>r;assert.equal((await verify(x)).checkedJobs[0].executedStepCount,256);
});
mutate('257 steps are rejected',(_x,_r,_c,jobs)=>{jobs.jobs[0].steps=Array.from({length:257},(_,i)=>({number:i+1,name:'run',status:'completed',conclusion:'success',started_at:t0,completed_at:t1}))});

test('authenticated source-org GitHub REST metadata path uses bearer and no redirects',async()=>{
 const x=options(), run=await x.readRun(), commit=await x.readCommit(), jobs=await x.readJobs();
 const observed=[];
 const api=createAuthenticatedGitHubReaders({token:'private-token-for-mock-only',fetchImpl:async (url,req)=>{
   observed.push({url,req});
   const value=url.includes('/git/commits/')?commit:url.includes('/attempts/')?jobs:run;
   return new Response(JSON.stringify(value),{status:200});
 }});
 const result=await verify({...x,...api});assert.equal(result.checkedJobs[0].executedStepCount,2);
 assert.equal(observed.length,3);
 assert.ok(observed.every(o=>o.url.startsWith(`https://api.github.com/repos/${R}/`)));
 assert.ok(observed.every(o=>o.req.redirect==='error'&&o.req.headers.authorization==='Bearer private-token-for-mock-only'));
 assert.ok(observed.some(o=>o.url.endsWith('/actions/runs/1001/attempts/2/jobs?per_page=100')));
});
test('GitHub API rejects missing bearer credential before any network request',()=>{
 assert.throws(()=>createAuthenticatedGitHubReaders({token:''}),/credential required/);
 assert.throws(()=>createAuthenticatedGitHubReaders({token:'bad\nvalue'}),/credential required/);
});
test('GitHub API fails closed on unauthorized source repository and redirect',async()=>{
 const api=createAuthenticatedGitHubReaders({token:'t',fetchImpl:async()=>({status:302})});
 await assert.rejects(api.readRun({repository:'foreign/repo',runId:1}),/not approved/);
 await assert.rejects(api.readRun({repository:R,runId:1}),/request rejected/);
});
test('GitHub API refuses malformed or oversized response before parsing',async()=>{
 const api=createAuthenticatedGitHubReaders({token:'t',fetchImpl:async()=>new Response(new Uint8Array([255]),{status:200})});
 await assert.rejects(api.readRun({repository:R,runId:1}),/invalid authoritative/);
 const large=createAuthenticatedGitHubReaders({token:'t',fetchImpl:async()=>new Response('x',{status:200,headers:{'content-length':'300000'}})});
 await assert.rejects(large.readRun({repository:R,runId:1}),/too large/);
});

test('GitHub API rejects path traversal and nonnumeric run IDs before transport',async()=>{
 let sent=0;const api=createAuthenticatedGitHubReaders({token:'t',fetchImpl:async()=>{sent++;throw Error('network should not execute')}});
 await assert.rejects(api.readRun({repository:R,runId:'../../contents/README'}),/invalid GitHub run ID/);
 await assert.rejects(api.readJobs({repository:R,runId:1,attempt:'../../contents'}),/invalid GitHub run attempt/);
 await assert.rejects(api.readCommit({repository:R,commitSha:'../../contents'}),/invalid Git commit SHA/);
 assert.equal(sent,0);
});

test('missing Content-Length cannot cause unbounded JSON buffering',async()=>{
 const api=createAuthenticatedGitHubReaders({token:'t',fetchImpl:async()=>new Response('x'.repeat(300000),{status:200})});
 await assert.rejects(api.readRun({repository:R,runId:1}),/oversized/);
});
test('missing streaming response body fails closed',async()=>{
 const api=createAuthenticatedGitHubReaders({token:'t',fetchImpl:async()=>({status:200,body:null})});
 await assert.rejects(api.readRun({repository:R,runId:1}),/request rejected/);
});
test('declared short Content-Length cannot omit trailing bytes',async()=>{
 const api=createAuthenticatedGitHubReaders({token:'t',fetchImpl:async()=>new Response('{}',{status:200,headers:{'content-length':'1'}})});
 await assert.rejects(api.readRun({repository:R,runId:1}),/truncated/);
});

// Source-free adversarial calendar and UTF-8 provenance boundary controls.
mutate('normalized Feb 30 is not a real job start',(_x,_r,_c,jobs)=>{
  jobs.jobs[0].started_at='2026-02-30T12:00:00Z';
});
mutate('non-leap Feb 29 is not a real step time',(_x,_r,_c,jobs)=>{
  jobs.jobs[0].steps[0].started_at='2026-02-29T12:00:00Z';
});
mutate('April 31 cannot be a completed job timestamp',(_x,_r,_c,jobs)=>{
  jobs.jobs[0].completed_at='2026-04-31T12:00:00Z';
});
mutate('24:00 normalized to the following day is rejected',(_x,_r,_c,jobs)=>{
  jobs.jobs[0].started_at='2026-11-01T24:00:00Z';
});
mutate('runner label over 4096 UTF-8 bytes is rejected',(_x,_r,_c,jobs)=>{
  jobs.jobs[0].runner_name='🧪'.repeat(1025);
});
test('valid leap-day UTC timestamps remain admissible',async()=>{
  const x=options(),jobs=await x.readJobs();
  jobs.jobs[0].started_at='2024-02-29T12:00:00Z';
  jobs.jobs[0].steps[0].started_at='2024-02-29T12:00:00Z';
  jobs.jobs[0].steps[0].completed_at='2024-02-29T12:00:01Z';
  jobs.jobs[0].steps[1].started_at='2024-02-29T12:00:01Z';
  jobs.jobs[0].steps[1].completed_at='2024-02-29T12:00:02Z';
  jobs.jobs[0].completed_at='2024-02-29T12:00:02Z';
  x.readJobs=async()=>jobs;
  assert.equal((await verify(x)).checkedJobs[0].executedStepCount,2);
});
test('runner label at exactly 4096 UTF-8 bytes remains admissible',async()=>{
  const x=options(),jobs=await x.readJobs();
  jobs.jobs[0].runner_name='🧪'.repeat(1024);
  x.readJobs=async()=>jobs;
  assert.equal((await verify(x)).checkedJobs[0].runnerId,32);
});

// Nanosecond-precision ordering: Date.parse alone loses these differences.
mutate('reject step beginning one nanosecond before job admission',(_x,_r,_c,jobs)=>{
  jobs.jobs[0].started_at='2026-11-01T12:00:00.000000002Z';
  jobs.jobs[0].steps[0].started_at='2026-11-01T12:00:00.000000001Z';
});
mutate('reject step finishing one nanosecond after job completion',(_x,_r,_c,jobs)=>{
  jobs.jobs[0].completed_at='2026-11-01T12:00:02.000000001Z';
  jobs.jobs[0].steps[1].completed_at='2026-11-01T12:00:02.000000002Z';
});
mutate('reject backwards step hidden within one millisecond',(_x,_r,_c,jobs)=>{
  jobs.jobs[0].steps[0].started_at='2026-11-01T12:00:00.000000002Z';
  jobs.jobs[0].steps[0].completed_at='2026-11-01T12:00:00.000000001Z';
});
mutate('reject ten fractional digits rather than silently truncate',(_x,_r,_c,jobs)=>{
  jobs.jobs[0].steps[0].started_at='2026-11-01T12:00:00.0000000001Z';
});
test('valid mixed-precision nanosecond job and step boundaries pass',async()=>{
  const x=options(),jobs=await x.readJobs(),j=jobs.jobs[0];
  j.started_at='2026-11-01T12:00:00.1Z';
  j.steps[0].started_at='2026-11-01T12:00:00.100000000Z';
  j.steps[0].completed_at='2026-11-01T12:00:01.1Z';
  j.steps[1].started_at='2026-11-01T12:00:01.100000001Z';
  j.steps[1].completed_at='2026-11-01T12:00:02.2Z';
  j.completed_at='2026-11-01T12:00:02.200000000Z';
  x.readJobs=async()=>jobs;
  assert.equal((await verify(x)).checkedJobs[0].executedStepCount,2);
});
test('valid nanosecond ordering across whole-second boundaries passes',async()=>{
  const x=options(),jobs=await x.readJobs(),j=jobs.jobs[0];
  j.started_at='2026-11-01T12:00:00.999999999Z';
  j.steps[0].started_at='2026-11-01T12:00:00.999999999Z';
  j.steps[0].completed_at='2026-11-01T12:00:01.000000000Z';
  j.steps[1].started_at='2026-11-01T12:00:01.000000001Z';
  j.steps[1].completed_at='2026-11-01T12:00:02.000000000Z';
  j.completed_at='2026-11-01T12:00:02.000000001Z';
  x.readJobs=async()=>jobs;
  assert.equal((await verify(x)).checkedJobs[0].executedStepCount,2);
});

// Sequential GitHub Actions steps must not overlap, even if each timestamp
// independently fits inside the job's start/completion interval.
mutate('reject second step starting one nanosecond before first step completes',(_x,_r,_c,jobs)=>{
  jobs.jobs[0].steps[1].started_at='2026-11-01T12:00:00.999999999Z';
});
mutate('reject second step starting before first step starts',(_x,_r,_c,jobs)=>{
  jobs.jobs[0].steps[0].started_at='2026-11-01T12:00:00.5Z';
  jobs.jobs[0].steps[1].started_at='2026-11-01T12:00:00.1Z';
});
test('adjacent steps may meet at the exact same nanosecond',async()=>{
  const x=options(),jobs=await x.readJobs();
  jobs.jobs[0].steps[0].completed_at='2026-11-01T12:00:01.123456789Z';
  jobs.jobs[0].steps[1].started_at='2026-11-01T12:00:01.123456789Z';
  x.readJobs=async()=>jobs;
  assert.equal((await verify(x)).checkedJobs[0].executedStepCount,2);
});
test('one-nanosecond gap between steps is admissible',async()=>{
  const x=options(),jobs=await x.readJobs();
  jobs.jobs[0].steps[0].completed_at='2026-11-01T12:00:01.123456789Z';
  jobs.jobs[0].steps[1].started_at='2026-11-01T12:00:01.123456790Z';
  x.readJobs=async()=>jobs;
  assert.equal((await verify(x)).checkedJobs[0].executedStepCount,2);
});


// U+2028/U+2029 are Unicode line/paragraph separators, not C0/C1 controls
// or Default_Ignorable_Code_Point; reject them in provenance-bearing labels.
mutate('reject runner label with Unicode line separator',(_x,_r,_c,jobs)=>{
  jobs.jobs[0].runner_name='runner\u2028FAKE';
});
mutate('reject step label with Unicode paragraph separator',(_x,_r,_c,jobs)=>{
  jobs.jobs[0].steps[1].name='guest\u2029SUCCESS';
});
mutate('reject job label with Unicode line separator',(x,_r,_c,jobs)=>{
  x.requiredJobs=['compiler\u2028guest'];
  jobs.jobs[0].name='compiler\u2028guest';
});
mutate('reject verifier-owned job allowlist with paragraph separator',x=>{
  x.requiredJobs=['compiler\u2029guest'];
});
test('valid internationalized provenance labels remain admissible',async()=>{
  const x=options(),jobs=await x.readJobs();
  x.requiredJobs=['compilación 🧪'];
  jobs.jobs[0].name='compilación 🧪';
  jobs.jobs[0].runner_name='verified-runner 🧪';
  jobs.jobs[0].steps[1].name='ejecución';
  x.readJobs=async()=>jobs;
  assert.equal((await verify(x)).checkedJobs[0].executedStepCount,2);
});

mutate('missing verifier-owned workflow ID',x=>delete x.workflowId,/missing verifier-owned/);
mutate('missing verifier-owned PR number',x=>delete x.pullRequestNumber,/missing verifier-owned/);
mutate('wrong authoritative workflow ID',(_x,run)=>run.workflow_id=346,/run identity/);
mutate('wrong authoritative PR number',(_x,run)=>run.pull_requests=[{number:41}],/run not associated/);
mutate('missing PR association',(_x,run)=>run.pull_requests=[],/run not associated/);
mutate('non-array PR association',(_x,run)=>run.pull_requests={number:42},/run not associated/);
mutate('oversized PR association',(_x,run)=>run.pull_requests=Array.from({length:33},(_,i)=>({number:i+1})),/run not associated/);
test('matching PR in bounded multi-PR association succeeds',async()=>{
  const x=options(),run=await x.readRun();
  run.pull_requests=[{number:41},{number:42}];
  x.readRun=async()=>run;
  const got=await verify(x);
  assert.equal(got.workflowId,345);
  assert.equal(got.pullRequestNumber,42);
  assert.equal(got.checkedJobs.length,1);
});
