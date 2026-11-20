import test from 'node:test';
import assert from 'node:assert/strict';
import { ActorStepWorkflowModel, admitStepPlan } from '../src/actor-step-workflow-model.mjs';

const plan={start:'validate',nodes:{
  validate:{kind:'task',worker:'validator',next:'route',maxAttempts:2},
  route:{kind:'choice',routes:{approved:'both'},otherwise:'failure'},
  both:{kind:'parallel',branches:['reserve','invoice'],next:'approval'},
  reserve:{kind:'task',worker:'inventory',next:null,maxAttempts:2},
  invoice:{kind:'task',worker:'invoicer',next:null,maxAttempts:1},
  approval:{kind:'wait',signal:'accept',authority:'reviewer-capability',next:'success'},
  success:{kind:'succeed'},failure:{kind:'fail'}
}};
const msg=(id,type,extra={})=>({id,type,tenantId:'tenant-a',runId:'run-a',...extra});
const init=(p=plan)=>{const m=new ActorStepWorkflowModel({plan:p,tenantId:'tenant-a',runId:'run-a'});return [m,m.activate()];};
const send=(m,e,x,opts)=>{m.enqueue(x);return m.apply(e,x.id,opts);};
const result=(m,e,id,node,attempt,outcome='ok',tag='approved',receipt='receipt')=>send(m,e,msg(id,'task_result',{
  nodeId:node,key:`tenant-a/run-a/${node}/${attempt}`,worker:plan.nodes[node].worker,outcome,tag,receipt}));
const start=(m,e)=>send(m,e,msg('begin','start'));

test('sequential actor step, choice, parallel fan-out and exact join, then authorized approval',()=>{
  const [m,e]=init();start(m,e);
  assert.deepEqual(Object.keys(m.snapshot().state.pending),['validate']);
  result(m,e,'validated','validate',1);
  assert.deepEqual(Object.keys(m.snapshot().state.pending).sort(),['invoice','reserve']);
  result(m,e,'reserved','reserve',1);
  assert.equal(m.snapshot().state.status,'RUNNING');
  result(m,e,'invoiced','invoice',1);
  assert.equal(m.snapshot().state.status,'WAITING');
  assert.equal(m.snapshot().state.current,'approval');
  assert.throws(()=>send(m,e,msg('forged','signal',{nodeId:'approval',signal:'accept',authority:'anon'})),/UNAUTHORIZED_SIGNAL/);
  assert.equal(m.snapshot().state.status,'WAITING');
  send(m,e,msg('allow','signal',{nodeId:'approval',signal:'accept',authority:'reviewer-capability'}));
  assert.equal(m.snapshot().state.status,'COMPLETED');
  assert.equal(Object.values(m.snapshot().outbox).filter(x=>x.kind==='spawn_step_actor').length,3);
});

test('failed step retries once with a distinct durable intent, then fails closed',()=>{
  const [m,e]=init();start(m,e);
  result(m,e,'bad1','validate',1,'error','bad','receipt-1');
  assert.equal(m.snapshot().state.pending.validate.attempt,2);
  assert.equal(m.snapshot().outbox['tenant-a/run-a/validate/1'].status,'acknowledged');
  result(m,e,'bad2','validate',2,'error','bad','receipt-2');
  assert.equal(m.snapshot().state.status,'FAILED');
});

test('stale attempts never advance or create a duplicate child effect',()=>{
  const [m,e]=init();start(m,e);
  result(m,e,'bad1','validate',1,'error','bad','receipt-1');
  assert.equal(result(m,e,'duplicate-new-id','validate',1,'error','bad','receipt-1'),true);
  assert.equal(m.snapshot().state.pending.validate.attempt,2);
  assert.throws(()=>result(m,e,'conflict','validate',1,'ok','approved','different'),/RECEIPT_CONFLICT/);
  assert.throws(()=>result(m,e,'same-receipt-changed-result','validate',1,'ok','approved','receipt-1'),/RECEIPT_CONFLICT/);
  assert.equal(m.snapshot().state.pending.validate.attempt,2);
});

test('crash before commit keeps inbox, state and outbox intact; one replay commit',()=>{
  const [m,e]=init();const x=msg('begin','start');m.enqueue(x);
  assert.throws(()=>m.apply(e,x.id,{crashBeforeCommit:true}),/SIMULATED_CRASH/);
  assert.equal(m.snapshot().state.status,'CREATED');
  assert.deepEqual(m.snapshot().outbox,{});
  assert.equal(m.apply(e,x.id),true);
  assert.equal(m.apply(e,x.id),false);
  assert.equal(m.snapshot().version,1);
});

test('freeze and restore fences old activation; pending child intent is preserved',()=>{
  const [m,e]=init();start(m,e);const frozen=m.freeze(e);
  const restored=new ActorStepWorkflowModel({plan,tenantId:'tenant-a',runId:'run-a',store:frozen});
  const e2=restored.activate();assert.ok(e2>e);
  assert.throws(()=>restored.apply(e,'begin'),/STALE_ACTIVATION_EPOCH/);
  assert.equal(restored.snapshot().outbox['tenant-a/run-a/validate/1'].status,'pending');
  result(restored,e2,'validated','validate',1);
  assert.equal(restored.snapshot().state.current,'both');
});

test('tampered snapshot and changed code/graph require explicit migration',()=>{
  const [m,e]=init();start(m,e);const s=m.freeze(e);s.state.status='COMPLETED';
  assert.throws(()=>new ActorStepWorkflowModel({plan,tenantId:'tenant-a',runId:'run-a',store:s}),/CORRUPT_SNAPSHOT/);
  const s2=m.snapshot();const alt=structuredClone(plan);alt.nodes.validate.maxAttempts=3;
  assert.throws(()=>new ActorStepWorkflowModel({plan:alt,tenantId:'tenant-a',runId:'run-a',store:s2}),/INCOMPATIBLE_SNAPSHOT/);
});

test('parallel failure emits cancellation requests and never reaches join',()=>{
  const [m,e]=init();start(m,e);result(m,e,'valid','validate',1);
  result(m,e,'failed-invoice','invoice',1,'error','bad','receipt-invoice');
  const s=m.snapshot();assert.equal(s.state.status,'FAILED');
  assert.equal(s.outbox['tenant-a/run-a/cancel/reserve/1'].kind,'cancel_step_actor');
  assert.equal(s.state.pending.reserve,undefined);
  assert.throws(()=>result(m,e,'late','reserve',1),/STALE_TASK_RESULT/);
});

test('cancel requires owner authority and does not claim physical cancellation',()=>{
  const [m,e]=init();start(m,e);
  assert.throws(()=>send(m,e,msg('bad-cancel','cancel',{authority:'visitor'})),/UNAUTHORIZED_CANCEL/);
  send(m,e,msg('cancel','cancel',{authority:'workflow-owner'}));
  assert.equal(m.snapshot().state.status,'CANCELLED');
  assert.ok(m.snapshot().outbox['tenant-a/run-a/cancel/validate/1']);
});

test('other tenants, reused message IDs and proto keys cannot bypass admission',()=>{
  const [m,e]=init();
  assert.throws(()=>m.enqueue({...msg('x','start'),tenantId:'other'}),/WRONG_RUN/);
  const first=msg('__proto__','start');m.enqueue(first);
  assert.equal(m.enqueue(first),false);
  assert.throws(()=>m.enqueue(msg('__proto__','cancel',{authority:'workflow-owner'})),/DELIVERY_CONFLICT/);
  assert.equal(m.apply(e,'__proto__'),true);
  assert.equal(m.snapshot().state.status,'RUNNING');
  assert.equal(m.enqueue(first),false);
});

test('bad graph: cycles, orphan branches, wrong targets, unbounded retries and reachable confusion',()=>{
  const bads=[
    {start:'a',nodes:{a:{kind:'task',worker:'w',next:'a',maxAttempts:1}}},
    {start:'a',nodes:{a:{kind:'task',worker:'w',next:'missing',maxAttempts:1}}},
    {start:'a',nodes:{a:{kind:'task',worker:'w',next:null,maxAttempts:99}}},
    {start:'cancel/foo',nodes:{'cancel/foo':{kind:'succeed'}}},
    {start:'a',nodes:{a:{kind:'succeed'},b:{kind:'fail'}}},
    {start:'a',nodes:{a:{kind:'parallel',branches:['b','c'],next:'done'},b:{kind:'task',worker:'w',next:'done',maxAttempts:1},c:{kind:'task',worker:'w',next:null,maxAttempts:1},done:{kind:'succeed'}}}
  ];
  for(const p of bads) assert.throws(()=>admitStepPlan(p));
});

test('choice default routes to terminal fail without executing other actor steps',()=>{
  const [m,e]=init();start(m,e);result(m,e,'deny','validate',1,'ok','denied');
  assert.equal(m.snapshot().state.status,'FAILED');
  assert.equal(Object.keys(m.snapshot().outbox).length,1);
});

test('read-only model records distinct intent and receipt, not executed external effects',()=>{
  const [m,e]=init();start(m,e);
  assert.equal(m.snapshot().outbox['tenant-a/run-a/validate/1'].status,'pending');
  result(m,e,'valid','validate',1);
  assert.equal(m.snapshot().outbox['tenant-a/run-a/validate/1'].status,'acknowledged');
  assert.equal(m.snapshot().outbox['tenant-a/run-a/validate/1'].receipt,'receipt');
});


test('parallel joins choose a deterministic tag independent of completion order',()=>{
  const p={start:'fork',nodes:{
    fork:{kind:'parallel',branches:['a','b'],next:'decision'},
    a:{kind:'task',worker:'one',next:null,maxAttempts:1},
    b:{kind:'task',worker:'two',next:null,maxAttempts:1},
    decision:{kind:'choice',routes:{joined:'end'},otherwise:'bad'},
    end:{kind:'succeed'},bad:{kind:'fail'}
  }};
  for(const order of [['a','b'],['b','a']]) {
    const [m,e]=init(p);start(m,e);
    for(let i=0;i<order.length;i++) {
      const node=order[i];
      send(m,e,msg(`result-${i}`,'task_result',{
        nodeId:node,key:`tenant-a/run-a/${node}/1`,worker:p.nodes[node].worker,
        outcome:'ok',tag:i===0?'different':'another',receipt:`r-${i}`}));
    }
    assert.equal(m.snapshot().state.status,'COMPLETED');
  }
});

test('unexpected persisted credentials and oversized payloads are rejected at inbox admission',()=>{
  const [m]=init();
  assert.throws(()=>m.enqueue(msg('m1','start',{secret:'should-not-persist'})),/UNKNOWN_FIELD/);
  assert.throws(()=>m.enqueue(msg('m2','signal',{nodeId:'approval',signal:'accept',authority:'a'.repeat(5000)})),/MESSAGE_TOO_LARGE/);
  assert.deepEqual(m.snapshot().inbox,{});
});


test('model has no public commit, plan or database mutation authority',()=>{
  const [m,e]=init();
  assert.equal(m.commit,undefined);
  assert.equal(m.plan,undefined);
  assert.equal(m.db,undefined);
  const admitted=admitStepPlan(plan);
  assert.ok(Object.isFrozen(admitted.nodes.validate));
  assert.ok(Object.isFrozen(admitted.nodes.both.branches));
  assert.throws(()=>{admitted.nodes.validate.worker='attacker';},TypeError);
  assert.throws(()=>{admitted.nodes.both.branches[0]='attacker';},TypeError);
  const tampered=m.snapshot();
  tampered.state.status='COMPLETED';tampered.outbox['injected']={kind:'spawn_step_actor'};
  assert.equal(m.snapshot().state.status,'CREATED');
  assert.deepEqual(m.snapshot().outbox,{});
  start(m,e);assert.equal(m.snapshot().state.status,'RUNNING');
});

test('run IDs with separators cannot ambiguously alias intent keys',()=>{
  for(const id of ['/a','a/b','a:b','a b','', 'a'.repeat(65)]) {
    assert.throws(()=>new ActorStepWorkflowModel({plan,tenantId:'tenant-a',runId:id}),/BAD_RUN_ID/);
  }
  const [m,e]=init();start(m,e);
  assert.ok(m.snapshot().outbox['tenant-a/run-a/validate/1']);
});

test('identical result redelivery consumes inbox but cannot manufacture state transitions',()=>{
  const [m,e]=init();start(m,e);
  result(m,e,'first','validate',1);
  const before=m.snapshot();
  result(m,e,'other-delivery','validate',1);
  const after=m.snapshot();
  assert.equal(after.version,before.version);
  assert.equal(after.events.length,before.events.length);
  assert.deepEqual(after.state,before.state);
  assert.ok(Object.hasOwn(after.seen,'other-delivery'));
  assert.throws(()=>result(m,e,'conflicting-outcome','validate',1,'error','bad','receipt'),/RECEIPT_CONFLICT/);
});

test('simulation of crash during duplicate receipt leaves inbox for safe replay',()=>{
  const [m,e]=init();start(m,e);
  result(m,e,'first','validate',1);
  const previous=m.snapshot();
  const dup=msg('redelivery','task_result',{
    nodeId:'validate',key:'tenant-a/run-a/validate/1',worker:'validator',
    outcome:'ok',tag:'approved',receipt:'receipt'
  });
  m.enqueue(dup);
  assert.throws(()=>m.apply(e,dup.id,{crashBeforeCommit:true}),/SIMULATED_CRASH/);
  assert.ok(Object.hasOwn(m.snapshot().inbox,dup.id));
  assert.equal(m.snapshot().version,previous.version);
  assert.equal(m.apply(e,dup.id),true);
  assert.equal(m.snapshot().version,previous.version);
});


test('reject malformed task receipts and approval envelopes before durable inbox admission',()=>{
  const [m]=init();
  const bad=[
    msg('no-node','task_result',{key:'tenant-a/run-a/validate/1',worker:'validator',outcome:'ok',tag:'approved',receipt:'r'}),
    msg('bad-outcome','task_result',{nodeId:'validate',key:'tenant-a/run-a/validate/1',worker:'validator',outcome:'unknown',tag:'approved',receipt:'r'}),
    msg('bad-receipt','task_result',{nodeId:'validate',key:'tenant-a/run-a/validate/1',worker:'validator',outcome:'ok',tag:'approved',receipt:''}),
    msg('bad-signal','signal',{nodeId:'approval',signal:'accept',authority:''}),
    msg('bad-cancel','cancel',{authority:''})
  ];
  for(const entry of bad) assert.throws(()=>m.enqueue(entry),/BAD_TASK_RESULT|BAD_SIGNAL|BAD_CANCEL/);
  assert.deepEqual(m.snapshot().inbox,{});
});


test('tenant identity is included in all durable intent keys',()=>{
  const [a,epochA]=init();start(a,epochA);
  const b=new ActorStepWorkflowModel({plan,tenantId:'tenant-b',runId:'run-a'});
  const epochB=b.activate();
  b.enqueue({id:'begin',type:'start',tenantId:'tenant-b',runId:'run-a'});
  b.apply(epochB,'begin');
  const first=Object.keys(a.snapshot().outbox)[0];
  const second=Object.keys(b.snapshot().outbox)[0];
  assert.equal(first,'tenant-a/run-a/validate/1');
  assert.equal(second,'tenant-b/run-a/validate/1');
  assert.ok(first!==second);
});
