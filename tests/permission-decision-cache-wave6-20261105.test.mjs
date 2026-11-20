import test from 'node:test';
import assert from 'node:assert/strict';
import {denyAllPolicy,evaluatePermission} from '../src/permission-manifest.mjs';

const makePolicy=()=>{const p=denyAllPolicy();p.read.allow.push('repo/*');return p;};
const layers=()=>Object.fromEntries(
  ['host','artifact','runtime','actor','delegated'].map(name=>[name,makePolicy()])
);

test('five required authority layers reuse one verified scope-matcher result',()=>{
  let calls=0;
  const permitted=evaluatePermission(layers(),'read','repo/report',(_,__,scope)=>{
    calls++;
    return scope==='repo/*';
  });
  assert.equal(permitted,true);
  assert.equal(calls,1);
});

test('a single explicit deny prevails and wrong matcher result types fail closed',()=>{
  const grant=layers();
  grant.delegated.read.deny.push('repo/*');
  let calls=0;
  assert.equal(evaluatePermission(grant,'read','repo/report',()=>{calls++;return true;}),false);
  assert.equal(calls,1);
  assert.throws(()=>evaluatePermission(layers(),'read','repo/report',()=>({allowed:true})),
    /resource matcher must return a boolean/);
});

test('all policy layers are snapshotted before any reentrant matcher invocation',()=>{
  const grant=layers();
  let calls=0;
  const allowed=evaluatePermission(grant,'read','repo/report',(_,__,scope)=>{
    calls++;
    grant.delegated.read.allow.length=0;
    return scope==='repo/*';
  });
  assert.equal(allowed,true);
  assert.equal(calls,1);
  assert.equal(grant.delegated.read.allow.length,0);
});
