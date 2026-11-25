import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableDevLoopModel } from '../src/durable-dev-loop-model.mjs';

const msg=(id,type,extras={})=>({id,type,tenantId:'t',runId:'r',...extras});
const init=()=>{const m=new DurableDevLoopModel({tenantId:'t',runId:'r'});return [m,m.activate()];};
const step=(m,epoch,message,options)=>{m.enqueue(message);return m.apply(epoch,message.id,options);};
const push=(m,e,i,sha)=>step(m,e,msg('push-'+i,'code_pushed',{sha}));
const webhook=(m,e,i,sha,id='webhook-'+i)=>step(m,e,msg(id,'github_push',{sha,iteration:i,ref:'refs/heads/dev',expectedRef:'refs/heads/dev'}));

test('crash before commit leaves inbox and state intact; replay commits once',()=>{
  const [m,e]=init(); const p=msg('push-1','code_pushed',{sha:'abc'});
  assert.equal(m.enqueue(p),true);
  assert.throws(()=>m.apply(e,p.id,{crashBeforeCommit:true}),/SIMULATED_CRASH/);
  assert.equal(m.snapshot().state.iteration,0);
  assert.ok(m.snapshot().inbox[p.id]);
  assert.equal(m.apply(e,p.id),true);
  assert.equal(m.apply(e,p.id),false);
  assert.equal(m.snapshot().state.iteration,1);
  assert.equal(m.snapshot().version,1);
});

test('freeze/reactivate retains pending inbox/outbox, rejects stale worker writes',()=>{
  const [m,e]=init();
  push(m,e,1,'abc');webhook(m,e,1,'abc');
  const key='r:test:1:abc';
  assert.equal(m.snapshot().outbox[key].status,'pending');
  const db=m.freeze(e);
  m.enqueue(msg('pending-test','tests_failed',{sha:'abc',iteration:1,fingerprint:'race'}));
  const rebooted=new DurableDevLoopModel({store:m.snapshot()});
  const e2=rebooted.activate();
  assert.ok(e2>e);
  assert.throws(()=>rebooted.apply(e,'pending-test'),/STALE_ACTIVATION_EPOCH/);
  assert.equal(rebooted.apply(e2,'pending-test'),true);
  assert.equal(rebooted.snapshot().state.stage,'editing');
  assert.equal(rebooted.snapshot().outbox[key].status,'pending');
  assert.equal(rebooted.acknowledge(e2,key,'gha-run-123'),true);
  assert.equal(rebooted.acknowledge(e2,key,'gha-run-123'),false);
  assert.equal(db.active,false);
});

test('unrelated tenants and duplicate delivery IDs fail closed',()=>{
  const [m,e]=init();
  assert.throws(()=>m.enqueue({id:'x',type:'code_pushed',tenantId:'other',runId:'r'}),/WRONG_ACTOR/);
  assert.equal(m.enqueue(msg('p','code_pushed',{sha:'abc'})),true);
  assert.equal(m.enqueue(msg('p','code_pushed',{sha:'different'})),false);
  assert.equal(m.apply(e,'p'),true);
  assert.equal(m.enqueue(msg('p','code_pushed',{sha:'different'})),false);
});

test('stale/out-of-order webhooks and tests cannot advance iteration',()=>{
  const [m,e]=init();push(m,e,1,'abc');
  webhook(m,e,1,'wrong','old');webhook(m,e,0,'abc','wrong-iteration');
  step(m,e,msg('spoofed-ref','github_push',{sha:'abc',iteration:1,ref:'refs/heads/main',expectedRef:'refs/heads/main'}));
  assert.equal(m.snapshot().state.stage,'waiting_webhook');
  assert.equal(Object.keys(m.snapshot().outbox).length,0);
  webhook(m,e,1,'abc');
  step(m,e,msg('test-old','tests_passed',{sha:'wrong',iteration:1}));
  assert.equal(m.snapshot().state.stage,'testing');
  assert.equal(Object.keys(m.snapshot().outbox).length,1);
});

test('same failure fingerprint creates one logical bug intent and pauses after three attempts',()=>{
  const [m,e]=init();
  for(let i=1;i<=3;i++){
    push(m,e,i,'sha'+i);webhook(m,e,i,'sha'+i);
    step(m,e,msg('fail-'+i,'tests_failed',{sha:'sha'+i,iteration:i,fingerprint:'same-race'}));
  }
  assert.equal(m.snapshot().state.stage,'paused');
  assert.equal(m.snapshot().state.unchangedFailures,3);
  assert.equal(Object.values(m.snapshot().outbox).filter(x=>x.kind==='bug_report').length,1);
  assert.throws(()=>push(m,e,4,'sha4'),/UNEXPECTED_PUSH/);
});

test('success requires human review, never auto-merges',()=>{
  const [m,e]=init();push(m,e,1,'abc');webhook(m,e,1,'abc');
  step(m,e,msg('pass-1','tests_passed',{sha:'abc',iteration:1}));
  assert.equal(m.snapshot().state.stage,'awaiting_review');
  assert.deepEqual(Object.values(m.snapshot().outbox).map(x=>x.kind).sort(),['request_review','test_run']);
});

test('incompatible snapshot fails before reactivation',()=>{
  const [m,e]=init();m.freeze(e);
  const s=m.snapshot();s.stateSchemaVersion=900;
  assert.throws(()=>new DurableDevLoopModel({store:s}),/INCOMPATIBLE_SNAPSHOT/);
});

test('iteration budget enforces a hard stop',()=>{
  const m=new DurableDevLoopModel({tenantId:'t',runId:'r',maxIterations:1});const e=m.activate();
  push(m,e,1,'abc');webhook(m,e,1,'abc');
  step(m,e,msg('fail','tests_failed',{sha:'abc',iteration:1,fingerprint:'err'}));
  assert.throws(()=>push(m,e,2,'def'),/ITERATION_BUDGET_EXHAUSTED/);
});


test('reserved object property IDs cannot bypass deduplication or mutate dictionary prototypes',()=>{
  const [m,e]=init();
  assert.throws(()=>m.apply(e,'constructor'),/UNKNOWN_INBOX_MESSAGE/);
  const p=msg('__proto__','code_pushed',{sha:'abc'});
  assert.equal(m.enqueue(p),true);
  assert.equal(m.apply(e,'__proto__'),true);
  assert.equal(m.apply(e,'__proto__'),false);
  assert.equal(m.enqueue(p),false);
  assert.equal(m.snapshot().state.iteration,1);
  assert.equal(Object.hasOwn(m.snapshot().seen,'__proto__'),true);
  assert.equal(Object.getPrototypeOf(m.snapshot().state),Object.prototype);
});

test('receipt replay must match first durable receipt exactly',()=>{
  const [m,e]=init();
  push(m,e,1,'abc');webhook(m,e,1,'abc');
  const key='r:test:1:abc';
  assert.equal(m.acknowledge(e,key,'gha-run-1'),true);
  assert.equal(m.acknowledge(e,key,'gha-run-1'),false);
  assert.throws(()=>m.acknowledge(e,key,'gha-run-2'),/RECEIPT_CONFLICT/);
  assert.equal(m.snapshot().outbox[key].receipt,'gha-run-1');
});

test('malformed persisted epoch, code generation and actor identity quarantine on restore',()=>{
  const [m,e]=init();m.freeze(e);
  for(const field of ['epoch','version']) {
    const snapshot=m.snapshot();snapshot[field]=-1;
    assert.throws(()=>new DurableDevLoopModel({store:snapshot}),/CORRUPT_SNAPSHOT/);
  }
  const snapshot=m.snapshot();snapshot.codeGeneration='unreviewed-new-runtime';
  assert.throws(()=>new DurableDevLoopModel({store:snapshot}),/CORRUPT_SNAPSHOT/);
  const bad=m.snapshot();bad.state.expectedRef='refs/heads/main';
  assert.throws(()=>new DurableDevLoopModel({store:bad}),/CORRUPT_SNAPSHOT/);
  const missing=m.snapshot();delete missing.nodeId;
  assert.throws(()=>new DurableDevLoopModel({store:missing}),/CORRUPT_SNAPSHOT/);
});

test('blank IDs and mismatched tenant identities reject before inbox mutation',()=>{
  const [m]=init();
  assert.throws(()=>m.enqueue(msg('  ','code_pushed',{sha:'abc'})),/BAD_MESSAGE/);
  assert.throws(()=>m.enqueue(msg('evil','code_pushed',{sha:'abc',tenantId:'other'})),/WRONG_ACTOR/);
  assert.equal(Object.keys(m.snapshot().inbox).length,0);
});
