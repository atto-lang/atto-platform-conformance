import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {readManifest, validateManifest, verifyCandidateReceipt} from '../tools/verify-static-dispatch-aot-v1.mjs';

const copy=v=>structuredClone(v);
const manifest=readManifest();
const hash=v=>createHash('sha256').update(v).digest('hex');
function fakeCandidate() {
  const cases=validateManifest(manifest);
  return {
    schema:'atto.static-dispatch-evidence.v1',
    backend:'llvm',
    sourceHeadSha:'a'.repeat(40),sourceTreeSha:'b'.repeat(40),
    compilerSha256:'c'.repeat(64),toolchain:'clang-19 + rustc (synthetic only)',
    artifactKind:'native-executable',jitRequired:false,runtimeCompilerRequired:false,
    job:{runId:1234,attempt:1,runnerId:222,
      steps:['checkout','compile','link','execute'].map(name=>({name,conclusion:'success'}))},
    results:[...cases.values()].flatMap(c => {
      const bytes=readFileSync(resolve(c.file));
      assert.equal(hash(bytes),c.sha256);
      return (c.expect==='exit42'?['O0','O2']:['NA']).map(optimization=>({
        id:c.id,optimization,sourceSha256:c.sha256,
        compilerExit:c.expect==='exit42'?0:1,
        guestExit:c.expect==='exit42'?42:null,
        artifactSha256:c.expect==='exit42'?'d'.repeat(64):null,
        emittedIr:c.expect==='exit42',
        diagnosticClass:c.expect==='exit42'?null:c.diagnostic,
        callTargets:c.expect==='exit42'?c.targets:[]
      }));
    })
  };
}
function rejected(v,pattern=/DISPATCH_PARITY_REJECT/) {
  assert.throws(()=>verifyCandidateReceipt(v,manifest),pattern);
}
test('six real .atto files and all five target backends are source-only',()=>{
  const m=validateManifest(manifest);
  assert.equal(m.size,6);
  assert.equal(manifest.backends.length,5);
  assert.ok(manifest.backends.every(b=>b.status==='NOT_EXECUTED'));
});
test('synthetic input can pass shape but can NEVER become a verified receipt',()=>{
  const result=verifyCandidateReceipt(fakeCandidate(),manifest);
  assert.equal(result.verified,false);
  assert.match(result.status,/REQUIRES_INDEPENDENT_ATTESTATION/);
});
test('zero-step and unadmitted runners reject',()=>{
  for(const mutate of [
    r=>r.job.steps=[],
    r=>r.job.runnerId=0,
    r=>r.job.attempt=0,
    r=>r.job.steps[1].conclusion='failure'
  ]) {const r=fakeCandidate();mutate(r);rejected(r);}
});
test('reject spoofed AOT, backend and untrusted verification claims',()=>{
  for(const mutate of [
    r=>r.jitRequired=true,
    r=>r.runtimeCompilerRequired=true,
    r=>r.artifactKind='JVM_BYTECODE',
    r=>r.backend='unknown',
    r=>r.verified=true,
    r=>r.compilerSha256='not-a-hash'
  ]) {const r=fakeCandidate();mutate(r);rejected(r);}
});
test('reject omission, duplicate results, inconsistent source and target identities',()=>{
  for(const mutate of [
    r=>r.results.pop(),
    r=>r.results.push(copy(r.results[0])),
    r=>r.results[0].sourceSha256='f'.repeat(64),
    r=>r.results[0].callTargets=['Counter.read'],
    r=>r.results[0].guestExit=0,
    r=>r.results[0].artifactSha256=null,
    r=>r.results[0].emittedIr=false
  ]) {const r=fakeCandidate();mutate(r);rejected(r);}
});
test('negative cases require no IR, no artifact and diagnostic category',()=>{
  for(const mutate of [
    r=>r.results[4].emittedIr=true,
    r=>r.results[4].artifactSha256='d'.repeat(64),
    r=>r.results[4].diagnosticClass='wrong',
    r=>r.results[4].compilerExit=0
  ]) {const r=fakeCandidate();mutate(r);rejected(r);}
});
test('mutation of source-only status, category or fixture path rejects',()=>{
  for(const mutate of [
    m=>m.status='VERIFIED',
    m=>m.backends[0].status='PASSED',
    m=>m.kinds.pop(),
    m=>m.cases[0].file='../private.atto',
    m=>m.pending[0].status='VERIFIED'
  ]) {const m=copy(manifest);mutate(m);assert.throws(()=>validateManifest(m),/DISPATCH_PARITY_REJECT/);}
});
