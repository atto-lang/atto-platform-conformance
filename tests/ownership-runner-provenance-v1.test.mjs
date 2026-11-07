import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectExactHeadRunner,githubReadOnlyReader} from '../src/ownership-runner-provenance-v1.mjs';

const sha='a'.repeat(40),tree='b'.repeat(40);
const repository='ores-truffle-oreslang/oreslang-source.llvm',runId=31,jobId=41;
const requiredSteps=['Checkout exact head','Run ownership compiler fixtures'];
const prefix='/repos/'+repository;

function specimen() {
  const commit={sha,tree:{sha:tree}};
  const run={id:runId,run_attempt:2,head_sha:sha,status:'completed',
    conclusion:'success',repository:{full_name:repository}};
  const jobs={total_count:1,jobs:[{
    id:jobId,run_id:runId,run_attempt:2,runner_id:77,head_sha:sha,
    status:'completed',conclusion:'success',started_at:'2026-11-06T18:00:00Z',
    steps:requiredSteps.map((name,i)=>({name,number:i+1,status:'completed',
      conclusion:'success',started_at:'2026-11-06T18:01:00Z'}))
  }]};
  return {commit,run,jobs};
}
async function evaluate(stuff=specimen(),overrides={}) {
  const urls={
    [prefix+'/git/commits/'+sha]:stuff.commit,
    [prefix+'/actions/runs/'+runId+'/attempts/2']:stuff.run,
    [prefix+'/actions/runs/'+runId+'/attempts/2/jobs?per_page=100']:stuff.jobs
  };
  return inspectExactHeadRunner({
    repository,expectedHead:sha,runId,attempt:2,jobId,requiredSteps,
    read:async url=>{
      if(!(url in urls))throw Error('MISSING_TRUSTED_ENDPOINT');
      return urls[url];
    },...overrides
  });
}
async function denied(mutate,expected) {
  const x=specimen();mutate(x);
  const r=await evaluate(x);
  assert.equal(r.ok,false);assert.equal(r.verified,false);
  assert.equal(r.runnerExecutionVerified,false);
  assert.equal(r.guestExecutionVerified,false);
  assert.equal(r.status,'RUNNER_PROVENANCE_UNVERIFIED');
  assert.ok(r.errors.includes(expected),'expected '+expected+' got '+r.errors);
}
test('fresh GitHub attempt and Git commit establish runner only, never guest',async()=>{
  const r=await evaluate();
  assert.equal(r.ok,false);assert.equal(r.verified,false);
  assert.equal(r.runnerExecutionVerified,true);
  assert.equal(r.sourceCommitTreeResolved,true);
  assert.equal(r.checkoutVerified,false, 'green step names do not prove checkout tree identity');
  assert.equal(r.guestExecutionVerified,false);
  assert.equal(r.status,'RUNNER_EXECUTION_VERIFIED_GUEST_UNVERIFIED');
  assert.equal(r.sourceCommit,sha);assert.equal(r.sourceTree,tree);
  assert.equal(r.executedSteps,2);
});
test('Git commit and source tree must match immutable expected head',async()=>{
  await denied(x=>{x.commit.sha='c'.repeat(40)},'SOURCE_COMMIT_OR_TREE_UNVERIFIED');
  await denied(x=>{x.commit.tree.sha='broken'},'SOURCE_COMMIT_OR_TREE_UNVERIFIED');
});
test('synthetic merge SHA or mismatched repo/attempt can never pass',async()=>{
  await denied(x=>{x.run.head_sha='d'.repeat(40)},'RUN_ATTEMPT_HEAD_MISMATCH');
  await denied(x=>{x.run.run_attempt=3},'RUN_ATTEMPT_HEAD_MISMATCH');
  await denied(x=>{x.run.repository.full_name='foreign/repo'},'RUN_REPOSITORY_MISMATCH');
  await denied(x=>{x.jobs.jobs[0].head_sha='e'.repeat(40)},'JOB_HEAD_MISMATCH');
});
test('failed and unfinished workflow attempts are rejected',async()=>{
  await denied(x=>{x.run.conclusion='failure'},'RUN_NOT_SUCCESSFULLY_COMPLETED');
  await denied(x=>{x.run.status='queued'},'RUN_NOT_SUCCESSFULLY_COMPLETED');
});
test('incomplete job inventory or jobs from wrong attempts fail closed',async()=>{
  await denied(x=>{x.jobs.total_count=101},'INCOMPLETE_ATTEMPT_JOB_LIST');
  await denied(x=>{x.jobs.total_count=2},'INCOMPLETE_ATTEMPT_JOB_LIST');
  await denied(x=>{x.jobs.jobs[0].run_attempt=1},'JOB_NOT_IN_EXACT_ATTEMPT');
  await denied(x=>{x.jobs.jobs[0].id=42},'JOB_NOT_IN_EXACT_ATTEMPT');
});
test('zero-step, no-runner or failed jobs are not compilation evidence',async()=>{
  await denied(x=>{x.jobs.jobs[0].steps=[]},'ZERO_EXECUTED_STEPS');
  await denied(x=>{x.jobs.jobs[0].runner_id=0},'NO_ASSIGNED_RUNNER');
  await denied(x=>{x.jobs.jobs[0].runner_id=null},'NO_ASSIGNED_RUNNER');
  await denied(x=>{x.jobs.jobs[0].conclusion='failure'},'JOB_NOT_EXECUTED_SUCCESSFULLY');
});
test('each exact named compiler step must be non-skipped and executed',async()=>{
  await denied(x=>{x.jobs.jobs[0].steps[1].conclusion='skipped'},
    'MISSING_OR_UNEXECUTED_REQUIRED_STEP:Run ownership compiler fixtures');
  await denied(x=>{x.jobs.jobs[0].steps.pop()},
    'MISSING_OR_UNEXECUTED_REQUIRED_STEP:Run ownership compiler fixtures');
  await denied(x=>{x.jobs.jobs[0].steps[1].status='queued'},
    'MISSING_OR_UNEXECUTED_REQUIRED_STEP:Run ownership compiler fixtures');
  await denied(x=>{x.jobs.jobs[0].steps[1].started_at=null},
    'MISSING_OR_UNEXECUTED_REQUIRED_STEP:Run ownership compiler fixtures');
});
test('ambiguous step identities and invalid trust inputs fail closed',async()=>{
  await denied(x=>{x.jobs.jobs[0].steps[1].name=x.jobs.jobs[0].steps[0].name},
    'DUPLICATE_OR_INVALID_STEP_NAME');
  for(const overrides of [
    {expectedHead:'bad'}, {repository:'../foreign/repo'}, {jobId:0},
    {requiredSteps:[]}, {requiredSteps:['same','same']}, {read:null}
  ]){
    const r=await evaluate(specimen(),overrides);
    assert.equal(r.runnerExecutionVerified,false);
    assert.equal(r.ok,false);
  }
});
test('REST client is GET-only with no redirect and scoped token',async()=>{
  let observed;
  const reader=githubReadOnlyReader('testing-read-token',async(url,options)=>{
    observed={url,options};
    return {ok:true,json:async()=>({id:1})};
  });
  assert.deepEqual(await reader(prefix+'/git/commits/'+sha),{id:1});
  assert.equal(observed.url,'https://api.github.com'+prefix+'/git/commits/'+sha);
  assert.equal(observed.options.method,'GET');
  assert.equal(observed.options.redirect,'error');
  assert.equal(observed.options.headers.authorization,'Bearer testing-read-token');
  await assert.rejects(()=>reader('/../invalid'));
  await assert.rejects(()=>reader('/some-other-root'));
});
test('REST 403/404 or network failure cannot fabricate executed evidence',async()=>{
  const reader=githubReadOnlyReader('testing-read-token',async()=>({
    ok:false,json:async()=>({message:'not found'})
  }));
  await assert.rejects(()=>reader(prefix+'/git/commits/'+sha));
  const r=await evaluate(specimen(),{read:async()=>{throw Error('API_UNREACHABLE')}});
  assert.equal(r.runnerExecutionVerified,false);
  assert.equal(r.ok,false);
});
