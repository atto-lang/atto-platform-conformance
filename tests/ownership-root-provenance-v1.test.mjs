import test from 'node:test';
import assert from 'node:assert/strict';
import { placesOverlap, inspectPlaceFlow } from '../src/ownership-place-cfg-v1.mjs';

const p=(owner,...path)=>({owner,path});
const a=p('alpha'),b=p('beta'),c=p('gamma');
const valid={independentOwnerPairs:[{kind:'independent-roots',owners:['alpha','beta']}]};
const unsupported=[
  ['missing claim',{}],
  ['empty claim list',{independentOwnerPairs:[]}],
  ['null claim',{independentOwnerPairs:null}],
  ['string claim',{independentOwnerPairs:'alpha,beta'}],
  ['wrong root names',{independentOwnerPairs:[{kind:'independent-roots',owners:['alpha','gamma']}]}],
  ['one root only',{independentOwnerPairs:[{kind:'independent-roots',owners:['alpha']}]}],
  ['three roots',{independentOwnerPairs:[{kind:'independent-roots',owners:['alpha','beta','gamma']}]}],
  ['duplicate roots',{independentOwnerPairs:[{kind:'independent-roots',owners:['alpha','alpha']}]}],
  ['wrong claim kind',{independentOwnerPairs:[{kind:'independent-fields',owners:['alpha','beta']}]}],
  ['no claim kind',{independentOwnerPairs:[{owners:['alpha','beta']}]}],
  ['no owners',{independentOwnerPairs:[{kind:'independent-roots'}]}],
  ['extra unvalidated authority',{independentOwnerPairs:[{kind:'independent-roots',owners:['alpha','beta'],verified:true}]}],
  ['malformed owner',{independentOwnerPairs:[{kind:'independent-roots',owners:['alpha',null]}]}],
  ['object owner impersonation',{independentOwnerPairs:[{kind:'independent-roots',owners:['alpha',{toString:()=> 'beta'}]}]}],
  ['unsafe prototype owner',{independentOwnerPairs:[{kind:'independent-roots',owners:['alpha','__proto__']}]}],
  ['non-array root entry',{independentOwnerPairs:[{kind:'independent-roots',owners:'alpha,beta'}]}],
  ['numeric root entry',{independentOwnerPairs:[123]}],
  ['null root entry',{independentOwnerPairs:[null]}]
];

for(const [name,claim] of unsupported){
  test('root provenance/negative: '+name,()=>{
    assert.equal(placesOverlap(a,b,claim),true);
    assert.equal(placesOverlap(b,a,claim),true);
    const result=inspectPlaceFlow({events:[
      {op:'borrow',place:a,loan:'L',mutable:true},
      {op:'borrow',place:b,loan:'R',mutable:true},
      {op:'release',loan:'L'},{op:'release',loan:'R'}
    ],layoutClaims:claim});
    assert.equal(result.ok,false);
    assert.equal(result.verified,false);
    assert.equal(result.candidateAdmitted,false);
    assert.ok(result.errors.includes('OVERLAPPING_LOAN_CONFLICT'));
  });
}

test('root provenance/positive: a claimed independent pair can hold separate loans',()=>{
  assert.equal(placesOverlap(a,b,valid),false);
  assert.equal(placesOverlap(b,a,valid),false);
  const result=inspectPlaceFlow({events:[
    {op:'borrow',place:a,loan:'L',mutable:true},
    {op:'borrow',place:b,loan:'R',mutable:true},
    {op:'release',loan:'R'},{op:'release',loan:'L'}
  ],layoutClaims:valid});
  assert.equal(result.candidateAdmitted,true,result.errors.join(','));
  assert.equal(result.ok,false);
  assert.equal(result.verified,false);
});
test('root provenance: exact pairs do not authorize unrelated owners',()=>{
  assert.equal(placesOverlap(a,c,valid),true);
  assert.equal(placesOverlap(b,c,valid),true);
  assert.equal(placesOverlap(a,a,valid),true);
});
test('root provenance: pair disjointness is symmetric for all root permutations',()=>{
  for(const x of ['alpha','beta','gamma','delta','epsilon']){
    for(const y of ['alpha','beta','gamma','delta','epsilon']){
      const ab=placesOverlap(p(x),p(y),valid);
      const ba=placesOverlap(p(y),p(x),valid);
      assert.equal(ab,ba,x+' vs '+y);
      assert.equal(ab,x===y?true:!((x==='alpha'&&y==='beta')||(x==='beta'&&y==='alpha')));
    }
  }
});
test('root provenance: sharing a lexical alias cannot authorize a take',()=>{
  const result=inspectPlaceFlow({events:[
    {op:'borrow',place:a,loan:'L',mutable:false},
    {op:'take',place:b}
  ],layoutClaims:{}});
  assert.equal(result.candidateAdmitted,false);
  assert.ok(result.errors.includes('TAKE_DURING_ACTIVE_LOAN'));
});
test('root provenance: a moved root may not be read through an unproven alias',()=>{
  const result=inspectPlaceFlow({events:[
    {op:'take',place:a},{op:'read',place:b}
  ],layoutClaims:{}});
  assert.equal(result.candidateAdmitted,false);
  assert.ok(result.errors.includes('READ_OF_MOVED_PLACE'));
});
