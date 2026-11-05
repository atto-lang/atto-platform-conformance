import test from 'node:test';
import assert from 'node:assert/strict';
import {denyAllPolicy,evaluatePermission} from '../src/permission-manifest.mjs';

const layers=()=>{
  const names=['host','artifact','runtime','actor','delegated'];
  return Object.fromEntries(names.map(name=>{
    const policy=denyAllPolicy();
    policy.read.allow=['scoped'];
    return [name,policy];
  }));
};
test('repeated layer scope calls resource matcher once per decision',()=>{
  let calls=0;
  assert.equal(evaluatePermission(layers(),'read','/safe',()=>{
    calls++;return true;
  }),true);
  assert.equal(calls,1);
});
test('an explicit deny overrides a grant in every other layer',()=>{
  const policy=layers();
  policy.actor.read.deny=['blocked'];
  assert.equal(evaluatePermission(policy,'read','/safe',(_p,_r,scope)=>scope==='blocked'),false);
});
test('reentrant matcher mutation cannot change snapshotted authority',()=>{
  const policy=layers();
  let calls=0;
  const allowed=evaluatePermission(policy,'read','/safe',()=>{
    calls++;policy.delegated.read.allow.length=0;return true;
  });
  assert.equal(allowed,true);
  assert.equal(calls,1);
});
test('nonboolean resource matcher is denied without coercion',()=>{
  assert.throws(()=>evaluatePermission(layers(),'read','/safe',()=>1),/resource matcher must return a boolean/);
});
