import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {BatchPersistenceSidecar} from './sidecar.mjs';
import {PolicyActorReference} from './policy-modes.mjs';

function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'ores-policy-sqlite-'));
  const path=join(dir,'state.sqlite');
  return {
    open:()=>new BatchPersistenceSidecar({path,tenantId:'tenant-a'}),
    close:()=>rmSync(dir,{recursive:true,force:true})
  };
}
const create=(io, policy, extra={})=>new PolicyActorReference({
  sidecar:io, tenantId:'tenant-a',actor:'counter',stateName:'main',
  initialState:{count:0},epoch:1,policy,...extra
});
const read=(actor)=>actor.handle_state('critical-read',s=>s.count);

test('real SQLite snapshot: committed survives closing DB; admitted-only is lost',()=>{
  const f=fixture();
  try {
    let db=f.open();
    db.grantEpoch({tenantId:'tenant-a',actor:'counter',epoch:1});
    let actor=create(db,'#snapshot');
    assert.equal(actor.stage_snapshot('committed',s=>{s.count=42;}).durable,false);
    assert.equal(read(actor),0);
    actor.apply_commit(db.flush()[0]);
    assert.equal(read(actor),42);
    db.close();
    db=f.open();
    actor=create(db,'#snapshot');
    actor.restore();
    assert.equal(read(actor),42);
    assert.equal(actor.version,1);
    assert.equal(actor.stage_snapshot('not-flushed',s=>{s.count=99;}).status,'admitted');
    db.close(); // Simulates loss of admitted-only in-memory queue.
    db=f.open();
    const restarted=create(db,'#snapshot');
    restarted.restore();
    assert.equal(read(restarted),42);
    assert.equal(restarted.version,1);
    db.close();
  } finally {f.close();}
});

test('real SQLite event sourcing: replay confirmed journal after actor restart',()=>{
  const f=fixture(), reducer=(state,event)=>({count:state.count+event.delta});
  try {
    let db=f.open();
    db.grantEpoch({tenantId:'tenant-a',actor:'counter',epoch:1});
    let actor=create(db,'#event_sourced',{reducer});
    actor.stage_event('ev1',{delta:3});
    actor.apply_commit(db.flush()[0]);
    actor.stage_event('ev2',{delta:8});
    actor.apply_commit(db.flush()[0]);
    assert.equal(read(actor),11);
    db.close();
    db=f.open();
    actor=create(db,'#event_sourced',{reducer});
    actor.restore();
    assert.equal(read(actor),11);
    assert.equal(actor.version,2);
    db.close();
  } finally {f.close();}
});

test('real SQLite batch mode: two distinct actors commit together and restore separately',()=>{
  const f=fixture();
  const policy={mode:'#batched_sidecar',underlying:'#snapshot',ack:'#committed'};
  try {
    let db=f.open();
    for(const name of ['alice','bob']) db.grantEpoch({tenantId:'tenant-a',actor:name,epoch:1});
    const alice=create(db,policy,{actor:'alice'});
    const bob=create(db,policy,{actor:'bob'});
    assert.equal(alice.stage_snapshot('a1',s=>{s.count=12;}).status,'admitted');
    assert.equal(bob.stage_snapshot('b1',s=>{s.count=21;}).durable,false);
    assert.equal(read(alice),0);
    assert.equal(read(bob),0);
    const receipts=db.flush();
    assert.equal(receipts.length,2);
    for(const receipt of receipts) (receipt.opId==='a1'?alice:bob).apply_commit(receipt);
    db.close();
    db=f.open();
    const a2=create(db,policy,{actor:'alice'}),b2=create(db,policy,{actor:'bob'});
    a2.restore();b2.restore();
    assert.equal(read(a2),12);
    assert.equal(read(b2),21);
    db.close();
  } finally {f.close();}
});

test('real SQLite stale epochs and serialization restrictions reject unsafe writes',()=>{
  const f=fixture();
  try {
    const db=f.open();
    db.grantEpoch({tenantId:'tenant-a',actor:'counter',epoch:2});
    const stale=create(db,'#snapshot',{epoch:1});
    assert.throws(()=>stale.stage_snapshot('stale',s=>{s.count=4;}),/STALE_EPOCH/);
    const current=create(db,'#snapshot',{epoch:2});
    assert.throws(()=>current.stage_snapshot('raw',s=>{s.hostFd=Buffer.from('a');}),/NOT_SERIALIZABLE/);
    assert.equal(db.flush().length,0);
    db.close();
  } finally {f.close();}
});

test('forged committed ACK cannot publish state without a persisted op',()=>{
  const f=fixture();
  try {
    const db=f.open();
    db.grantEpoch({tenantId:'tenant-a',actor:'counter',epoch:1});
    const actor=create(db,'#snapshot');
    actor.stage_snapshot('forgery',s=>{s.count=777;});
    const fake={opId:'forgery',status:'committed',durable:true,version:1};
    assert.throws(()=>actor.apply_commit(fake),/OUTCOME_UNKNOWN/);
    assert.equal(read(actor),0);
    assert.equal(actor.has_pending_write,true);
    assert.equal(db.load({tenantId:'tenant-a',actor:'counter',stateName:'main'}).version,0);
    assert.equal(db.flush()[0].status,'committed');
    actor.apply_commit(fake);
    assert.equal(read(actor),777);
    db.close();
  } finally {f.close();}
});

test('provider verifies original payload digest, epoch and version',()=>{
  const f=fixture();
  try {
    const db=f.open();
    db.grantEpoch({tenantId:'tenant-a',actor:'counter',epoch:1});
    const e={tenantId:'tenant-a',actor:'counter',stateName:'main',opId:'proof-1',epoch:1,
      expectedVersion:0,kind:'snapshot',schemaVersion:1,payload:Buffer.from('{"count":8}')};
    db.enqueue(e);
    assert.equal(db.verifyCommit(e),null);
    assert.equal(db.flush()[0].status,'committed');
    assert.equal(db.verifyCommit(e).version,1);
    assert.throws(()=>db.verifyCommit({...e,payload:Buffer.from('{"count":9}')}),/COMMIT_MISMATCH/);
    assert.throws(()=>db.verifyCommit({...e,expectedVersion:1}),/COMMIT_MISMATCH/);
    db.grantEpoch({tenantId:'tenant-a',actor:'counter',epoch:2});
    assert.throws(()=>db.verifyCommit(e),/STALE_EPOCH/);
    db.close();
  } finally {f.close();}
});

test('nested critical-write and snapshot mutation are rejected before enqueue',()=>{
  const actor=create(null,'#none');
  assert.throws(()=>actor.handle_state('critical-write',s=>{
    actor.handle_state('critical-write',inner=>{inner.count=99;});
    s.count=11;
  }),/ACTOR_REENTRANCY_DENIED/);
  assert.equal(read(actor),0);
  const f=fixture();
  try {
    const db=f.open();
    db.grantEpoch({tenantId:'tenant-a',actor:'counter',epoch:1});
    const durable=create(db,'#snapshot');
    assert.throws(()=>durable.stage_snapshot('outer',draft=>{
      durable.stage_snapshot('inner',inner=>{inner.count=99;});
      draft.count=11;
    }),/ACTOR_REENTRANCY_DENIED/);
    assert.equal(db.flush().length,0);
    assert.equal(durable.has_pending_write,false);
    db.close();
  } finally {f.close();}
});

test('event reducer cannot reenter actor state while staging command',()=>{
  const f=fixture();
  try {
    const db=f.open();
    db.grantEpoch({tenantId:'tenant-a',actor:'counter',epoch:1});
    let actor;
    actor=create(db,'#event_sourced',{reducer:(s,e)=>{
      actor.handle_state('critical-read',state=>state.count);
      return {count:s.count+e.delta};
    }});
    assert.throws(()=>actor.stage_event('reenter',{delta:3}),/ACTOR_REENTRANCY_DENIED/);
    assert.equal(db.flush().length,0);
    db.close();
  } finally {f.close();}
});

test('stale actor epoch cannot restore durable state after migration',()=>{
  const f=fixture();
  try {
    const db=f.open();
    db.grantEpoch({tenantId:'tenant-a',actor:'counter',epoch:1});
    const first=create(db,'#snapshot',{epoch:1});
    first.stage_snapshot('before-migration',s=>{s.count=31;});
    first.apply_commit(db.flush()[0]);
    db.grantEpoch({tenantId:'tenant-a',actor:'counter',epoch:2});
    const stale=create(db,'#snapshot',{epoch:1});
    assert.throws(()=>stale.restore(),/STALE_EPOCH/);
    const current=create(db,'#snapshot',{epoch:2});
    current.restore();
    assert.equal(read(current),31);
    db.close();
  } finally {f.close();}
});

test('lost durable ACK can only be resolved through persisted operation record',()=>{
  const f=fixture();
  try {
    const db=f.open();
    db.grantEpoch({tenantId:'tenant-a',actor:'counter',epoch:1});
    const actor=create(db,'#snapshot');
    assert.equal(actor.stage_snapshot('lost-response',s=>{s.count=51;}).status,'admitted');
    assert.equal(actor.resolve_pending().status,'pending');
    assert.equal(read(actor),0);
    assert.equal(db.flush()[0].status,'committed');
    // Lost/forged response: never trust it; consult the persisted operation.
    assert.equal(actor.resolve_pending().status,'committed');
    assert.equal(read(actor),51);
    assert.equal(actor.version,1);
    assert.throws(()=>actor.resolve_pending(),/NO_PENDING_WRITE/);
    db.close();
  } finally {f.close();}
});

test('fabricated rejection cannot erase pending durable operation',()=>{
  const f=fixture();
  try {
    const db=f.open();
    db.grantEpoch({tenantId:'tenant-a',actor:'counter',epoch:1});
    const actor=create(db,'#snapshot');
    actor.stage_snapshot('maybe-committed',s=>{s.count=57;});
    assert.throws(()=>actor.apply_commit({opId:'maybe-committed',status:'rejected',code:'VERSION_CONFLICT'}),/OUTCOME_UNKNOWN/);
    assert.equal(actor.has_pending_write,true);
    assert.equal(actor.resolve_pending().status,'pending');
    db.flush();
    assert.equal(actor.resolve_pending().status,'committed');
    assert.equal(read(actor),57);
    db.close();
  } finally {f.close();}
});
