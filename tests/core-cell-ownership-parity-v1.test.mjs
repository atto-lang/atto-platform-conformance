// Source-only contract integrity: NOT a compiler execution or guest witness.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const contract=JSON.parse(readFileSync(
  new URL('../contracts/borrow-mir-v1/core-cell-ownership-parity-v1.json',import.meta.url),'utf8'));
const backends=['java','llvm','net','cranelift','wasm','forge','js','rs','hdl','atto','realtime'];

test('all 11 backend profiles are accounted for but not certified',()=>{
  assert.equal(contract.schema,'attolang.core.cell-ownership-parity.v1');
  assert.equal(contract.status,'TARGET_NOT_EXECUTED');
  assert.deepEqual(Object.keys(contract.backends).sort(),[...backends].sort());
  assert.deepEqual(Object.keys(contract.guestEvidence).sort(),[...backends].sort());
  assert.ok(Object.values(contract.guestEvidence).every(s=>s==='NOT_EXECUTED'));
  assert.ok(Object.values(contract.backends).every(x=>
    x.policy==='SOURCE_AUTHORED_NOT_GUEST_VERIFIED'||
    x.policy==='SOURCE_AUTHORED_SCAFFOLD_NOT_GUEST_VERIFIED'));
  assert.equal(Object.values(contract.backends).filter(x=>typeof x.source==='string').length,11);
  assert.match(contract.sourceCoverage,/11\/11 compiler-owned source candidates/);
  assert.match(contract.compilerBorrowCoverage,/UNVERIFIED across 11 profiles/);
  assert.match(contract.sourcePolicy,/never references, tokens/);
});

test('core Cell policy preserves borrowed read and forbids owner move/write/suspend',()=>{
  const byId=new Map(contract.caseClasses.map(x=>[x.id,x]));
  assert.equal(byId.size,contract.caseClasses.length);
  for (const id of [
    'idle','one_shared_reader','max_shared_reader','exclusive_writer',
    'invalid_negative_readers','invalid_conflicting_writer_and_readers'
  ]) assert.ok(byId.has(id),id);
  assert.deepEqual(
    ['read','write','move','unpinnedSuspend'].map(k=>byId.get('idle')[k]),
    [true,true,true,true]);
  for(const id of [
    'one_shared_reader','max_shared_reader','exclusive_writer',
    'invalid_negative_readers','invalid_conflicting_writer_and_readers'
  ]) for(const right of ['write','move','unpinnedSuspend'])
    assert.equal(byId.get(id)[right],false,id+': '+right);
  assert.equal(byId.get('one_shared_reader').read,true);
  assert.equal(byId.get('exclusive_writer').read,false);
});

test('compiler-negative conformance requires real diagnostics and zero emitted artifacts',()=>{
  const wanted=[
    'use_after_take','escaping_local_borrow','conflicting_shared_mutable_loans',
    'suspend_with_unpinned_loan','foreign_actor_mutation','stale_owner_generation'
  ];
  assert.deepEqual(contract.compilerNegativeCases.map(c=>c.id),wanted);
  for(const c of contract.compilerNegativeCases){
    assert.match(c.diagnostic,/^E_[A-Z_]+$/);
    assert.equal(c.requireZeroArtifacts,true);
  }
  assert.match(contract.evidenceRequirement,/compiler-produced typed MIR/);
  assert.match(contract.evidenceRequirement,/material runner steps/);
  assert.match(contract.evidenceRequirement,/Source-only receipts always NOT_EXECUTED/);
});

test('backend source layouts are allowed to differ without omitting ownership requirements',()=>{
  assert.equal(contract.backends.java.representation,'signed-counter-i64');
  assert.equal(contract.backends.llvm.representation,'signed-counter-i64');
  assert.equal(contract.backends.net.representation,'bounded-readers-plus-writer');
  assert.equal(contract.backends.cranelift.representation,'bounded-readers-plus-writer');
  const seenBlobs=new Set();
  for(const id of backends) {
    assert.ok(contract.backends[id].source.startsWith('atto-source.'),id);
    assert.ok(contract.backends[id].source.endsWith('/cell.atto'),id);
    const sha=contract.backends[id].sourceBlobSha;
    assert.match(sha,/^[a-f0-9]{40}$/,id+' exact Git blob');
    assert.ok(!seenBlobs.has(sha),id+' compiler-owned independent source');
    seenBlobs.add(sha);
  }
  assert.match(contract.blobPinPolicy,/matching blob does NOT grant compiler guest PASS/);
  for(const id of ['atto','realtime']) {
    assert.equal(contract.backends[id].policy,'SOURCE_AUTHORED_SCAFFOLD_NOT_GUEST_VERIFIED');
    assert.equal(contract.guestEvidence[id],'NOT_EXECUTED');
  }
});

test('shared borrow saturation is a denied new loan, not loss of existing owner read',()=>{
  const bound=contract.borrowAdmissionSaturation;
  assert.equal(bound.sourcePolicyOnly,true);
  assert.equal(bound.compilerGuestEvidence,'NOT_EXECUTED');
  for(const [kind,profile] of Object.entries(bound.representations)){
    const max=BigInt(profile.maxReaders);
    const valid=readers=>readers>=0n && readers<=max;
    const canAcquire=(readers,writer)=>readers>=0n&&readers<max&&!writer;
    const canOwnerRead=(readers,writer)=>valid(readers)&&!writer;
    for(const n of [-1n,0n,1n,max-1n,max,max+1n]){
      assert.equal(canAcquire(n,false),n>=0n&&n<max,kind+' '+n);
      assert.equal(canOwnerRead(n,false),valid(n),kind+' '+n);
      assert.equal(canAcquire(n,true),false,kind+' writer '+n);
    }
    assert.equal(profile.mayAcquireSharedAtMax,false,kind);
    assert.equal(profile.ownerMayReadAtMax,true,kind);
    assert.equal(canAcquire(max,false),false,kind);
    assert.equal(canOwnerRead(max,false),true,kind);
    assert.equal(BigInt(profile.releaseAtMax),max-1n,kind);
    assert.equal(profile.acquireAtMax,kind==='signed-counter-i64'?'ERR':-1,kind);
  }
  assert.deepEqual(bound.negativeBoundaries,[
    'negative_readers','reader_overflow','writer_active',
    'attempt_to_write_with_shared_readers','owner_move_with_live_loan',
    'unpinned_suspend_with_live_loan'
  ]);
});

test('nine independently owned bounded core/cell sources have updated exact blob pins',()=>{
  const pins={
    net:'154563e51199140cfad005945c608789bee5ebfa',
    cranelift:'178dc049f6f19c8af29f96e42661b970e746d671',
    wasm:'1561f8e71fc831d5787b8652a108d0fb87714503',
    forge:'7a0b117c5a6775921e541dfa5aaf654ba2aea7f4',
    js:'ae54f28baee13675a71088251b41dd8182f60084',
    rs:'7eb09f625637dd11d75aa295947a9c79835cb5df',
    hdl:'38439b2b0b487b4bb09d191ba50c115611295206',
    atto:'55a0a3c5a04b825fb597a9c66101ee44d2e584ed',
    realtime:'30ef700dc973f1af6bda588aa46ae5cdc7ae745b'
  };
  for(const [name,sha] of Object.entries(pins)){
    assert.equal(contract.backends[name].sourceBlobSha,sha,name);
    assert.equal(contract.backends[name].representation,'bounded-readers-plus-writer',name);
    assert.equal(contract.guestEvidence[name],'NOT_EXECUTED',name);
  }
  assert.equal(contract.backends.java.representation,'signed-counter-i64');
  assert.equal(contract.backends.llvm.representation,'signed-counter-i64');
  assert.equal(contract.guestEvidence.java,'NOT_EXECUTED');
  assert.equal(contract.guestEvidence.llvm,'NOT_EXECUTED');
  // Source pins cannot be promoted to a compiler-generated loan proof.
  assert.match(contract.borrowAdmissionSaturation.reviewerRequirement,/typed MIR/);
});


test('compiled ownership admissions never inherit PASS from core source predicates',()=>{
  assert.deepEqual(Object.keys(contract.compilerAdmissionTargets).sort(),[...backends].sort());
  for(const [backend,target] of Object.entries(contract.compilerAdmissionTargets)){
    assert.equal(target.status,'NOT_EXECUTED',backend);
    assert.ok(typeof target.profile==='string'&&target.profile.length>0);
    assert.ok(typeof target.evidence==='string'&&target.evidence.length>0);
    assert.ok(Array.isArray(target.negative));
    assert.notEqual(target.status,'PASS');
  }
  for(const name of ['java','llvm'])
    assert.ok(contract.compilerAdmissionTargets[name].negative.includes('conflicting_shared_mutable_loans'));
  assert.ok(contract.compilerAdmissionTargets.java.negative.includes('suspend_with_unpinned_loan'));
  for(const name of ['net','wasm'])
    assert.ok(contract.compilerAdmissionTargets[name].negative.includes('canonical_ownership_bang_unsupported'));
  assert.match(contract.compilerAdmissionRule,/NOT a positive borrowed-memory execution proof/);
  assert.match(contract.compilerAdmissionRule,/full typed borrow-MIR parity/);
});

test('candidate source receipts identify nonzero commit and tree per backend, never guest proof',()=>{
  const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x)&&!/^0+$/.test(x);
  for(const name of backends){
    const ref=contract.backends[name];
    assert.ok(sha(ref.candidateCommitSha),name+' commit');
    assert.ok(sha(ref.candidateTreeSha),name+' tree');
    assert.notEqual(ref.candidateCommitSha,ref.candidateTreeSha,name);
    assert.equal(contract.guestEvidence[name],'NOT_EXECUTED',name);
  }
  assert.match(contract.exactRefEvidence,/source-only snapshot/);
});

test('alternate runner evidence is source-free and cleanup restores known tree',()=>{
  const r=contract.sourceFreeReferenceEvidence;
  assert.equal(r.carrier,'channelsiege/atto-ci');
  assert.equal(r.runId,45059593908);
  assert.equal(r.workflowConclusion,'success');
  assert.equal(r.classification,'SOURCE_FREE_MODEL_ONLY');
  assert.equal(r.compilerSourceTransferred,false);
  assert.equal(r.typedMirGuestQualified,false);
  assert.match(r.cleanupCommit,/^[0-9a-f]{40}$/);
  assert.equal(r.cleanupTree,'b78051568a02496c9f55790d83a87a158c16ee88');
  assert.ok(Object.values(contract.guestEvidence).every(x=>x==='NOT_EXECUTED'));
});

test('Rust Java LLVM compiler integration candidates pin exact source, tree and gate blobs',()=>{
  const candidates=contract.compilerIntegrationCandidates;
  assert.deepEqual(Object.keys(candidates).sort(),['java','llvm','rust']);
  for (const [id,entry] of Object.entries(candidates)) {
    assert.equal(entry.repository,'atto-lang/atto-source.'+(id==='rust'?'rs':id));
    assert.match(entry.sourceCommit,/^[0-9a-f]{40}$/);
    assert.match(entry.sourceTree,/^[0-9a-f]{40}$/);
    assert.notEqual(entry.sourceCommit,entry.sourceTree);
    assert.ok(Object.keys(entry.sourceBlobs).length>=1);
    for (const [path,sha] of Object.entries(entry.sourceBlobs)) {
      assert.ok(path.length>3);
      assert.match(sha,/^[0-9a-f]{40}$/,path);
    }
    assert.equal(entry.compilation,'NOT_EXECUTED');
    assert.equal(entry.guest,'NOT_EXECUTED');
    assert.equal(contract.guestEvidence[id==='rust'?'rs':id],'NOT_EXECUTED');
  }
  assert.match(candidates.rust.check,/E_UNKNOWN_TYPE/);
  assert.match(candidates.rust.check,/borrow-v1/);
  assert.match(candidates.java.check,/validate and real guest launch/);
  assert.match(candidates.llvm.check,/IR=NONE/);
  assert.match(contract.compilerIntegrationEvidenceRule,/NOT real guest/);
});

test('source-only candidate receipts never override 11 compiler parity receipts',()=>{
  assert.equal(Object.keys(contract.guestEvidence).length,11);
  assert.ok(Object.values(contract.guestEvidence).every(x=>x==='NOT_EXECUTED'));
  for(const entry of Object.values(contract.compilerIntegrationCandidates))
    assert.notEqual(entry.guest,'PASSED');
  assert.match(contract.compilerIntegrationEvidenceRule,/opt-in/);
});
