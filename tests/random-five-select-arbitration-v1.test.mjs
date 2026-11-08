import test from 'node:test';
import assert from 'node:assert/strict';
import {ReferenceSelectArbiter as Select} from '../src/random-five-select-arbitration-v1.mjs';
test('one winner commits and all other reservations rollback exactly once',()=>{
 const s=new Select(['in','timer','message']);
 s.offer('in','t1','a');s.offer('timer','t2','b');s.offer('message','t3','c');
 assert.equal(s.commit('t2').status,'COMMITTED');
 assert.equal(s.snapshot().state,'COMMITTED');assert.equal(s.snapshot().reserved,0);
 assert.deepEqual([s.takeRollback().token,s.takeRollback().token],['t1','t3']);
 assert.equal(s.takeRollback().status,'EMPTY');assert.equal(s.commit('t1').status,'REJECTED');
});
test('cancel before commit returns all reservations and no winner',()=>{
 const s=new Select(['a','b']);s.offer('a','t1',1);s.offer('b','t2',2);
 assert.equal(s.cancel().status,'CANCELLED');
 assert.equal(s.snapshot().winner,null);assert.equal(s.snapshot().rollbackPending,2);
 assert.equal(s.commit('t1').diagnostic,'SELECT_ALREADY_TERMINAL');
});
test('timeout release uses same exactly-once rollback path',()=>{
 const s=new Select(['a','b']);s.offer('a','t1',1);s.offer('b','t2',2);
 assert.equal(s.cancel('TIMEOUT').status,'TIMEOUT');
 assert.equal(s.takeRollback().status,'ROLLED_BACK');
 assert.equal(s.takeRollback().status,'ROLLED_BACK');
 assert.equal(s.takeRollback().status,'EMPTY');
});
test('commit wins only if operation is open and token reserved',()=>{
 const s=new Select(['a','b']);
 assert.equal(s.commit('missing').diagnostic,'UNKNOWN_RESERVATION');
 s.offer('a','t1',1);assert.equal(s.commit('t1').status,'COMMITTED');
 assert.equal(s.cancel().diagnostic,'SELECT_ALREADY_TERMINAL');
});
test('duplicate tokens and duplicate branch operations rejected',()=>{
 const s=new Select(['a','b']);s.offer('a','t1',1);
 assert.equal(s.offer('b','t1',2).status,'REJECTED');
 assert.equal(s.offer('a','t2',2).status,'REJECTED');
 assert.equal(s.snapshot().reserved,1);
});
test('one winner invariant across all three branch commit orders',()=>{
 for(const winner of ['a','b','c']){
  const s=new Select(['a','b','c']);
  for(const branch of ['a','b','c'])s.offer(branch,'t'+branch,branch);
  assert.equal(s.commit('t'+winner).branch,winner);
  assert.equal(s.snapshot().rollbackPending,2);
  assert.equal(s.snapshot().winner.token,'t'+winner);
 }
});
test('cancel/commit order is deterministic and never double commits',()=>{
 for(const first of ['cancel','commit']){
  const s=new Select(['a','b']);s.offer('a','one',1);s.offer('b','two',2);
  if(first==='cancel'){s.cancel();assert.equal(s.commit('one').status,'REJECTED');assert.equal(s.snapshot().winner,null);}
  else {s.commit('one');assert.equal(s.cancel().status,'REJECTED');assert.equal(s.snapshot().winner.token,'one');}
 }
});
test('invalid branches and nonserializable messages fail closed',()=>{
 for(const branches of [[],['a'],['a','a'],['a','bad space']])assert.throws(()=>new Select(branches),/INVALID_SELECT_BRANCHES/);
 const s=new Select(['a','b']);
 assert.equal(s.offer('a','x',()=>0).status,'REJECTED');
 assert.equal(s.offer('c','x',1).status,'REJECTED');
 assert.equal(s.cancel('UNKNOWN').status,'REJECTED');assert.equal(s.snapshot().state,'OPEN');
});
test('terminal state cannot accept late offers and stale token replay',()=>{
 const s=new Select(['a','b']);s.offer('a','t1',1);s.cancel();
 assert.equal(s.offer('b','t2',2).diagnostic,'SELECT_ALREADY_TERMINAL');
 assert.equal(s.commit('t1').diagnostic,'SELECT_ALREADY_TERMINAL');
});
test('snapshot does not expose mutable reservation map',()=>{
 const s=new Select(['a','b']);s.offer('a','t1',1);
 const r=s.snapshot();assert.equal(Object.isFrozen(r),true);
 assert.equal('tokens' in r,false);
});
test('reference arbitration is not actual carrier scheduling proof',()=>{
 const s=new Select(['a','b']);assert.equal(s.snapshot().state,'OPEN');
 assert.equal('guestExecution' in s.snapshot(),false);
});
