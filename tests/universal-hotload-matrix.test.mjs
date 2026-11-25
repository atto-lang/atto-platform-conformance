import test from 'node:test';
import assert from 'node:assert/strict';
import {UHL1_BACKENDS,UHL1_CASES,pendingUhl1Report,evaluateUhl1Report}
  from '../src/universal-hotload-matrix.mjs';

const SHA='a'.repeat(40),TREE='b'.repeat(40),BINARY='c'.repeat(64);
function syntheticEvidence(backend,scenario,mode='pass_executed'){
  const unsupported=mode==='unsupported_confirmed',hostOnly=mode==='host_only_executed';
  return {source_sha:SHA,source_tree:TREE,compiler_sha256:hostOnly?null:BINARY,
    image_sha256:unsupported||hostOnly?null:BINARY,
    runner:{head_sha:SHA,run_id:11,job_id:22,run_attempt:1,steps_executed:3,backend},
    compiler_executed:!hostOnly,guest_executed:!unsupported&&!hostOnly,
    negative_proof_sha256:BINARY,
    checks:hostOnly?{host_reference_passed:true,no_guest_image_emitted:true}:
      unsupported?{denied_before_publish:true,no_guest_image_emitted:true}:
        Object.fromEntries(UHL1_CASES[scenario].map(key=>[key,true]))};
}
function syntheticGreen(){
  const r=pendingUhl1Report();
  r.records=r.records.map(c=>({...c,status:'pass_executed',
    evidence:syntheticEvidence(c.backend,c.scenario)}));
  return r;
}
function denies(label,mutate){
  test(label,()=>{
    const r=syntheticGreen();mutate(r);
    assert.throws(()=>evaluateUhl1Report(r),/UHL1 evidence rejected/);
  });
}
test('every backend includes eight distinct OTP/ETS/hot-load cases',()=>{
  assert.deepEqual(UHL1_BACKENDS,['java-graal','llvm','wasm','dotnet-nativeaot','cranelift']);
  assert.equal(Object.keys(UHL1_CASES).length,8);
  const r=pendingUhl1Report(),result=evaluateUhl1Report(r);
  assert.equal(r.records.length,40);
  assert.equal(result.pending.length,40);
  assert.equal(result.structurally_passing,0);
  assert.equal(result.authenticated_execution,false);
  assert.equal(result.production_hot_load_certified,false);
});
test('synthetic all-pass records can never attest to guest execution',()=>{
  const result=evaluateUhl1Report(syntheticGreen());
  assert.equal(result.structurally_complete,true);
  assert.equal(result.structurally_passing,40);
  assert.equal(result.authenticated_execution,false);
  assert.equal(result.production_hot_load_certified,false);
});
test('real unsupported category remains a blocked parity slice',()=>{
  const r=pendingUhl1Report(),c=r.records[0];
  c.status='unsupported_confirmed';
  c.evidence=syntheticEvidence(c.backend,c.scenario,c.status);
  const result=evaluateUhl1Report(r);
  assert.equal(result.unsupported.length,1);
  assert.equal(result.structurally_passing,0);
  assert.equal(result.pending.length,39);
  assert.equal(result.production_hot_load_certified,false);
});
test('honestly failing pre-image compilation remains failure, not fabricated image',()=>{
  const r=pendingUhl1Report(),c=r.records[0];
  c.status='fail_executed';
  c.evidence=syntheticEvidence(c.backend,c.scenario);
  c.evidence.image_sha256=null;
  c.evidence.guest_executed=false;
  const result=evaluateUhl1Report(r);
  assert.equal(result.failed.length,1);
  assert.equal(result.structurally_passing,0);
  assert.equal(result.production_hot_load_certified,false);
});
test('stepful host-only reference evidence stays separate from guest parity',()=>{
  const r=pendingUhl1Report(),c=r.records[0];
  c.status='host_only_executed';
  c.evidence=syntheticEvidence(c.backend,c.scenario,c.status);
  const result=evaluateUhl1Report(r);
  assert.deepEqual(result.host_only,[c.backend+'|'+c.scenario]);
  assert.equal(result.structurally_passing,0);
  assert.equal(result.pending.length,39);
  assert.equal(result.authenticated_execution,false);
  assert.equal(result.production_hot_load_certified,false);
});
function hostOnlyMutation(label,mutate){
  test(label,()=>{
    const r=pendingUhl1Report(),c=r.records[0];
    c.status='host_only_executed';
    c.evidence=syntheticEvidence(c.backend,c.scenario,c.status);
    mutate(c.evidence);
    assert.throws(()=>evaluateUhl1Report(r),/UHL1 evidence rejected/);
  });
}
hostOnlyMutation('host-only forged compiler execution rejected',e=>e.compiler_executed=true);
hostOnlyMutation('host-only forged compiler digest rejected',e=>e.compiler_sha256=BINARY);
hostOnlyMutation('host-only forged guest execution rejected',e=>e.guest_executed=true);
hostOnlyMutation('host-only forged image emission rejected',e=>e.image_sha256=BINARY);
hostOnlyMutation('host-only zero steps rejected',e=>e.runner.steps_executed=0);
hostOnlyMutation('host-only missing negative receipt rejected',e=>e.negative_proof_sha256=null);
hostOnlyMutation('host-only failed reference gate rejected',e=>e.checks.host_reference_passed=false);
hostOnlyMutation('host-only fake extra authority rejected',e=>e.checks.production_certified=true);
denies('reject missing backend/scenario row',r=>r.records.pop());
denies('reject duplicate backend/scenario receipt',r=>r.records[7].scenario=r.records[0].scenario);
denies('reject unknown backend',r=>r.records[0].backend='forge');
denies('reject unknown UHL-1 feature',r=>r.records[0].scenario='ets-unfenced');
denies('reject unrecognized status',r=>r.records[0].status='verified');
denies('reject fake proof embedded in not-executed row',r=>{
  r.records[0].status='not_executed';
});
denies('reject zero step job',r=>r.records[0].evidence.runner.steps_executed=0);
denies('reject missing run attempt',r=>r.records[0].evidence.runner.run_attempt=0);
denies('reject CI head mismatch',r=>r.records[0].evidence.runner.head_sha=TREE);
denies('reject different backend runner',r=>r.records[0].evidence.runner.backend='llvm');
denies('reject forged source tree digest',r=>r.records[0].evidence.source_tree='not-a-git-tree');
denies('reject missing compiler binary fingerprint',r=>r.records[0].evidence.compiler_sha256='bad');
denies('reject absent compiled image on claimed positive',r=>r.records[0].evidence.image_sha256=null);
denies('reject absent actual Oreslang compiler',r=>r.records[0].evidence.compiler_executed=false);
denies('reject absent actual guest execution',r=>r.records[0].evidence.guest_executed=false);
denies('reject missing negative mutation receipt',r=>r.records[0].evidence.negative_proof_sha256=null);
denies('reject one failed specific supervisor/ETS witness',r=>r.records[3].evidence.checks.heir_receipt_single_use=false);
denies('reject missing one code-only witness',r=>delete r.records[0].evidence.checks.route_epoch_advanced);
denies('reject invented check key',r=>r.records[0].evidence.checks.production_certified=true);
denies('reject untrusted extra evidence field',r=>r.records[0].evidence.authenticated=true);
denies('reject unsupported claim with a published image',r=>{
  const c=r.records[0];c.status='unsupported_confirmed';
  c.evidence=syntheticEvidence(c.backend,c.scenario,c.status);
  c.evidence.image_sha256=BINARY;
});
denies('reject unsupported claim with no compiler denial',r=>{
  const c=r.records[0];c.status='unsupported_confirmed';
  c.evidence=syntheticEvidence(c.backend,c.scenario,c.status);
  c.evidence.checks.denied_before_publish=false;
});
denies('reject unsupported claim with fake guest execution',r=>{
  const c=r.records[0];c.status='unsupported_confirmed';
  c.evidence=syntheticEvidence(c.backend,c.scenario,c.status);
  c.evidence.guest_executed=true;
});
