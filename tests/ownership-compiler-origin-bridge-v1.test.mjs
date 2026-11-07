import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCandidateCompilerOrigin,inspectCandidateCompilerPair} from
  '../src/ownership-compiler-origin-bridge-v1.mjs';

const name=x=>({kind:'name',name:x});
const field=(parent,part)=>({kind:'field',field:part,receiver:parent});
const fields=(root,n)=>Array.from({length:n},(_,i)=>i)
  .reduce(v=>field(v,'leaf'),name(root));
const defaultLocals={
  owned:{bindingId:'slotOwned',storageRoot:'storageA',mode:'owned'},
  alias:{bindingId:'slotAlias',storageRoot:'storageA',mode:'shared-loan'},
  borrowed:{bindingId:'slotBorrow',storageRoot:'storageA',mode:'shared-loan'},
  exclusive:{bindingId:'slotExclusive',storageRoot:'storageA',mode:'exclusive-loan'},
  other:{bindingId:'slotOther',storageRoot:'storageB',mode:'owned'}
};
const noAuthority={};
function resolved(expr,locals=defaultLocals) {
  const r=inspectCandidateCompilerOrigin(expr,locals);
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
  assert.equal(r.candidateResolved,true,JSON.stringify(r.errors));
  assert.equal(r.status,'CANDIDATE_COMPILER_ORIGIN_UNATTESTED');
  return r;
}
function unresolved(expr,expected,locals=defaultLocals) {
  const r=inspectCandidateCompilerOrigin(expr,locals);
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
  assert.equal(r.candidateResolved,false);
  assert.ok(r.errors.includes(expected),JSON.stringify(r.errors));
}
function pair(a,b,expected,claims) {
  const r=inspectCandidateCompilerPair({first:a,second:b,
    locals:defaultLocals,layoutClaims:claims});
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
  assert.equal(r.candidateResolved,true);
  assert.equal(r.independentStorageVerified,false);
  assert.equal(r.candidateMayAlias,expected);
}

test('origin 01: owned named slot is candidate authority, not proof',()=>{
  const r=resolved(name('owned'));
  assert.equal(r.mode,'owned');
  assert.equal(r.candidateOwnerAuthority,true);
  assert.deepEqual(r.place,{owner:'storageA',path:[]});
});
test('origin 02: one field preserves compiler-local storage origin',()=>{
  const r=resolved(fields('owned',1));
  assert.equal(r.place.owner,'storageA');
  assert.equal(r.place.path.length,1);
});
test('origin 03: nested three-field read retains same root',()=>{
  assert.equal(resolved(fields('owned',3)).place.path.length,3);
});
test('origin 04: bounded eight-field path is recognized',()=>{
  assert.equal(resolved(fields('owned',8)).place.path.length,8);
});
test('origin 05: ninth projection cannot fabricate a place',()=>{
  unresolved(fields('owned',9),'UNTRACKED_DEEP_PROJECTION');
});
test('origin 06: shared loan is not independent owner authority',()=>{
  const r=resolved(fields('borrowed',1));
  assert.equal(r.mode,'shared-loan');
  assert.equal(r.candidateOwnerAuthority,false);
});
test('origin 07: exclusive loan is not independent owner authority',()=>{
  const r=resolved(fields('exclusive',2));
  assert.equal(r.mode,'exclusive-loan');
  assert.equal(r.candidateOwnerAuthority,false);
});
test('origin 08: lexical symbol must exist in checked frame',()=>{
  unresolved(name('foreign'),'UNTRACKED_LEXICAL_ROOT');
});
test('origin 09: computed call cannot claim lexical root',()=>{
  unresolved({kind:'call',name:'owned'},'UNTRACKED_COMPUTED_ORIGIN');
});
test('origin 10: prototype-key spoofing is invalid',()=>{
  unresolved(name('__proto__'),'UNTRACKED_COMPUTED_ORIGIN');
});
test('origin 11: malformed binding provenance fails closed',()=>{
  for(const broken of [
    {bindingId:{toString:()=> 'slotOwned'},storageRoot:'storageA',mode:'owned'},
    {bindingId:'slotOwned',storageRoot:'constructor',mode:'owned'},
    {bindingId:'slotOwned',storageRoot:'__proto__',mode:'owned'},
    {bindingId:'slotOwned',storageRoot:17,mode:'owned'},
    {bindingId:'__proto__',storageRoot:'storageA',mode:'owned'},
    {bindingId:'slotOwned',storageRoot:'storageA',mode:'unknown'}
  ]) unresolved(name('owned'),'UNVERIFIED_BINDING_ORIGIN',{owned:broken});
});
test('origin 12: inherited object property is not compiler-local evidence',()=>{
  const forged=Object.create({owned:defaultLocals.owned});
  unresolved(name('owned'),'UNTRACKED_LEXICAL_ROOT',forged);
});
test('origin 13: index access cannot masquerade as named field path',()=>{
  unresolved({kind:'index',index:0,receiver:name('owned')},'UNTRACKED_COMPUTED_ORIGIN');
});
test('origin 14: invalid field projection rejects before origin lookup',()=>{
  unresolved(field(name('owned'),'constructor'),'INVALID_FIELD');
});
test('origin 15: malformed symbol-table input is not authoritative',()=>{
  unresolved(name('owned'),'INVALID_LEXICAL_BINDINGS',null);
});

test('pair 16: exact named slot aliases itself',()=>{
  pair(name('owned'),name('owned'),true);
});
test('pair 17: two lexical bindings with same storage root alias',()=>{
  pair(name('owned'),name('alias'),true);
});
test('pair 18: different storage-root strings are NOT separation proof',()=>{
  pair(name('owned'),name('other'),true);
});
test('pair 19: exact asserted independent roots yield only a candidate',()=>{
  pair(name('owned'),name('other'),false,{
    independentOwnerPairs:[{kind:'independent-roots',owners:['storageA','storageB']}]
  });
});
test('pair 20: wrong-kind claims cannot prove separation',()=>{
  pair(name('owned'),name('other'),true,{
    independentOwnerPairs:[{kind:'independent-fields',owners:['storageA','storageB']}]
  });
});
test('pair 21: unilateral root claim cannot prove separation',()=>{
  pair(name('owned'),name('other'),true,{
    independentOwnerPairs:[{kind:'independent-roots',owners:['storageA','storageC']}]
  });
});
test('pair 22: same-root siblings alias absent layout proof',()=>{
  pair(field(name('owned'),'left'),field(name('alias'),'right'),true);
});
test('pair 23: exact sibling layout can be conditionally separated',()=>{
  pair(field(name('owned'),'left'),field(name('alias'),'right'),false,{
    storageA:{owner:'storageA',disjointFields:[
      {kind:'nominal-fields',owner:'storageA',parent:[],members:['left','right']}
    ]}
  });
});
test('pair 24: owner and descendant always overlap',()=>{
  pair(name('owned'),field(name('alias'),'child'),true);
});
test('pair 25: missing lexical binding cannot form a verified pair',()=>{
  const r=inspectCandidateCompilerPair({first:name('owned'),second:name('missing'),
    locals:defaultLocals});
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
  assert.equal(r.candidateResolved,false);
  assert.ok(r.errors.includes('UNTRACKED_LEXICAL_ROOT'));
});
