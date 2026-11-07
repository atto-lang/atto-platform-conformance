import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePlace,placesOverlap,inspectPlaceFlow} from '../src/ownership-place-cfg-v1.mjs';

const p=(name,...path)=>({owner:name,path});
const f=name=>({field:name}), idx=n=>({index:n});
const layout={alpha:{owner:'alpha',
  disjointFields:[{kind:'nominal-fields',owner:'alpha',parent:[],members:['left','right']}],
  disjointIndices:[{kind:'independent-elements',parent:[f('items')]}]}};
function accepted(events){
  const r=inspectPlaceFlow({events,layoutClaims:layout});
  assert.equal(r.ok,false);assert.equal(r.verified,false);
  assert.equal(r.candidateAdmitted,true,JSON.stringify(r.errors));
  assert.equal(r.status,'CANDIDATE_ACCEPTED_UNATTESTED');return r;
}
function denied(events,why,claims=layout){
  const r=inspectPlaceFlow({events,layoutClaims:claims});
  assert.equal(r.ok,false);assert.equal(r.verified,false);
  assert.equal(r.candidateAdmitted,false);
  assert.ok(r.errors.includes(why),'expected '+why+' got '+JSON.stringify(r.errors));
}
test('malformed source places fail closed',()=>{
  for(const malformed of [null,{},p('__proto__'),p('alpha',{field:'__proto__'}),
    p('alpha',{field:'a',index:0}),p('alpha',{index:-1}),p('alpha',{index:1.5}),
    p('alpha',{index:'runtime'}),p('alpha',{pointer:0}),
    p('alpha',...Array.from({length:9},()=>f('x')))])
    assert.throws(()=>normalizePlace(malformed));
});
test('root and ancestry overlap; distinct root labels need provenance',()=>{
  assert.equal(placesOverlap(p('alpha'),p('alpha',f('left'))),true);
  assert.equal(placesOverlap(p('alpha',f('left')),p('alpha',f('left'))),true);
  assert.equal(placesOverlap(p('alpha',f('left')),p('alpha',f('right'))),true);
  assert.equal(placesOverlap(p('alpha'),p('beta')),true);
  assert.equal(placesOverlap(p('alpha'),p('beta'),{
    independentOwnerPairs:[{kind:'independent-roots',owners:['alpha','beta']}]
  }),false);
});
test('sibling fields require exact canonical layout claims',()=>{
  const a=p('alpha',f('left')),b=p('alpha',f('right'));
  assert.equal(placesOverlap(a,b,layout),false);
  assert.equal(placesOverlap(a,b,{alpha:{owner:'alpha',disjointFields:[]}}),true);
  assert.equal(placesOverlap(a,b,{alpha:{owner:'beta',disjointFields:layout.alpha.disjointFields}}),true);
  assert.equal(placesOverlap(a,b,{beta:layout.alpha}),true);
  assert.equal(placesOverlap(p('alpha'),a,layout),true);
});
test('array elements are independent only with layout; wildcard aliases all',()=>{
  const a=p('alpha',f('items'),idx(0)),b=p('alpha',f('items'),idx(1));
  assert.equal(placesOverlap(a,b),true);
  assert.equal(placesOverlap(a,b,layout),false);
  assert.equal(placesOverlap(a,p('alpha',f('items'),idx('*')),layout),true);
  assert.equal(placesOverlap(a,p('alpha',f('items')),layout),true);
});
test('multiple shared loans release before take',()=>{
  accepted([{op:'borrow',place:p('alpha'),loan:'L',mutable:false},
    {op:'borrow',place:p('alpha'),loan:'R',mutable:false},
    {op:'read',place:p('alpha')},{op:'release',loan:'L'},
    {op:'release',loan:'R'},{op:'take',place:p('alpha')}]);
});
test('exclusive loans exclude reads, writes, shared loans and moves',()=>{
  const x=p('alpha');
  denied([{op:'borrow',place:x,loan:'L',mutable:false},
    {op:'borrow',place:x,loan:'R',mutable:true}],'OVERLAPPING_LOAN_CONFLICT');
  denied([{op:'borrow',place:x,loan:'L',mutable:true},{op:'read',place:x}],
    'READ_CONFLICTS_EXCLUSIVE_LOAN');
  denied([{op:'borrow',place:x,loan:'L',mutable:true},{op:'write',place:x}],
    'WRITE_DURING_ACTIVE_LOAN');
  denied([{op:'borrow',place:x,loan:'L',mutable:false},{op:'take',place:x}],
    'TAKE_DURING_ACTIVE_LOAN');
});
test('disjoint field loans require a layout claim',()=>{
  const a=p('alpha',f('left')),b=p('alpha',f('right'));
  denied([{op:'borrow',place:a,loan:'L',mutable:true},
    {op:'borrow',place:b,loan:'R',mutable:true}],
    'OVERLAPPING_LOAN_CONFLICT',{});
  accepted([{op:'borrow',place:a,loan:'L',mutable:true},
    {op:'borrow',place:b,loan:'R',mutable:true},
    {op:'release',loan:'R'},{op:'release',loan:'L'}]);
  denied([{op:'borrow',place:a,loan:'L',mutable:true},
    {op:'borrow',place:a,loan:'L',mutable:true}],'DUPLICATE_LOAN_ID');
});
test('partial field moves preserve sibling but poison owner reads',()=>{
  const a=p('alpha',f('left')),b=p('alpha',f('right'));
  accepted([{op:'take',place:a},{op:'read',place:b}]);
  denied([{op:'take',place:a},{op:'read',place:p('alpha')}],'READ_OF_MOVED_PLACE');
  denied([{op:'take',place:a},{op:'take',place:a}],'TAKE_OF_MOVED_PLACE');
  denied([{op:'take',place:a},{op:'read',place:b}],'READ_OF_MOVED_PLACE',{});
});
test('writing one field revives only that field, whole-root needs rebind',()=>{
  const a=p('alpha',f('left')),b=p('alpha',f('right'));
  accepted([{op:'take',place:a},{op:'write',place:a},{op:'read',place:p('alpha')}]);
  denied([{op:'take',place:p('alpha')},{op:'write',place:a}],'WRITE_THROUGH_MOVED_OWNER');
  accepted([{op:'take',place:p('alpha')},{op:'rebind',place:p('alpha')},
    {op:'read',place:a},{op:'read',place:b}]);
  denied([{op:'rebind',place:a}],'REBIND_REQUIRES_WHOLE_OWNER');
});
test('join conservatively unions possibly-moved owner states',()=>{
  denied([{op:'branch',then:[{op:'take',place:p('alpha')}],else:[]},
    {op:'read',place:p('alpha')}],'READ_OF_MOVED_PLACE');
  accepted([{op:'branch',then:[{op:'take',place:p('alpha')}],else:[]},
    {op:'rebind',place:p('alpha')},{op:'read',place:p('alpha')}]);
});
test('divergent loan inventories never get silently dropped at join',()=>{
  denied([{op:'branch',then:[{op:'borrow',place:p('alpha'),loan:'L',mutable:false}],else:[]}],
    'LOAN_JOIN_MISMATCH');
  accepted([{op:'branch',then:[{op:'borrow',place:p('alpha'),loan:'L',mutable:false},
    {op:'release',loan:'L'}],else:[]}]);
});
test('suspension, transport and scope must not export live loans',()=>{
  denied([{op:'borrow',place:p('alpha'),loan:'L',mutable:false},{op:'suspend'}],
    'LIVE_LOAN_CROSSES_SUSPENSION');
  denied([{op:'send',payloadMode:'borrowed'}],'BORROW_ESCAPES_TRANSPORT');
  denied([{op:'send',payloadMode:'unknown'}],'UNKNOWN_TRANSPORT_PROVENANCE');
  denied([{op:'borrow',place:p('alpha'),loan:'L',mutable:false}],
    'LOAN_ESCAPES_LEXICAL_SCOPE');
  accepted([{op:'borrow',place:p('alpha'),loan:'L',mutable:false},
    {op:'release',loan:'L'},{op:'suspend'},
    {op:'send',place:p('alpha'),payloadMode:'owned-copy'}]);
  accepted([{op:'send',place:p('alpha'),payloadMode:'owned-copy'},
    {op:'read',place:p('alpha')}]);
  denied([{op:'send',place:p('alpha'),payloadMode:'owned-take'},
    {op:'read',place:p('alpha')}],'READ_OF_MOVED_PLACE');
  denied([{op:'send',place:p('alpha'),payloadMode:'owned-take'},
    {op:'send',place:p('alpha'),payloadMode:'owned-take'}],
    'SEND_OF_MOVED_PLACE');
  denied([{op:'borrow',place:p('alpha'),loan:'L',mutable:false},
    {op:'send',place:p('alpha'),payloadMode:'owned-take'}],
    'SEND_TAKE_DURING_ACTIVE_LOAN');
  denied([{op:'borrow',place:p('alpha'),loan:'L',mutable:true},
    {op:'send',place:p('alpha'),payloadMode:'owned-copy'}],
    'SEND_COPY_CONFLICTS_EXCLUSIVE_LOAN');
  denied([{op:'send',payloadMode:'owned-copy'}], 'INVALID_PLACE_OWNER');
});
test('candidate outcome is not verification and budgets fail closed',()=>{
  const r=inspectPlaceFlow({events:[]});
  assert.equal(r.ok,false);assert.equal(r.verified,false);
  denied(Array.from({length:257},()=>({op:'read',place:p('alpha')})),
    'CFG_BUDGET_EXCEEDED');
  denied([{op:'release',loan:'missing'}],'UNKNOWN_OR_DUPLICATE_LOAN_RELEASE');
  denied([{op:'magic',place:p('alpha')}],'UNSUPPORTED_CFG_OPERATION');
});
