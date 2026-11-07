import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCandidateLastUse,inspectCandidateFieldReinitialize}
  from '../src/ownership-nll-last-use-v1.mjs';

const borrow=(token=11,kind='borrow-shared',place='x')=>({kind,token,place});
const use=(token=11,kind='use-shared',place='x')=>({kind,token,place});
const proof={token:11,finalUse:1};
const candidate=(operations=[borrow(),use()],proofs=[proof],successors=[]) =>
  inspectCandidateLastUse({operations,proofs,successors});
const check=(r,valid,reason)=>{
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
  assert.equal(r.candidateValid,valid,JSON.stringify(r.errors));
  if (reason) assert.ok(r.errors.includes(reason),JSON.stringify(r.errors));
};

test('01 complete shared last-use is still unauthenticated',()=>check(candidate(),true));
test('02 exclusive last-use is still unauthenticated',()=>check(candidate(
  [borrow(22,'borrow-exclusive'),use(22,'use-exclusive')],[{token:22,finalUse:1}]),true));
test('03 two independent annotated loan tokens are candidates',()=>check(candidate(
  [borrow(),use(),borrow(22),use(22)],
  [{token:11,finalUse:1},{token:22,finalUse:3}]),true));
test('04 missing complete certificate denied',()=>check(candidate(
  [borrow(),use()],[]),false,'INCOMPLETE_OR_MIXED_LOAN_PROOF'));
test('05 duplicate loan token denied',()=>check(candidate(
  [borrow(),borrow(),use()], [proof]),false,'DUPLICATE_LOAN_TOKEN'));
test('06 wrong last-use index denied',()=>check(candidate(
  [borrow(),use(),use()],[{token:11,finalUse:1}]),false,'INCORRECT_LAST_USE_SITE'));
test('07 foreign lexical use denied',()=>check(candidate(
  [borrow(),use(22)], [proof]),false,'FOREIGN_OR_WRONG_LOAN_USE'));
test('08 exclusive use on shared loan denied',()=>check(candidate(
  [borrow(),use(11,'use-exclusive')],[proof]),false,'FOREIGN_OR_WRONG_LOAN_USE'));
test('09 mismatched borrowed place denied',()=>check(candidate(
  [borrow(),use(11,'use-shared','y')],[proof]),false,'FOREIGN_OR_WRONG_LOAN_USE'));
test('10 lexical release cannot mix with inferred release',()=>check(candidate(
  [borrow(),use(),{kind:'release-shared',token:11,place:'x'}],[proof]),
  false,'INCOMPLETE_OR_MIXED_LOAN_PROOF'));
test('11 branches cannot claim straight-line completeness',()=>check(candidate(
  undefined,undefined,[1,2]),false,'NOT_A_PROVEN_STRAIGHT_LINE_CFG'));
test('12 malformed loan identity rejected',()=>check(candidate(
  [borrow(0),use()],[proof]),false,'INVALID_LEXICAL_LOAN_OPERATION'));
test('13 post-release loan use lacks source proof',()=>check(candidate(
  [borrow(),use(),{kind:'release-shared',token:11,place:'x'},use()],[{token:11,finalUse:3}]),
  false,'INCOMPLETE_OR_MIXED_LOAN_PROOF'));
test('14 unsupported untracked call-like op rejected',()=>check(candidate(
  [borrow(),{kind:'unknown-call',token:11,place:'x'},use()],[{token:11,finalUse:2}]),
  false,'UNSUPPORTED_OP_IN_LAST_USE_PROOF'));
test('15 source-provided verified field cannot promote model result',()=>{
  const r=inspectCandidateLastUse({operations:[borrow(),use()],proofs:[proof],verified:true});
  check(r,true);
});
test('16 definitely moved field with claimed write is still not verified',()=>{
  const r=inspectCandidateFieldReinitialize({before:'moved',sourceWriteProven:true});
  check(r,true);
});
test('17 live field cannot reinitialize',()=>check(inspectCandidateFieldReinitialize({
  before:'owned',sourceWriteProven:true}),false,'UNPROVEN_FIELD_REINITIALIZATION'));
test('18 maybe-moved field cannot reinitialize',()=>check(inspectCandidateFieldReinitialize({
  before:'maybe-moved',sourceWriteProven:true}),false,'UNPROVEN_FIELD_REINITIALIZATION'));
test('19 borrowed moved field cannot reinitialize',()=>check(inspectCandidateFieldReinitialize({
  before:'moved',sourceWriteProven:true,hasActiveLoan:true}),
  false,'UNPROVEN_FIELD_REINITIALIZATION'));
test('20 moved field without proven source write cannot reinitialize',()=>
  check(inspectCandidateFieldReinitialize({before:'moved'}),
  false,'UNPROVEN_FIELD_REINITIALIZATION'));
