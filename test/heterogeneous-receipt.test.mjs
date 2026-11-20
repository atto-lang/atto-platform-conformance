import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyHeterogeneousReceipt, loadCanonicalContract } from '../bin/verify-heterogeneous-receipt.mjs';
const hex40 = c => c.repeat(40);
const hex64 = c => c.repeat(64);
const deps = (...names) => names.map(feature => ({ feature, receiptSha256:hex64('d') }));

function receipt(feature = 'data.tensor.dense', stage = 'guest-executed', targetClass = 'cpu', dependencies = []) {
  return {
    schema:'oreslang.heterogeneous-evidence/1', backend:'llvm', feature, stage,
    sourceCommit:hex40('a'), fixtureSha256:hex64('b'),
    evidence:{
      compilerCommit:hex40('c'), compilerBinarySha256:hex64('d'),
      sourceSha256:hex64('e'), artifactSha256:hex64('f'), testLogSha256:hex64('1'),
      executedSteps:4, workflowConclusion:'success',
      compiledOresSource:true, hostStub:false, fixturePassed:true,
      guestExecuted:true, guestExitCode:0, targetClass, dependencies
    }
  };
}
function hardware(r) {
  Object.assign(r.evidence,{targetExecuted:true, physicalHardware:true,
    targetModel:'test-platform rev1', hardwareRunSha256:hex64('2')});
  return r;
}
function timing(r) {
  r.evidence.timing = {deadlineUs:500, worstObservedUs:230, wcetBoundUs:420,
    wcetAnalysisSha256:hex64('3'),schedulabilityAnalysisSha256:hex64('4'),
    interferenceAnalysisSha256:hex64('5')};
  return r;
}
const verify = r => verifyHeterogeneousReceipt(r);
const rejected = (r,pattern) => {
  const result = verify(r);
  assert.equal(result.ok,false,'unexpected acceptance');
  assert.match(result.errors.join('\n'),pattern);
};

test('accepts an executed CPU dense-tensor compiler guest',()=>{
  assert.deepEqual(verify(receipt()),{ok:true,errors:[]});
});
test('accepts GPU physical execution with referenced prerequisites',()=>{
  const r=hardware(receipt('gpu.kernel','physical-hardware','gpu',deps('memory.device_ownership')));
  assert.equal(verify(r).ok,true);
});
test('accepts audited hard realtime certificate structure',()=>{
  const r=timing(hardware(receipt('rt.deadline','deadline-verified','embedded',
    deps('rt.bounded_allocation','rt.temporal_isolation'))));
  assert.equal(verify(r).ok,true);
});
test('rejects host stubs and missing guest execution',()=>{
  const r=receipt();r.evidence.hostStub=true;r.evidence.guestExecuted=false;
  rejected(r,/host stubs/);rejected(r,/guest execution/);
});
test('rejects unsupported stage promotion',()=>{
  rejected(receipt('gpu.kernel','compiler-checked','gpu',deps('memory.device_ownership')),
    /requires at least physical-hardware/);
});
test('rejects simulator promoted to hardware',()=>{
  const r=receipt('gpu.kernel','physical-hardware','gpu',deps('memory.device_ownership'));
  rejected(r,/real target/);
});
test('rejects missing dependencies even when a guest is green',()=>{
  rejected(hardware(receipt('gpu.kernel','physical-hardware','gpu')),/missing dependency/);
});
test('rejects duplicate dependency references',()=>{
  const r=hardware(receipt('gpu.kernel','physical-hardware','gpu',deps('memory.device_ownership','memory.device_ownership')));
  rejected(r,/duplicate dependency/);
});
test('rejects invalid target kind for physical GPU capability',()=>{
  const r=hardware(receipt('gpu.kernel','physical-hardware','cpu',deps('memory.device_ownership')));
  rejected(r,/targetClass not permitted/);
});
test('rejects mismatched compiler provenance',()=>{
  const r=receipt();r.evidence.compilerBinarySha256='not-a-digest';
  rejected(r,/compilerBinarySha256/);
});
test('rejects workflow without executed steps',()=>{
  const r=receipt();r.evidence.executedSteps=0;
  rejected(r,/executedSteps/);
});
test('rejects fixture comparison omitted',()=>{
  const r=receipt();delete r.evidence.fixturePassed;
  rejected(r,/fixture/);
});
test('rejects hard RT claim without WCET evidence',()=>{
  const r=hardware(receipt('rt.deadline','deadline-verified','cpu',
    deps('rt.bounded_allocation','rt.temporal_isolation')));
  rejected(r,/timing object/);
});
test('rejects WCET bound exceeding deadline',()=>{
  const r=timing(hardware(receipt('rt.deadline','deadline-verified','cpu',
    deps('rt.bounded_allocation','rt.temporal_isolation'))));
  r.evidence.timing.wcetBoundUs=600;
  rejected(r,/WCET upper bound/);
});
test('rejects measured deadline overrun even with bounded WCET',()=>{
  const r=timing(hardware(receipt('rt.deadline','deadline-verified','cpu',
    deps('rt.bounded_allocation','rt.temporal_isolation'))));
  r.evidence.timing.worstObservedUs=501;
  rejected(r,/observed execution exceeded/);
});
test('rejects deadline-verified on an unrelated feature',()=>{
  const r=timing(hardware(receipt('data.tensor.dense','deadline-verified','cpu')));
  rejected(r,/reserved for real-time/);
});
test('rejects alternate contract substitution',()=>{
  const c=structuredClone(loadCanonicalContract());
  c.stages=['compiler-checked'];
  const r=verifyHeterogeneousReceipt(receipt(),c);
  assert.equal(r.ok,false);
  assert.match(r.errors.join(' '),/contract/);
});
test('rejects malformed receipt and unsupported backend',()=>{
  rejected(null,/receipt must be an object/);
  const r=receipt();r.backend='fictional';
  rejected(r,/unknown backend/);
});
test('canonical contract contains no cyclic dependencies',()=>{
  const c=loadCanonicalContract();
  function visit(name,path) {
    assert.ok(c.features[name],`unknown feature ${name}`);
    assert.ok(!path.has(name),`cycle through ${name}`);
    for(const next of c.features[name].requires) visit(next,new Set([...path,name]));
  }
  Object.keys(c.features).forEach(name=>visit(name,new Set()));
});
