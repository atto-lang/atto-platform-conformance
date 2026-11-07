import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {classifyRunnerJobEvidence, validateRunnerTimestamp} from '../verification/dop-runner-job-evidence-v1.mjs';

const sha = '6cc45825c0e601e8daaafca6bf7c0a7ca0bc5734';
const repo = 'ores-truffle-oreslang/oreslang-source.llvm';
const expected = {repo, headSha:sha, runId:42331819084, attempt:2,
  jobName:'compiler-mixed-native', event:'pull_request',
  requiredSteps:['Admit only exact same-repository immutable PR head',
                 'Checkout exact PR head', 'Execute CTest']};
function normal() {
  const run={id:expected.runId, run_attempt:2,head_sha:sha,event:'pull_request',
    status:'completed',conclusion:'success',repository:{full_name:repo},
    head_repository:{full_name:repo}};
  const job={id:128281843456,run_id:expected.runId,run_attempt:2,head_sha:sha,
    name:'compiler-mixed-native',runner_id:123,runner_name:'GitHub Actions 123',
    status:'completed',conclusion:'success',started_at:'2026-11-07T03:06:50Z',
    completed_at:'2026-11-07T03:07:10Z',steps:[
      {name:expected.requiredSteps[0],number:1,status:'completed',conclusion:'success',started_at:'2026-11-07T03:06:51Z',completed_at:'2026-11-07T03:06:54Z'},
      {name:expected.requiredSteps[1],number:2,status:'completed',conclusion:'success',started_at:'2026-11-07T03:06:55Z',completed_at:'2026-11-07T03:06:59Z'},
      {name:expected.requiredSteps[2],number:3,status:'completed',conclusion:'success',started_at:'2026-11-07T03:07:00Z',completed_at:'2026-11-07T03:07:05Z'}]};
  return {run,response:{total_count:1,jobs:[job]},expected:structuredClone(expected)};
}
function check(v) {return classifyRunnerJobEvidence(v.run,v.response,v.expected);}
const ref = normal();
test('synthetic complete steps remain API-only untrusted evidence',()=>{
  const r=check(normal());assert.equal(r.classification,'STEPFUL_RECORD_REQUIRES_INDEPENDENT_ATTESTATION');
  assert.equal(r.evidence,'API_METADATA_ONLY_NOT_GUEST_PARITY');assert.equal(r.executedStepCount,3);
});
test('actual observed attempt 2 runner=0 and steps=[] is NOT_ADMITTED',()=>{
  const v=normal();v.run.conclusion='failure';v.response.jobs[0].conclusion='failure';
  v.response.jobs[0].runner_id=0;v.response.jobs[0].runner_name='';v.response.jobs[0].steps=[];
  const r=check(v);assert.equal(r.classification,'RUNNER_NOT_ADMITTED');assert.equal(r.runAttempt,2);
});
test('null runner and steps are NOT_ADMITTED',()=>{
  const v=normal();v.response.jobs[0].runner_id=null;v.response.jobs[0].steps=null;
  assert.equal(check(v).classification,'RUNNER_NOT_ADMITTED');
});
test('runner without steps is incomplete, never a pass',()=>{
  const v=normal();v.response.jobs[0].steps=[];assert.equal(check(v).classification,'STEP_RECORDS_MISSING');
});
test('a failed required step cannot pass',()=>{
  const v=normal();v.response.jobs[0].steps[2].conclusion='failure';assert.equal(check(v).classification,'STEPFUL_FAILED_OR_INCOMPLETE');
});
test('job failure cannot pass even if step records say success',()=>{
  const v=normal();v.response.jobs[0].conclusion='failure';assert.equal(check(v).classification,'STEPFUL_FAILED_OR_INCOMPLETE');
});
test('run failure cannot pass even if step records say success',()=>{
  const v=normal();v.run.conclusion='failure';assert.equal(check(v).classification,'STEPFUL_FAILED_OR_INCOMPLETE');
});
test('missing required step cannot pass',()=>{
  const v=normal();v.response.jobs[0].steps.pop();assert.equal(check(v).classification,'STEPFUL_FAILED_OR_INCOMPLETE');
});
const mutations = [
  ['run id substitution', v=>{v.run.id+=1}, 'E_RUN_IDENTITY'],
  ['wrong run attempt', v=>{v.run.run_attempt=1}, 'E_RUN_IDENTITY'],
  ['wrong run head SHA', v=>{v.run.head_sha='a'.repeat(40)}, 'E_RUN_IDENTITY'],
  ['wrong run event', v=>{v.run.event='push'}, 'E_RUN_IDENTITY'],
  ['foreign source org', v=>{v.run.head_repository.full_name='other/private'}, 'E_RUN_IDENTITY'],
  ['foreign destination org', v=>{v.run.repository.full_name='other/private'}, 'E_RUN_IDENTITY'],
  ['job attempt mismatch', v=>{v.response.jobs[0].run_attempt=1}, 'E_JOB_IDENTITY'],
  ['job run id mismatch', v=>{v.response.jobs[0].run_id+=1}, 'E_JOB_IDENTITY'],
  ['job SHA mismatch', v=>{v.response.jobs[0].head_sha='b'.repeat(40)}, 'E_JOB_IDENTITY'],
  ['no job records', v=>{v.response.jobs=[];v.response.total_count=0}, 'E_JOB_INVENTORY'],
  ['paged or inconsistent job total', v=>{v.response.total_count=200}, 'E_JOB_INVENTORY'],
  ['duplicate job name', v=>{v.response.jobs.push({...v.response.jobs[0],id:55});v.response.total_count=2}, 'E_DUPLICATE_JOB'],
  ['duplicate job id', v=>{v.response.jobs.push({...v.response.jobs[0],name:'other'});v.response.total_count=2}, 'E_DUPLICATE_JOB'],
  ['missing selected job', v=>{v.response.jobs[0].name='unrelated'}, 'E_EXPECTED_JOB_MISSING'],
  ['runner zero yet forged steps', v=>{v.response.jobs[0].runner_id=0}, 'E_CONTRADICTORY_RUNNER'],
  ['blank runner name with steps', v=>{v.response.jobs[0].runner_name=''}, 'E_RUNNER_NAME'],
  ['missing job completed time', v=>{v.response.jobs[0].completed_at=null}, 'E_TIME'],
  ['impossible job date', v=>{v.response.jobs[0].started_at='2026-02-30T03:06:50Z'}, 'E_TIME'],
  ['job end before start', v=>{v.response.jobs[0].completed_at='2026-11-07T03:06:40Z'}, 'E_JOB_TIME'],
  ['impossible step date', v=>{v.response.jobs[0].steps[1].started_at='2026-02-30T03:06:55Z'}, 'E_TIME'],
  ['step end before start', v=>{v.response.jobs[0].steps[2].completed_at='2026-11-07T03:06:40Z'}, 'E_STEP_TIME'],
  ['step beyond job completion', v=>{v.response.jobs[0].steps[2].completed_at='2026-11-07T03:07:30Z'}, 'E_STEP_TIME'],
  ['duplicate step name', v=>{v.response.jobs[0].steps[1].name=v.response.jobs[0].steps[0].name}, 'E_STEP_ORDER'],
  ['nonascending step numbers', v=>{v.response.jobs[0].steps[1].number=1}, 'E_STEP_ORDER'],
  ['invalid step number', v=>{v.response.jobs[0].steps[1].number=0}, 'E_INTEGER'],
  ['duplicate expected steps', v=>{v.expected.requiredSteps.push(v.expected.requiredSteps[0])}, 'E_REQUIRED_STEPS'],
  ['missing required step list', v=>{v.expected.requiredSteps=[]}, 'E_REQUIRED_STEPS'],
  ['malformed expected head', v=>{v.expected.headSha='not-a-sha'}, 'E_SHA'],
  ['accessor run identity prohibited', v=>{Object.defineProperty(v.run,'id',{get(){throw Error('getter executed')}})}, 'E_OWN_DATA'],
  ['accessor job steps prohibited', v=>{Object.defineProperty(v.response.jobs[0],'steps',{get(){throw Error('getter executed')}})}, 'E_OWN_DATA'],
  ['unknown expected event', v=>{v.expected.event='push'}, 'E_EVENT'],
];
for(const [label,mutate,error] of mutations) test('rejects '+label,()=>{
  const v=normal();mutate(v);assert.throws(()=>check(v),new RegExp(error));
});
for(const [name,time,ok] of [
 ['leap day','2028-02-29T00:00:00Z',true],
 ['nonleap Feb29','2027-02-29T00:00:00Z',false],
 ['Feb30','2026-02-30T00:00:00Z',false],
 ['invalid month','2026-13-01T00:00:00Z',false],
 ['invalid UTC offset','2026-11-07T00:00:00+15:00',false],
 ['invalid second','2026-11-07T00:00:60Z',false],
 ['millisecond','2026-11-07T00:00:00.123Z',true]
]) test('date parser '+name,()=>ok?assert.ok(Number.isFinite(validateRunnerTimestamp(time,'t'))):assert.throws(()=>validateRunnerTimestamp(time,'t'),/E_TIME/));

test('authoritative GitHub attempt-2 source-free fixture is NOT_ADMITTED',()=>{
  const record=JSON.parse(readFileSync(new URL('../contracts/dop-runner-job-evidence-v1.json', import.meta.url),'utf8'));
  const result=classifyRunnerJobEvidence(record.run,record.jobs,record.expected);
  assert.equal(result.classification,record.classification);
  assert.equal(result.runId,42331819084);
  assert.equal(result.runAttempt,2);
  assert.equal(result.jobId,128281843456);
  assert.equal(result.executedStepCount,0);
  assert.equal(result.evidence,'API_METADATA_ONLY_NOT_GUEST_PARITY');
});
