import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyUntrustedCheckpointCFG as verify} from '../src/untrusted-checkpoint-cfg.mjs';

const b = (id, next=[], extra={}) => ({id,next,...extra});
const g = (blocks,entry='entry') => ({blocks,entry});
const admit = graph => assert.equal(verify(graph).decision,'ADMIT');
const deny = (graph,reason) => assert.equal(verify(graph).reason,reason);

test('straight-line guest code needs no periodic backedge charge',()=>{
  assert.deepEqual(verify(g([b('entry',['ret']),b('ret')])),
    {decision:'ADMIT',reason:'every-reachable-cycle-is-hard-fuel-metered',reachableBlocks:2});
});
test('one committed hard fuel charge on the sole loop cycle admits',()=>{
  admit(g([b('entry',['head']),b('head',['body','exit']),
    b('body',['tick']),b('tick',['head'],{fuelCharge:true,postCommit:true}),b('exit')]));
});
test('a soft rt cooperate checkpoint is NOT untrusted hard fuel',()=>{
  deny(g([b('entry',['loop']),b('loop',['loop'],{softPoll:true})]),
    'cycle-without-hard-fuel');
});
test('an unreachable hard-fuel block does not certify a live loop',()=>{
  deny(g([b('entry',['loop']),b('loop',['loop']),
    b('dead',['loop'],{fuelCharge:true,postCommit:true})]),'cycle-without-hard-fuel');
});
test('metered entry cannot conceal a downstream unmetered cycle',()=>{
  deny(g([b('entry',['loop'],{fuelCharge:true,postCommit:true}),b('loop',['loop'])]),
    'cycle-without-hard-fuel');
});
test('a loop with a bypass path around its fuel charge is rejected',()=>{
  const result = verify(g([b('entry',['head']),b('head',['meter','bypass']),
    b('meter',['head'],{fuelCharge:true,postCommit:true}),b('bypass',['head'])]));
  assert.equal(result.reason,'cycle-without-hard-fuel');
  assert.deepEqual(result.cycle,['head','bypass','head']);
});
test('nested loops are independently metered or rejected',()=>{
  deny(g([b('entry',['outer']),b('outer',['inner','exit']),
    b('inner',['inner','outer'],{softPoll:true}),b('exit')]),'cycle-without-hard-fuel');
  // A meter on the inner loop alone is not sufficient: the outer
  // exit/reentry cycle has a separate path that can bypass it.
  deny(g([b('entry',['outer']),b('outer',['inner','exit']),
    b('inner',['inner-meter','outer']),
    b('inner-meter',['inner'],{fuelCharge:true,postCommit:true}),b('exit')]),
    'cycle-without-hard-fuel');
  admit(g([b('entry',['outer']),b('outer',['inner','exit']),
    b('inner',['inner-meter','outer-meter']),
    b('inner-meter',['inner'],{fuelCharge:true,postCommit:true}),
    b('outer-meter',['outer'],{fuelCharge:true,postCommit:true}),
    b('exit')]));
});
test('direct mutual recursion is a cycle; metered call boundary admits',()=>{
  deny(g([b('entry',[],{calls:['a']}),b('a',[],{calls:['b']}),
    b('b',[],{calls:['a']})]),'cycle-without-hard-fuel');
  admit(g([b('entry',[],{calls:['a']}),b('a',[],{calls:['fuel']}),
    b('fuel',[],{calls:['b'],fuelCharge:true,postCommit:true}),
    b('b',[],{calls:['a']})]));
});
test('uncertified indirect calls fail closed and resolved recursion is metered',()=>{
  deny(g([b('entry',[],{indirectCall:true})]),'unresolved-indirect-call');
  deny(g([b('entry',[],{indirectCall:true,indirectTargets:['entry']})]),
    'cycle-without-hard-fuel');
  admit(g([b('entry',['meter'],{indirectCall:true,indirectTargets:['meter']}),
    b('meter',['entry'],{fuelCharge:true,postCommit:true})]));
});
test('unsafe FFI fails closed even if every CFG cycle has hard fuel',()=>{
  deny(g([b('entry',['ffi']),b('ffi',[],{foreign:'unisolated'})]),
    'unisolated-foreign-call');
  deny(g([b('entry',['ffi']),b('ffi',[],{foreign:'revocable'})]),
    'foreign-revocation-not-bounded');
  admit(g([b('entry',['ffi']),b('ffi',[],{foreign:'revocable',revocationBoundMs:1000})]));
  admit(g([b('entry',['ffi']),b('ffi',[],{foreign:'bounded'})]));
});
test('a declared charge before side-effect commit is rejected',()=>{
  deny(g([b('entry',['loop']),b('loop',['loop'],{fuelCharge:true})]),
    'fuel-charge-not-post-commit');
});
test('unreachable invalid native call is not a live-execution blocker',()=>{
  admit(g([b('entry',['ret']),b('ret'),b('dead',[],{foreign:'unisolated'})]));
});
test('deep reachable CFG is verified iteratively with no JS recursion DoS',()=>{
  const blocks = Array.from({length:3000},(_,i)=>b('n'+i,i===2999?['n0']:['n'+(i+1)],
    i===1500?{fuelCharge:true,postCommit:true}:{}));
  admit(g(blocks,'n0'));
  blocks[1500] = b('n1500',['n1501']);
  deny(g(blocks,'n0'),'cycle-without-hard-fuel');
});
test('malformed, ambiguous and oversized compiler CFGs are rejected structurally',()=>{
  for(const graph of [null,{},g([]),g([b('entry',['missing'])]),
    g([b('entry'),b('entry')]),g([b('entry',[],{fuelCharge:'true'})]),
    g([b('entry',[],{indirectCall:1})]),g([b('entry',[],{foreign:'trusted'})]),
    g([b('entry',[],{foreign:'revocable',revocationBoundMs:-1})]),
    g(Array.from({length:4097},(_,i)=>b('b'+i)),'b0')]) {
    assert.throws(()=>verify(graph),TypeError);
  }
});
