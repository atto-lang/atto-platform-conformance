import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => JSON.parse(fs.readFileSync(
  new URL('../evidence/' + name,import.meta.url),'utf8'));
const r=read('critical-runner-admission-three-private-repos-20261102.json');
const previous=read('critical-runner-admission-ab-attempt2-20261102.json');
const sha=/^[0-9a-f]{40}$/;
function verify(input) {
  assert.equal(input.schema,'atto.critical-runner-admission-three-private-repository-comparison/1');
  assert.equal(input.jobs_definition_identical,true);
  assert.equal(input.runner_label,'ubuntu-24.04');
  assert.equal(input.conclusion,'REPEATED_SOURCE_ORGANIZATION_RUNNER_ADMISSION_DIVERGENCE_ONLY');
  assert.deepEqual(Object.keys(input.sources),['alternate','conformance','java']);
  for(const [side,org,attemptCount,steps,outcome] of [
    ['alternate','gha-indie-worker',2,4,'success'],
    ['conformance','ores-truffle-oreslang',2,0,'failure'],
    ['java','ores-truffle-oreslang',1,0,'failure']
  ]) {
    const item=input.sources[side];
    assert.ok(item.repository.startsWith(org+'/'));
    assert.equal(item.private,true);
    assert.ok(Number.isSafeInteger(item.repo_id) && item.repo_id>0);
    assert.match(item.commit,sha);
    assert.match(item.tree,sha);
    assert.match(item.workflow_blob,sha);
    assert.ok(Number.isSafeInteger(item.run_id) && item.run_id>0);
    assert.equal(item.attempts.length,attemptCount);
    for(let i=0;i<attemptCount;i++) {
      const a=item.attempts[i];
      assert.equal(a.attempt,i+1);
      assert.ok(Number.isSafeInteger(a.job_id) && a.job_id>0);
      assert.equal(a.steps,steps);
      assert.equal(a.conclusion,outcome);
      assert.ok(input.sources[side].attempts.slice(0,i).every(x=>x.job_id!==a.job_id));
    }
    if(side==='conformance'||side==='alternate') {
      const old=previous[side==='conformance'?'source':'alternate'];
      assert.equal(item.commit,old.head);
      assert.equal(item.tree,old.tree);
      assert.equal(item.run_id,old.run_id);
      assert.deepEqual(item.attempts.map(x=>x.job_id),old.attempts.map(x=>x.job_id));
    }
  }
  assert.notEqual(input.sources.alternate.repo_id,input.sources.java.repo_id);
  assert.notEqual(input.sources.conformance.repo_id,input.sources.java.repo_id);
  assert.equal(input.private_source_mirrored,false);
  assert.equal(input.security.private_mirror_authorized,false);
  assert.equal(input.security.source_main_protected,false);
  assert.deepEqual(input.security.incidents_open,[22,77,127]);
  assert.equal(input.native_compiler_tests_executed,false);
  assert.equal(input.native_guest_tests_executed,false);
  assert.deepEqual(input.unknowns,[
    'source organization billing minute balance',
    'underlying runner admission failure reason',
    'alternate org remaining billing balance'
  ]);
  return 'SOURCE_FREE_ONLY';
}
test('two private repos in source org fail while alternate runs exact same source-free job',()=>{
  assert.equal(verify(r),'SOURCE_FREE_ONLY');
});
test('cannot promote failed Java canary to executed or forge original run identity',()=>{
  for(const mutate of [
    x=>{x.sources.java.attempts[0].steps=4},
    x=>{x.sources.java.attempts[0].conclusion='success'},
    x=>{x.sources.java.commit='f'.repeat(39)},
    x=>{x.sources.conformance.run_id=1},
    x=>{x.sources.alternate.attempts[1].job_id=0}
  ]) {
    const x=structuredClone(r);mutate(x);
    assert.throws(()=>verify(x));
  }
});
test('capacity canary cannot grant private-source export or native compiler claims',()=>{
  for(const mutate of [
    x=>{x.private_source_mirrored=true},
    x=>{x.security.private_mirror_authorized=true},
    x=>{x.security.incidents_open=[]},
    x=>{x.native_compiler_tests_executed=true},
    x=>{x.native_guest_tests_executed=true},
    x=>{x.unknowns=[]}
  ]) {
    const x=structuredClone(r);mutate(x);
    assert.throws(()=>verify(x));
  }
});
