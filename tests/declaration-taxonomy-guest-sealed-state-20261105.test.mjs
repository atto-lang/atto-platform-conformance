import test from 'node:test';
import assert from 'node:assert/strict';
import {decide} from '../src/declaration-taxonomy-v1.mjs';

const rule={
 parent_kinds:['actor'],max_parents:1,isolation:'preserve',
 ordinary_fields:false,guest_state_blocks:1,identity_key:false,
 interfaces:true,traits:true
};
const policy={rules:{actor:rule,record:rule,state_container:rule}};
const classify=(kind,options={})=>decide(policy,{kind,options});

test('actor parent isolation and state schema restrictions are deterministic',()=>{
 assert.equal(classify('actor',{parents:[{kind:'class'}]}),'PARENT_KIND');
 assert.equal(classify('actor',{parents:[{kind:'actor'},{kind:'actor'}]}),
  'MULTIPLE_SUPERCLASSES');
 assert.equal(classify('actor',{parents:[{kind:'actor',isolation:'shared'}],isolation:'private'}),
  'ISOLATION_CHANGE');
 assert.equal(classify('actor',{ordinary_fields:1}),'PERSISTENT_STATE_OUTSIDE_SCHEMA');
 assert.equal(classify('actor',{state_blocks:2}),'STATE_SCHEMA_COUNT');
});
test('actor state cannot escape sealed loan and await boundaries',()=>{
 assert.equal(classify('actor',{direct_state_access:true}),'DIRECT_STATE_ACCESS');
 assert.equal(classify('actor',{loan_escape:true}),'STATE_LOAN_ESCAPE');
 assert.equal(classify('actor',{loan_across_await:true}),'STATE_LOAN_SUSPEND');
 assert.equal(classify('actor',{override_intrinsic:true}),'SEALED_INTRINSIC');
});
test('inherited interfaces and traits cannot mint control or ambient grants',()=>{
 assert.equal(classify('actor',{claims_control:true}),'CONTROL_FORGERY');
 assert.equal(classify('actor',{interfaces:[{kind:'interface',capabilities:['fs']}]}),
  'INTERFACE_CAPABILITY_GRANT');
 assert.equal(classify('actor',{traits:[{stateful:true}]}),'TRAIT_STATE_FORBIDDEN');
 assert.equal(classify('actor',{traits:[{stateful:false,capabilities:['clock']}]}),
  'TRAIT_CAPABILITY_GRANT');
});
test('records, shared state and explicit capabilities are fail-closed',()=>{
 assert.equal(classify('record',{mutable_fields:1}),'IMMUTABLE_RECORD_MUTATION');
 assert.equal(classify('state_container',{shared_mutation:true}),'UNGUARDED_SHARED_MUTATION');
 assert.equal(classify('actor',{capabilities:['read'],granted_capabilities:['write']}),
  'CAPABILITY_WIDENING');
 assert.equal(classify('actor',{}),'OK');
 assert.equal(classify('foreign',{}),'UNKNOWN_KIND');
});
