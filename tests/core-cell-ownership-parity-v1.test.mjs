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
  for(const id of backends) {
    assert.ok(contract.backends[id].source.startsWith('atto-source.'),id);
    assert.ok(contract.backends[id].source.endsWith('/cell.atto'),id);
  }
  for(const id of ['atto','realtime']) {
    assert.equal(contract.backends[id].policy,'SOURCE_AUTHORED_SCAFFOLD_NOT_GUEST_VERIFIED');
    assert.equal(contract.guestEvidence[id],'NOT_EXECUTED');
  }
});
