import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCandidateIdentityInventory } from
  '../src/ownership-identity-inventory-v1.mjs';

const slot=(bindingId,originId=0,mode='owned',moved=false,root='owner')=>({
  moved,place:{bindingId,originId,root,mode,fields:[]}
});
const accept=(entries)=>{
  const r=inspectCandidateIdentityInventory(entries);
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
  assert.equal(r.independentStorageVerified,false);
  assert.equal(r.candidateValid,true,JSON.stringify(r.errors));
};
const reject=(entries,diagnostic)=>{
  const r=inspectCandidateIdentityInventory(entries);
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
  assert.equal(r.candidateValid,false);
  assert.ok(r.errors.includes(diagnostic),JSON.stringify(r.errors));
};

// Bindings: five independent source-identity cases.
test('01 empty candidate inventory is not a compiler authorization',()=>accept([]));
test('02 one minted binding remains candidate',()=>accept([slot(1)]));
test('03 distinct BindingIds are allowed, but not proven disjoint',
  ()=>accept([slot(1),slot(2,0,'owned',false,'second')]));
test('04 duplicate BindingId with different names rejected',
  ()=>reject([slot(1),slot(1,0,'shared-loan',false,'alias')],'DUPLICATE_BINDING_ID'));
test('05 unminted BindingId rejected',
  ()=>reject([slot(0)],'INVALID_COMPILER_PLACE'));

// Allocation origin: moved historical places are not live owners.
test('06 two distinct known origins are candidate-only',
  ()=>accept([slot(1,10),slot(2,11,'owned',false,'second')]));
test('07 two simultaneous owned slots with same origin rejected',
  ()=>reject([slot(1,10),slot(2,10,'owned',false,'second')],
    'DUPLICATE_LIVE_ALLOCATION_ORIGIN'));
test('08 move permits old moved slot and current owner of same origin',
  ()=>accept([slot(1,10,'owned',true),slot(2,10,'owned',false,'new')]));
test('09 borrowed view may refer to an owned origin without upgrading',
  ()=>accept([slot(1,10),slot(2,10,'shared-loan',false,'loan')]));
test('10 two unknown origin zero owners never prove storage separation',
  ()=>accept([slot(1,0),slot(2,0,'owned',false,'second')]));

// Adversarial CFG/report data: forged metadata cannot be promoted.
test('11 invalid moved status rejected',
  ()=>reject([{...slot(1),moved:'false'}],'INVALID_INVENTORY_ENTRY'));
test('12 forged authorization field rejected',
  ()=>reject([{...slot(1),verified:true}],'INVALID_INVENTORY_ENTRY'));
test('13 inherited owner key cannot impersonate compiler place',
  ()=>reject([{moved:false,place:{...slot(1).place,root:'__proto__'}}],
    'INVALID_COMPILER_PLACE'));
test('14 wrong positive origin data rejected',
  ()=>reject([{moved:false,place:{...slot(1).place,originId:-1}}],
    'INVALID_COMPILER_PLACE'));
test('15 a claimed exclusive loan is not a second owned allocation',
  ()=>accept([slot(1,10),slot(2,10,'exclusive-loan',false,'loan')]));
