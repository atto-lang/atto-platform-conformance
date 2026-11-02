import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyCriticalStage0Receipt} from '../bin/verify-critical-stage0-receipt.mjs';

const plan=JSON.parse(fs.readFileSync(new URL(
  '../evidence/critical-suspends-current-head-preflight-20261102.json',import.meta.url),'utf8'));
const record=(backend, cases, compiler=true, guest=false) => {
  const e=plan.entries.find(x=>x.backend===backend);
  return {
    schema:'oreslang.critical-suspends.stage0-receipt/1',
    backend,source_commit_sha:e.commit,source_tree_sha:e.tree,
    fixture_manifest_blob_sha1:plan.fixture.manifest_blob_sha1,
    run_id:99,job_id:100,run_attempt:1,runner_id:1000,executed_steps:5,
    test_plan_sha256:'1'.repeat(64),
    compiler_invoked:compiler,compiler_sha256:compiler?'2'.repeat(64):null,
    native_guest_executed:guest,self_attested_parity:false,cross_org_source_transfer:false,cases
  };
};
const rejection=code=>({phase:'compile-reject',status:'pass',
  compiler_rejected:true,exit_code:1,signal:null,timed_out:false,
  stderr:code + ': expected negative',diagnostic_code:code,emitted_artifact:false});
const java=()=>record('java-graal',{
  'positive-try-critical-named-mutex.ores':{phase:'guest',status:'pass',
    compiler_accepted:true,native_guest_executed:true,stdout:'31',exit_code:0},
  'negative-queued-critical-unlowered.ores':rejection('E_CRITICAL_UNLOWERED'),
  'negative-try-critical-call-effect.ores':rejection('E_CRITICAL_BODY_EFFECT'),
  'negative-try-critical-shared-gate.ores':rejection('E_CRITICAL_GATE_TYPE')
},true,true);
const wasm=()=>record('wasm',{
  'critical-gate-host-denied':{phase:'host-reject',status:'pass',
    host_test_executed:true,diagnostic_code:'E_CRITICAL_UNLOWERED'},
  'generator-frame-host-denied':{phase:'host-reject',status:'pass',
    host_test_executed:true,diagnostic_code:'E_ASYNC_GENERATOR_UNLOWERED'},
  'suspending-critical-body-host-denied':{phase:'host-reject',status:'pass',
    host_test_executed:true,diagnostic_code:'E_CRITICAL_SUSPENSION'}
},false,false);
test('synthetic complete Java stage is still explicitly UNATTESTED', () => {
  assert.deepEqual(verifyCriticalStage0Receipt(java(),plan),
    {classification:'UNATTESTED_STAGE0_RECORD',backend:'java-graal',
     evidence_class:'GUEST',checked_cases:4});
});
test('synthetic Wasm checks cannot be mistaken for source compiler or guest receipts', () => {
  assert.deepEqual(verifyCriticalStage0Receipt(wasm(),plan),
    {classification:'UNATTESTED_STAGE0_RECORD',backend:'wasm',
     evidence_class:'HOST_ONLY',checked_cases:3});
});
test('zero step, no runner and missing attempt fail closed', () => {
  for (const [field,value] of [['executed_steps',0],['executed_steps',null],
     ['runner_id',0],['run_attempt',0],['job_id',0],['run_id',0]]) {
    const r=java();
    r[field]=value;
    assert.throws(()=>verifyCriticalStage0Receipt(r,plan),/admitted runner/);
  }
});
test('compiler and guest fields cannot be omitted or relabelled', () => {
  for (const [field,value] of [['native_guest_executed',false],
     ['compiler_invoked',false],['compiler_sha256',null]]) {
    const r=java();
    r[field]=value;
    assert.throws(()=>verifyCriticalStage0Receipt(r,plan));
  }
  const r=wasm();
  r.compiler_invoked=true;
  assert.throws(()=>verifyCriticalStage0Receipt(r,plan),/host-only/);
  const other=wasm();
  other.native_guest_executed=true;
  assert.throws(()=>verifyCriticalStage0Receipt(other,plan),/remain separate/);
});
test('Java guest output and diagnostic priority are exact, not substring accepts', () => {
  for (const [field,value] of [['stdout','hello31'],['exit_code',1],
     ['native_guest_executed',false]]) {
    const r=java();
    r.cases['positive-try-critical-named-mutex.ores'][field]=value;
    assert.throws(()=>verifyCriticalStage0Receipt(r,plan),/native guest/);
  }
  const wrong=java();
  wrong.cases['negative-try-critical-call-effect.ores'].diagnostic_code='E_UNKNOWN';
  assert.throws(()=>verifyCriticalStage0Receipt(wrong,plan),/exact first compiler/);
  const artifact=java();
  artifact.cases['negative-queued-critical-unlowered.ores'].emitted_artifact=true;
  assert.throws(()=>verifyCriticalStage0Receipt(artifact,plan),/artifact/);
});
test('compiler crashes, timeout and earlier misleading errors cannot count as rejects', () => {
  const badFirst=java();
  badFirst.cases['negative-queued-critical-unlowered.ores'].stderr =
    'E_UNDECLARED: spurious first diagnostic; E_CRITICAL_UNLOWERED later';
  assert.throws(()=>verifyCriticalStage0Receipt(badFirst,plan),/exact first/);
  const crashed=java();
  crashed.cases['negative-try-critical-call-effect.ores'].signal='SIGSEGV';
  assert.throws(()=>verifyCriticalStage0Receipt(crashed,plan),/non-signal/);
  const timeout=java();
  timeout.cases['negative-try-critical-shared-gate.ores'].timed_out=true;
  assert.throws(()=>verifyCriticalStage0Receipt(timeout,plan),/non-signal/);
  const killed=java();
  killed.cases['negative-try-critical-shared-gate.ores'].exit_code=-9;
  assert.throws(()=>verifyCriticalStage0Receipt(killed,plan),/non-signal/);
});

test('partial stage cannot hide omitted, skipped or extra cases', () => {
  for (const change of ['deleted','skipped','extra']) {
    const r=java();
    if(change==='deleted')delete r.cases['negative-queued-critical-unlowered.ores'];
    else if(change==='skipped')r.cases['negative-queued-critical-unlowered.ores'].status='skip';
    else r.cases.fake={phase:'guest',status:'pass'};
    assert.throws(()=>verifyCriticalStage0Receipt(r,plan));
  }
});
test('wrong source head, tree, fixture manifest and fake cross-org authorization fail closed', () => {
  for (const [field,value] of [['source_commit_sha','a'.repeat(40)],
     ['source_tree_sha','b'.repeat(40)],['fixture_manifest_blob_sha1','f'.repeat(40)],
     ['cross_org_source_transfer',true],['self_attested_parity',true]]) {
    const r=java();
    r[field]=value;
    assert.throws(()=>verifyCriticalStage0Receipt(r,plan));
  }
});
