// Five-layer host reference policy tests: not an OS capability sandbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import {denyAllPolicy,evaluatePermission,serializeManifest,parseManifest} from '../src/permission-manifest.mjs';

function grants(){
  const layers=Object.fromEntries(['host','artifact','runtime','actor','delegated']
    .map(name=>[name,denyAllPolicy()]));
  for(const layer of Object.values(layers))layer.read.allow.push('*');
  return layers;
}

test('malformed final authority layer is rejected before any matcher side effect',()=>{
  const layers=grants();
  let getters=0,matches=0;
  Object.defineProperty(layers.delegated.read,'deny',{
    enumerable:true,configurable:true,get(){getters++;return [];}
  });
  assert.throws(()=>evaluatePermission(layers,'read','/resource',()=>{
    matches++;return true;
  }),/requires own data fields/);
  assert.equal(getters,0);
  assert.equal(matches,0);
});

test('one explicit deny wins against five grants without re-evaluating scopes',()=>{
  const layers=grants();
  layers.runtime.read.deny.push('/blocked');
  const observed=new Map();
  const allowed=evaluatePermission(layers,'read','/blocked',(_p,resource,scope)=>{
    assert.equal(resource,'/blocked');
    observed.set(scope,(observed.get(scope)||0)+1);
    return scope===resource;
  });
  assert.equal(allowed,false);
  assert.equal(observed.get('/blocked'),1);
});

test('canonical manifest binds a trusted digest and freezes nested policy',()=>{
  const digest='a'.repeat(64);
  const raw=serializeManifest({
    format:'oreslang.permissions',version:1,artifact_sha256:digest,
    policy:denyAllPolicy()
  });
  const parsed=parseManifest(raw,digest);
  assert.equal(Object.isFrozen(parsed.policy.read),true);
  assert.equal(Object.isFrozen(parsed.policy.read.allow),true);
  assert.throws(()=>parseManifest(raw,'b'.repeat(64)),/digest differ/);
});
