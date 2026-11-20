import test from 'node:test';
import assert from 'node:assert/strict';
import {denyAllPolicy, validatePolicy, evaluatePermission} from '../src/permission-manifest.mjs';

const policy = () => {const p=denyAllPolicy();p.read.allow.push('tenant');return p;};
const layers = () => ({host:policy(),artifact:policy(),runtime:policy(),actor:policy(),delegated:policy()});

test('the same scope is matched once across all five authority layers', () => {
  let calls=0;
  const allowed=evaluatePermission(layers(),'read','resource',(permission,resource,scope)=>{
    calls++;return permission==='read'&&resource==='resource'&&scope==='tenant';
  });
  assert.equal(allowed,true);
  assert.equal(calls,1);
});

test('deny takes precedence over a complete set of grants', () => {
  const input=layers();input.runtime.read.deny.push('tenant');
  assert.equal(evaluatePermission(input,'read','resource',()=>true),false);
});

test('a reentrant matcher cannot change already captured authority layers', () => {
  const input=layers();
  const result=evaluatePermission(input,'read','resource',()=>{
    input.delegated.read.allow.length=0;
    input.host.read.allow.length=0;
    return true;
  });
  assert.equal(result,true);
});

test('getter-backed scope lists and nonboolean matcher claims are rejected inertly', () => {
  const input=layers();let getters=0;
  Object.defineProperty(input.actor.read,'allow',{enumerable:true,get(){getters++;return ['tenant'];}});
  assert.throws(()=>evaluatePermission(input,'read','resource',()=>true),/requires own data fields/);
  assert.equal(getters,0);
  assert.throws(()=>evaluatePermission(layers(),'read','resource',()=>({yes:true})),/matcher must return a boolean/);
  const sorted=validatePolicy({...denyAllPolicy(),read:{allow:['z','a'],deny:[]}});
  assert.deepEqual(sorted.read.allow,['a','z']);
});
