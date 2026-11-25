import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCandidateClosedWorldLoanUses}
  from '../src/ownership-nll-closed-world-v1.mjs';

const borrow=(id=11,place='x',kind='borrow-shared')=>({kind,place,token:id});
const use=(id=11,place='x',kind='use-shared')=>({kind,place,token:id});
const effect=(kind,place='x',token=null)=>({kind,place,token});
const inspect=(operations,successors=[])=>inspectCandidateClosedWorldLoanUses({operations,successors});
const admitted=(operations,expectedUses)=>{
  const r=inspect(operations);
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
  assert.equal(r.candidateResolved,true,JSON.stringify(r.errors));
  assert.equal(r.lastUses.length,expectedUses);
  return r;
};
const denied=(operations,code,successors=[])=>{
  const r=inspect(operations,successors);
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
  assert.equal(r.candidateResolved,false);
  assert.ok(r.errors.includes(code),JSON.stringify(r.errors));
};
test('01 single shared loan derives last use, never compiler verification',()=>{
  const r=admitted([borrow(),use(),effect('move')],1);
  assert.equal(r.lastUses[0].finalUseSite,1);
});
test('02 latest annotated use wins deterministically',()=>{
  const r=admitted([borrow(),use(),use(),effect('move')],1);
  assert.equal(r.lastUses[0].finalUseSite,2);
});
test('03 independent token origins derive two last uses',()=>{
  const r=admitted([borrow(),use(),borrow(22,'y'),use(22,'y')],2);
  assert.deepEqual(r.lastUses.map(x=>x.loanId),[11,22]);
});
test('04 exclusive use must match exclusive issuance',()=>{
  admitted([borrow(17,'x','borrow-exclusive'),use(17,'x','use-exclusive')],1);
});
test('05 unminted token is never lexical proof',()=>{
  denied([borrow(0),use()],'DUPLICATED_OR_UNMINTED_LOAN_TOKEN');
});
test('06 reused token across roots is rejected',()=>{
  denied([borrow(),borrow(11,'y'),use()],'DUPLICATED_OR_UNMINTED_LOAN_TOKEN');
});
test('07 wrong borrowing mode rejected',()=>{
  denied([borrow(),use(11,'x','use-exclusive')],'MISMATCHED_LOAN_USE');
});
test('08 use of a different place rejected',()=>{
  denied([borrow(),use(11,'y')],'MISMATCHED_LOAN_USE');
});
test('09 anonymous use without a source borrow rejected',()=>{
  denied([use()],'FOREIGN_LOAN_USE_TOKEN');
});
test('10 borrowed token without annotated use is incomplete',()=>{
  denied([borrow()],'BORROW_WITHOUT_COMPLETE_USE');
});
test('11 manual release cannot mix with derived last use',()=>{
  denied([borrow(),use(),effect('release-shared','x',11)],'MIXED_EXPLICIT_AND_DERIVED_RELEASES');
});
test('12 owner read after loan is ambiguous without typed SSA',()=>{
  denied([borrow(),use(),effect('read')],'UNCLASSIFIED_POST_BORROW_EFFECT');
});
test('13 whole-object read after borrow is ambiguous too',()=>{
  denied([borrow(),use(),effect('read-object','x')],'UNCLASSIFIED_POST_BORROW_EFFECT');
});
test('14 call-like effects after loan are not silently ignored',()=>{
  denied([borrow(),use(),effect('call')],'UNCLASSIFIED_POST_BORROW_EFFECT');
});
test('15 CFG branch edges cannot claim straight-line completeness',()=>{
  denied([borrow(),use()],'NOT_A_STRAIGHT_LINE_COMPILER_STREAM',[1,2]);
});
test('16 suspension before final loan use is rejected',()=>{
  denied([borrow(),effect('suspend'),use()],'SUSPENSION_WITH_UNFINISHED_LOAN_USE');
});
test('17 move before final loan use is rejected',()=>{
  denied([borrow(),effect('move'),use()],'EFFECT_BEFORE_FINAL_LOAN_USE');
});
test('18 completed loan allows later move only as unverified candidate',()=>{
  admitted([borrow(),use(),effect('move')],1);
});
test('19 forged token on move does not create provenance',()=>{
  denied([borrow(),use(),effect('move','x',11)],'EFFECT_IMPERSONATES_LOAN_ID');
});
test('20 output refuses externally supplied verified status',()=>{
  const r=inspectCandidateClosedWorldLoanUses({
    operations:[borrow(),use()],verified:true,successors:[]
  });
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
  assert.equal(r.status,'TOKEN_STREAM_CANDIDATE_NOT_SSA_PROVEN');
});

test('21 borrowing an already moved owner is never a candidate',()=>{
  denied([effect('move'),borrow(),use()],'BORROW_OF_MOVED_OWNER');
});
test('22 a move of an independent owner does not poison a different loan',()=>{
  admitted([effect('move','y'),borrow(),use()],1);
});
test('23 moving one owner twice is rejected',()=>{
  denied([borrow(),use(),effect('move'),effect('move')],'DOUBLE_MOVE_OF_OWNER');
});
test('24 shared loan overlapping an exclusive loan is rejected',()=>{
  denied([borrow(),borrow(22,'x','borrow-exclusive'),use(),
    use(22,'x','use-exclusive')],'OVERLAPPING_EXCLUSIVE_LOANS');
});
test('25 exclusive loan overlapping a shared loan is rejected',()=>{
  denied([borrow(11,'x','borrow-exclusive'),borrow(22),use(11,'x','use-exclusive'),
    use(22)],'OVERLAPPING_EXCLUSIVE_LOANS');
});
test('26 two overlapping exclusive loans are rejected',()=>{
  denied([borrow(11,'x','borrow-exclusive'),borrow(22,'x','borrow-exclusive'),
    use(11,'x','use-exclusive'),use(22,'x','use-exclusive')],
    'OVERLAPPING_EXCLUSIVE_LOANS');
});
test('27 sequential shared then exclusive loan stays advisory',()=>{
  admitted([borrow(),use(),borrow(22,'x','borrow-exclusive'),
    use(22,'x','use-exclusive')],2);
});
test('28 overlapping shared loans are permitted as unverified candidates',()=>{
  admitted([borrow(),borrow(22),use(),use(22)],2);
});
test('29 empty token stream cannot manufacture a last-use proof',()=>{
  denied([],'NO_LOAN_USE_PROOF_TO_DERIVE');
});
test('30 an independent move after a loan does not consume its owner',()=>{
  admitted([borrow(),effect('move','y'),use(),effect('move','x')],1);
});
