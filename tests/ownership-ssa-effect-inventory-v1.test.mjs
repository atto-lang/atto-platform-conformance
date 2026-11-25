import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCandidateSsaOwnershipCoverage as inspect}
  from '../src/ownership-ssa-effect-inventory-v1.mjs';

const borrow=(token=11,place='x',kind='borrow-shared')=>({kind,place,token});
const use=(token=11,place='x',kind='use-shared')=>({kind,place,token});
const effect=(kind,place='x')=>({kind,place,token:null});
const indexed=(site=1,token=11,place='x',kind='use-shared')=>({site,kind,place,token});
const write=(writeId=41,place='p.field',site=1)=>({writeId,place,site});
const base=()=>({operations:[borrow(),use()],indexedUses:[indexed()]});
const candidate=(data)=>{
  const r=inspect(data);
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
  assert.equal(r.guestExecutionVerified,false);
  assert.equal(r.emittedStoreVerified,false);
  assert.equal(r.candidateResolved,true,JSON.stringify(r.errors));
  assert.equal(r.status,'SSA_EFFECT_AND_STORE_INVENTORY_UNAUTHENTICATED');
  return r;
};
const denied=(data,code)=>{
  const r=inspect(data);
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
  assert.equal(r.candidateResolved,false);
  assert.ok(r.errors.some(x=>x.startsWith(code)),JSON.stringify(r.errors));
};
test('01 matching typed-use index is candidate only',()=>{
  assert.equal(candidate(base()).indexedUseCount,1);
});
test('02 complete two-use index preserves last-use candidate',()=>{
  const data={operations:[borrow(),use(),use()],indexedUses:[indexed(),indexed(2)]};
  assert.equal(candidate(data).indexedUseCount,2);
});
test('03 missing SSA use-def edge denies early release',()=>{
  denied({operations:[borrow(),use(),use()],indexedUses:[indexed()]},
    'MISSING_SSA_USE_DEF_EDGE');
});
test('04 duplicate indexed use cannot forge completeness',()=>{
  denied({...base(),indexedUses:[indexed(),indexed()]},'DUPLICATE_SSA_USE_SITE');
});
test('05 foreign use site cannot forge completeness',()=>{
  denied({...base(),indexedUses:[indexed(4)]},'SSA_INDEX_DOES_NOT_MATCH_SOURCE_USE');
});
test('06 wrong loan token in SSA use index is rejected',()=>{
  denied({...base(),indexedUses:[indexed(1,99)]},'SSA_INDEX_DOES_NOT_MATCH_SOURCE_USE');
});
test('07 wrong place in SSA use index is rejected',()=>{
  denied({...base(),indexedUses:[indexed(1,11,'y')]},'SSA_INDEX_DOES_NOT_MATCH_SOURCE_USE');
});
test('08 wrong borrow mode in SSA use index is rejected',()=>{
  denied({...base(),indexedUses:[indexed(1,11,'x','use-exclusive')]},
    'SSA_INDEX_DOES_NOT_MATCH_SOURCE_USE');
});
test('09 unknown source operation is never considered a verified use',()=>{
  denied({...base(),operations:[borrow(),effect('magic'),use()],
    indexedUses:[indexed(2)]},'UNKNOWN_SOURCE_EFFECT');
});
test('10 call argument creates an unproven SSA effect edge',()=>{
  denied({...base(),operations:[borrow(),effect('call-arg'),use()],
    indexedUses:[indexed(2)]},'UNMODELED_EFFECT_EDGE:call-arg');
});
test('11 escaping closure capture remains unproven',()=>{
  denied({...base(),operations:[borrow(),effect('closure-capture'),use()],
    indexedUses:[indexed(2)]},'UNMODELED_EFFECT_EDGE:closure-capture');
});
test('12 unwind edge cannot be dropped from loan accounting',()=>{
  denied({...base(),operations:[borrow(),effect('exception-unwind'),use()],
    indexedUses:[indexed(2)]},'UNMODELED_EFFECT_EDGE:exception-unwind');
});
test('13 cancellation cleanup cannot be dropped from loan accounting',()=>{
  denied({...base(),operations:[borrow(),effect('cancellation-cleanup'),use()],
    indexedUses:[indexed(2)]},'UNMODELED_EFFECT_EDGE:cancellation-cleanup');
});
test('14 suspension frame cannot be silently treated as a use',()=>{
  denied({...base(),operations:[borrow(),effect('suspend-frame'),use()],
    indexedUses:[indexed(2)]},'UNMODELED_EFFECT_EDGE:suspend-frame');
});
test('15 actor send edge cannot be hidden from ownership',()=>{
  denied({...base(),operations:[borrow(),effect('actor-send'),use()],
    indexedUses:[indexed(2)]},'UNMODELED_EFFECT_EDGE:actor-send');
});
test('16 return borrowed view cannot claim lexical completion',()=>{
  denied({...base(),operations:[borrow(),effect('return-borrow'),use()],
    indexedUses:[indexed(2)]},'UNMODELED_EFFECT_EDGE:return-borrow');
});
test('17 phi join remains forbidden as straight-line completeness',()=>{
  denied({...base(),operations:[borrow(),effect('phi'),use()],
    indexedUses:[indexed(2)]},'UNMODELED_EFFECT_EDGE:phi');
});
test('18 branch successor cannot claim straight-line source proof',()=>{
  denied({...base(),successors:[1]},'UNBOUNDED_OR_NON_STRAIGHT_LINE_SSA');
});
test('19 source restoration without typed MIR and store is denied',()=>{
  denied({...base(),sourceReinitializations:[write()]},'MISSING_SOURCE_MIR_OR_LLVM_STORE');
});
test('20 matching self-reported source/MIR/LLVM stores remain unverified',()=>{
  const w=write();
  const r=candidate({...base(),sourceReinitializations:[w],
    mirWrites:[write(41,'p.field',3)],llvmStores:[write(41,'p.field',7)]});
  assert.equal(r.matchedWriteCount,1);
  assert.equal(r.emittedStoreVerified,false);
});
test('21 mismatched emitted field path rejects spurious write receipt',()=>{
  denied({...base(),sourceReinitializations:[write()],
    mirWrites:[write(41,'p.field',3)],llvmStores:[write(41,'p.other',7)]},
    'SOURCE_MIR_LLVM_WRITE_MISMATCH');
});
test('22 missing LLVM store rejects syntactically restored field',()=>{
  denied({...base(),sourceReinitializations:[write()],
    mirWrites:[write(41,'p.field',3)],llvmStores:[]},
    'MISSING_SOURCE_MIR_OR_LLVM_STORE');
});
test('23 duplicate compiler write tickets do not create two stores',()=>{
  denied({...base(),sourceReinitializations:[write(),write(41,'p.field',2)],
    mirWrites:[write(41,'p.field',3)],llvmStores:[write(41,'p.field',7)]},
    'DUPLICATE_WRITE_ID_IN_EVIDENCE');
});
test('24 lexical loan identity cannot impersonate a write ticket',()=>{
  denied({...base(),sourceReinitializations:[write(11)],
    mirWrites:[write(11,'p.field',3)],llvmStores:[write(11,'p.field',7)]},
    'INVALID_OR_COLLIDING_WRITE_PROVENANCE');
});
test('25 no uses cannot claim a complete SSA inventory',()=>{
  denied({operations:[borrow()],indexedUses:[]},'SOURCE_LOAN_STREAM_UNPROVEN');
});
test('26 bare source read after borrow is an unclassified use',()=>{
  denied({operations:[borrow(),use(),effect('read')],indexedUses:[indexed()]},
    'SOURCE_LOAN_STREAM_UNPROVEN');
});
test('27 source move before borrow cannot claim a candidate',()=>{
  denied({operations:[effect('move'),borrow(),use()],
    indexedUses:[indexed(2)]},'SOURCE_LOAN_STREAM_UNPROVEN');
});
test('28 two independent restored field writes must have distinct tickets',()=>{
  const r=candidate({...base(),sourceReinitializations:[write(41,'p.a'),write(42,'p.b',2)],
    mirWrites:[write(41,'p.a',5),write(42,'p.b',6)],
    llvmStores:[write(41,'p.a',7),write(42,'p.b',8)]});
  assert.equal(r.matchedWriteCount,2);
});
test('29 polluted projection path cannot forge field store',()=>{
  denied({...base(),sourceReinitializations:[write(41,'p.__proto__')],
    mirWrites:[write(41,'p.__proto__',3)],llvmStores:[write(41,'p.__proto__',7)]},
    'INVALID_OR_COLLIDING_WRITE_PROVENANCE');
});
test('30 caller verified flag never upgrades candidate to compiler proof',()=>{
  const r=candidate({...base(),verified:true,guestExecutionVerified:true});
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
});
