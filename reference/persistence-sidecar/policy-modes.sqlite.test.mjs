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
