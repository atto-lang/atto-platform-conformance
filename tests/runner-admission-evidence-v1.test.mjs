import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRunnerAdmission as check, runnerAdmissionExitCode as exitCode} from '../tools/runner-admission-evidence-v1.mjs';

const SHA = 'a'.repeat(40);
const P = {repository:'ores-truffle-oreslang/oreslang-platform-conformance',head_sha:SHA,run_id:1234,run_attempt:2};
function fixture() {
  return {
    expected:{...P},
    run: {id:1234,run_attempt:2,head_sha:SHA,repository:{full_name:P.repository},status:'completed',conclusion:'success'},
    jobs:{total_count:1,jobs:[{id:77,run_id:1234,run_attempt:2,name:'source-local-canary',status:'completed',conclusion:'success',runner_id:61,runner_name:'GitHub Actions 61',steps:[
      {number:1,name:'Set up job',status:'completed',conclusion:'success'},
      {number:2,name:'Confirm a runner executed a shell step',status:'completed',conclusion:'success'},
      {number:3,name:'Complete job',status:'completed',conclusion:'success'}
    ]}]}
  };
}
const claimNeverGrantsRelease = (f, kind) => {
  const r=check(f);
  assert.equal(r.classification,kind);
  assert.equal(r.merge_authorized,false);
  assert.equal(r.release_certified,false);
  assert.equal(r.source_guest_executed,false);
  assert.notEqual(exitCode(r),0);
};

test('complete source-free canary can prove only runner execution',()=>{
  const x=fixture();claimNeverGrantsRelease(x,'RUNNER_EXECUTION_OBSERVED');
  assert.equal(check(x).stepful_job_count,1);
  assert.equal(exitCode(check(x)),3);
});
test('zero-step failure is NOT_EXECUTED, never a compiler test failure',()=>{
  const x=fixture();x.run.conclusion='failure';x.jobs.jobs[0].conclusion='failure';x.jobs.jobs[0].steps=[];
  claimNeverGrantsRelease(x,'NOT_EXECUTED');assert.deepEqual(check(x).reasons,['ALL_JOBS_ZERO_STEPS']);
});
test('zero-step forged successful job is rejected',()=>{
  const x=fixture();x.jobs.jobs[0].steps=[];
  claimNeverGrantsRelease(x,'BLOCKED');assert.ok(check(x).reasons.includes('ZERO_STEP_SUCCESS_NOT_EXECUTION'));
});
test('missing run or untrusted identity has no authority',()=>{
  claimNeverGrantsRelease({},'INVALID_INPUT');
  for(const field of ['id','run_attempt','head_sha']){
    const x=fixture();x.run[field]=field==='head_sha'?'b'.repeat(40):999;
    claimNeverGrantsRelease(x,'BLOCKED');
  }
  const x=fixture();x.run.repository.full_name='evil/foreign';claimNeverGrantsRelease(x,'BLOCKED');
});
test('wrong job attempt/id cannot borrow a neighboring success',()=>{
  for (const field of ['run_id','run_attempt','id']){
    const x=fixture();x.jobs.jobs[0][field]=field==='id'?0:999;
    claimNeverGrantsRelease(x,'BLOCKED');
  }
});
test('incomplete pagination and duplicate job IDs fail closed',()=>{
  let x=fixture();x.jobs.total_count=2;claimNeverGrantsRelease(x,'BLOCKED');
  x=fixture();x.jobs.jobs.push({...x.jobs.jobs[0]});x.jobs.total_count=2;claimNeverGrantsRelease(x,'BLOCKED');
  x=fixture();x.jobs.total_count=201;claimNeverGrantsRelease(x,'BLOCKED');
});
test('fake terminal success with ongoing run or step is rejected',()=>{
  let x=fixture();x.run.status='in_progress';claimNeverGrantsRelease(x,'BLOCKED');
  x=fixture();x.jobs.jobs[0].steps[1].status='in_progress';claimNeverGrantsRelease(x,'BLOCKED');
});
test('incomplete job is an observation, not execution or a release',()=>{
  const x=fixture();x.run.status='in_progress';x.run.conclusion=null;
  x.jobs.jobs[0].status='in_progress';x.jobs.jobs[0].conclusion=null;
  claimNeverGrantsRelease(x,'IN_PROGRESS');
});
test('all housekeeping steps do not establish meaningful execution',()=>{
  const x=fixture();x.jobs.jobs[0].steps[1].name='Post checkout';
  claimNeverGrantsRelease(x,'BLOCKED');
});
test('any skipped, failed, or mixed stepful/zero-step job blocks',()=>{
  for(const conclusion of ['failure','skipped','cancelled']){
    const x=fixture();x.jobs.jobs[0].steps[1].conclusion=conclusion;
    claimNeverGrantsRelease(x,'BLOCKED');
  }
  let x=fixture();x.jobs.jobs.push({...x.jobs.jobs[0],id:78,steps:[],conclusion:'failure'});
  x.jobs.total_count=2;x.run.conclusion='failure';claimNeverGrantsRelease(x,'BLOCKED');
});
test('stepful public actions with null runner ID are not fake nonexecution',()=>{
  const x=fixture();x.jobs.jobs[0].runner_id=null;
  claimNeverGrantsRelease(x,'EXECUTED_RUNNER_UNATTESTED');
  assert.equal(check(x).stepful_job_count,1);
});
test('duplicate step numbers, odd status, and bogus required pins fail',()=>{
  let x=fixture();x.jobs.jobs[0].steps[2].number=1;claimNeverGrantsRelease(x,'BLOCKED');
  x=fixture();x.jobs.jobs[0].steps[1].status='MYSTERY';claimNeverGrantsRelease(x,'BLOCKED');
  x=fixture();x.expected.head_sha='bad';claimNeverGrantsRelease(x,'INVALID_INPUT');
});
test('classifier never has a success exit code from host metadata',()=>{
  for(const result of ['RUNNER_EXECUTION_OBSERVED','NOT_EXECUTED','BLOCKED','IN_PROGRESS','EXECUTED_RUNNER_UNATTESTED','INVALID_INPUT']) {
    assert.notEqual(exitCode({classification:result}),0);
  }
});
