import test from 'node:test';
import assert from 'node:assert/strict';
import {auditActorExecutionJob} from '../bin/actor-execution-run-gate.mjs';

const head = 'a'.repeat(40);
const base = () => ({
  backend:'java-graalvm', expectedHead:head,
  run:{id:123,head_sha:head,status:'completed',conclusion:'success'},
  job:{id:456,run_id:123,status:'completed',conclusion:'success',runner_id:789,
    runner_name:'GitHub Actions 7',steps:[
      {number:1,name:'checkout exact head',status:'completed',conclusion:'success'},
      {number:2,name:'test actor guest fixture',status:'completed',conclusion:'success'},
    ]},
});
const status = x => auditActorExecutionJob(x).stage;
test('admitted job is still only a candidate, never an actor parity claim',()=>{
  const audit = auditActorExecutionJob(base());
  assert.deepEqual(audit,{stage:'candidate-only',blockers:[],backend:'java-graalvm',head});
});
test('zero-step failures are infrastructure, not compiler evidence',()=>{
  const x=base();x.run.conclusion='failure';x.job.conclusion='failure';x.job.runner_id=null;
  x.job.runner_name=null;x.job.steps=[];
  const audit=auditActorExecutionJob(x);
  assert.equal(audit.stage,'infrastructure-blocked');
  assert.ok(audit.blockers.some(s=>s.includes('no job steps')));
});
test('HEAD and run/job identity cannot be spoofed by unrelated green job',()=>{
  for(const mutate of [x=>x.run.head_sha='b'.repeat(40),x=>x.job.run_id=999,
    x=>x.run.id=null,x=>x.job.id=0]){
    const x=base();mutate(x);assert.equal(status(x),'execution-incomplete');
  }
});
test('execution metadata cannot be treated as passing when incomplete',()=>{
  for(const mutate of [x=>x.job.steps[1].conclusion='skipped',
    x=>x.job.steps[1].status='in_progress',x=>x.job.steps[1].number=1,
    x=>x.job.steps[1].name='unrelated step']){
    const x=base();mutate(x);assert.equal(status(x),'execution-incomplete');
  }
});
test('no external runner, no valid job snapshot and job failures deny',()=>{
  for(const mutate of [x=>x.job.runner_name='',x=>x.job.runner_id=0,
    x=>x.run.status='queued',x=>x.job.conclusion='cancelled']){
    const x=base();mutate(x);
    assert.equal(status(x),
      x.job.runner_name === '' || x.job.runner_id === 0
        ? 'infrastructure-blocked' : 'execution-incomplete');
  }
  const x=base();x.job=null;
  assert.equal(status(x),'infrastructure-blocked');
});
test('unknown backends and non-SHA expectations cannot be audited',()=>{
  for(const mutate of [x=>x.backend='java',x=>x.expectedHead='short',
    x=>x.expectedHead='B'.repeat(40)]){
    const x=base();mutate(x);assert.throws(()=>auditActorExecutionJob(x),TypeError);
  }
});
test('all six backends share the same admission triage',()=>{
  for(const backend of ['java-graalvm','llvm-native','wasm','forge','net-native-aot','cranelift-native']){
    const x=base();x.backend=backend;
    assert.equal(status(x),'candidate-only',backend);
  }
});

test('failed compiler test with executed steps must not look like runner admission failure',()=>{
  const x=base();
  x.run.conclusion='failure';x.job.conclusion='failure';x.job.steps[1].conclusion='failure';
  const audit=auditActorExecutionJob(x);
  assert.equal(audit.stage,'execution-incomplete');
  assert.ok(audit.blockers.some(s=>s.includes('did not succeed')));
  assert.ok(audit.blockers.some(s=>s.includes('skipped, failed or incomplete')));
});
