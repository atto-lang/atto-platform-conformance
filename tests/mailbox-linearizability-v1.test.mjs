import test from 'node:test';
import assert from 'node:assert/strict';
import {checkMailboxLinearizability as check, validateMailboxHistory,
  referenceTransition} from '../src/mailbox-linearizability-v1.mjs';
const schema='oreslang.mailbox_linearizability.v1';
const H=(events,capacity=1)=>({schema,capacity,events});
const e=(id,op,invoke,complete,result,ticket)=>({id,op,invoke,complete,result,
  ...(ticket===undefined?{}:{ticket})});
const status=(h,opts)=>check(h,opts).status;
const good=h=>assert.equal(status(h),'LINEARIZABLE');
const bad=h=>assert.equal(status(h),'NOT_LINEARIZABLE');

test('sequential FIFO acceptance, consumption and settlement yields a witness',()=>{
  const h=H([e('s','send',1,2,'ACCEPTED','x'),
    e('r','receive',3,4,'MESSAGE:x'),
    e('s2','send',5,6,'ACCEPTED','y'),
    e('r2','receive',7,8,'MESSAGE:y'),
    e('settle','settle',9,10,'SETTLED','x')]);
  const out=check(h);
  assert.deepEqual(out.witness,['s','r','s2','r2','settle']);
  assert.equal(out.nativeParityCertified,false);
  assert.equal(out.compiledGuestExecuted,false);
});

test('two overlapping sends with capacity 1 can have only one acceptance',()=>{
  good(H([e('a','send',1,4,'ACCEPTED','a'),e('b','send',2,3,'FULL','b')]));
  bad(H([e('a','send',1,4,'ACCEPTED','a'),e('b','send',2,3,'ACCEPTED','b')]));
});

test('happens-before ordering cannot be reinterpreted as overlap',()=>{
  bad(H([e('close','close',1,2,'CLOSED'),e('send','send',3,4,'ACCEPTED','a')]));
  good(H([e('send','send',1,4,'ACCEPTED','a'),e('close','close',2,3,'CLOSED')]));
});

test('close cancels queued messages; no phantom receive',()=>{
  good(H([e('send','send',1,2,'ACCEPTED','a'),e('close','close',3,4,'CLOSED'),
    e('cancel','cancel',5,6,'ALREADY_CANCELLED','a'),e('read','receive',7,8,'CLOSED')]));
  bad(H([e('send','send',1,2,'ACCEPTED','a'),e('close','close',3,4,'CLOSED'),
    e('read','receive',5,6,'MESSAGE:a')]));
});

test('cancel before consumption removes queued; consumed ticket is too late',()=>{
  good(H([e('send','send',1,2,'ACCEPTED','a'),e('cancel','cancel',3,4,'CANCELLED','a'),
    e('read','receive',5,6,'EMPTY')]));
  bad(H([e('send','send',1,2,'ACCEPTED','a'),e('cancel','cancel',3,4,'CANCELLED','a'),
    e('read','receive',5,6,'MESSAGE:a')]));
  good(H([e('send','send',1,2,'ACCEPTED','a'),e('read','receive',3,4,'MESSAGE:a'),
    e('cancel','cancel',5,6,'TOO_LATE','a'),e('end','settle',7,8,'SETTLED','a')]));
});

test('inflight ticket must physically settle even after mailbox close',()=>{
  good(H([e('send','send',1,2,'ACCEPTED','a'),e('recv','receive',3,4,'MESSAGE:a'),
    e('close','close',5,6,'CLOSED'),e('probe','probe',7,8,'BUSY'),
    e('end','settle',9,10,'SETTLED','a'),e('probe2','probe',11,12,'MAILBOX_DRAINED')]));
  bad(H([e('send','send',1,2,'ACCEPTED','a'),e('recv','receive',3,4,'MESSAGE:a'),
    e('close','close',5,6,'CLOSED'),e('probe','probe',7,8,'MAILBOX_DRAINED')]));
});

test('double settlement never reports two successes',()=>{
  bad(H([e('send','send',1,2,'ACCEPTED','a'),e('r','receive',3,4,'MESSAGE:a'),
    e('s1','settle',5,6,'SETTLED','a'),e('s2','settle',7,8,'SETTLED','a')]));
  good(H([e('send','send',1,2,'ACCEPTED','a'),e('r','receive',3,4,'MESSAGE:a'),
    e('s1','settle',5,6,'SETTLED','a'),e('s2','settle',7,8,'INVALID','a')]));
});

test('closure cannot be undone; fully drained closed mailbox stays closed',()=>{
  good(H([e('c','close',1,2,'CLOSED'),e('c2','close',3,4,'ALREADY_CLOSED'),
    e('s','send',5,6,'CLOSED','a'),e('r','receive',7,8,'CLOSED')]));
  bad(H([e('c','close',1,2,'CLOSED'),e('c2','close',3,4,'CLOSED')]));
});

test('unknown tickets and malformed operations fail safely',()=>{
  good(H([e('cancel','cancel',1,2,'UNKNOWN','missing'),e('settle','settle',3,4,'INVALID','missing')]));
  for(const mutation of [
    h=>h.schema='bad',h=>h.capacity=0,
    h=>h.events[0].op='arbitrary',h=>h.events[0].ticket='../escape',
    h=>h.events[0].result='ACCEPTED\nFAKE_PASS',
    h=>h.events[0].secret='copy private data',
    h=>h.events[0].complete=h.events[0].invoke,
    h=>h.events.push(e('dup','send',3,4,'FULL','a')),
    h=>h.events.push(e('dup','send',1,3,'FULL','b')),
    h=>h.events[0].id='\u202e',
    h=>h.events[0].result=true
  ]) {
    const h=H([e('send','send',1,2,'ACCEPTED','a')]);mutation(h);
    assert.throws(()=>validateMailboxHistory(h),/INVALID_MAILBOX_HISTORY/);
  }
});

test('bounded state budget reports inconclusive, never invalid or PASS',()=>{
  const h=H([e('a','cancel',1,16,'UNKNOWN','a'),e('b','cancel',2,17,'UNKNOWN','b'),
    e('c','cancel',3,18,'UNKNOWN','c'),e('d','cancel',4,19,'UNKNOWN','d'),
    e('e','cancel',5,20,'UNKNOWN','e')]);
  assert.equal(status(h,{maxStates:1}),'INCONCLUSIVE');
  assert.equal(status(h),'LINEARIZABLE');
});

test('all short sequential operation transitions are reproducibly linearizable',()=>{
  const ops=[{op:'send',ticket:'a'},{op:'send',ticket:'b'},
    {op:'receive'},{op:'close'},{op:'cancel',ticket:'a'},
    {op:'settle',ticket:'a'},{op:'probe'}];
  let cases=0;
  function enumerate(state,depth,history,used){
    if(depth){ good(H(history));cases++; }
    if(depth===4)return;
    for(let i=0;i<ops.length;i++){
      if(used.has(i))continue;
      const op=ops[i];
      const {state:next,result}=referenceTransition(state,op,1);
      const t=depth*2+1;
      enumerate(next,depth+1,[...history,e('o'+i,op.op,t,t+1,result,op.ticket)],
        new Set([...used,i]));
    }
  }
  enumerate({open:true,queue:[],inflight:[],states:{}},0,[],new Set());
  assert.equal(cases,1099); // 7P1 + 7P2 + 7P3 + 7P4
});
