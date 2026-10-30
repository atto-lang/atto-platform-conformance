import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { BatchPersistenceSidecar } from './sidecar.mjs';
function fixture(opts={}) {
  const dir=mkdtempSync(join(tmpdir(),'ores-sidecar-'));
  const path=join(dir,'store.sqlite');
  const open=(extra={})=>new BatchPersistenceSidecar({path,tenantId:'tenant-a',...opts,...extra});
  return {open,close:()=>rmSync(dir,{recursive:true,force:true})};
}
const write=(actor,opId,extra={})=>({tenantId:'tenant-a',actor,stateName:'main',opId,epoch:1,expectedVersion:0,kind:'snapshot',payload:Buffer.from('hello'),...extra});
test('one durable transaction batches 1,000 distinct actor snapshots and reopens',()=>{
  const f=fixture({maxBatchEntries:1100,maxBatchBytes:200000});
  try {
    let s=f.open();
    for(let i=0;i<1000;i++) {
      s.grantEpoch({tenantId:'tenant-a',actor:`a${i}`,epoch:1});
      assert.equal(s.enqueue(write(`a${i}`,`op-${i}`)).durable,false);
    }
    const results=s.flush();
    assert.equal(results.length,1000);
    assert.ok(results.every(x=>x.status==='committed'&&x.durable&&x.version===1));
    s.close();s=f.open();
    assert.equal(s.load({tenantId:'tenant-a',actor:'a999',stateName:'main'}).snapshot.payload.toString(),'hello');
    assert.deepEqual(s.load({tenantId:'tenant-a',actor:'a0',stateName:'main'}).events,[]);
    s.close();
  } finally { f.close(); }
});
test('duplicates are idempotent; same op-id different payload is denied',()=>{
  const f=fixture();try{const s=f.open();s.grantEpoch({tenantId:'tenant-a',actor:'a',epoch:1});
    assert.equal(s.enqueue(write('a','x')).status,'admitted');
    assert.equal(s.enqueue(write('a','x')).duplicate,true);
    assert.equal(s.flush()[0].version,1);
    assert.equal(s.enqueue(write('a','x')).duplicate,true);
    assert.throws(()=>s.enqueue(write('a','x',{payload:Buffer.from('changed')})),/OP_ID_CONFLICT/);
    assert.equal(s.load({tenantId:'tenant-a',actor:'a',stateName:'main'}).version,1);s.close();
  }finally{f.close();}
});
test('epoch fencing rejects stale buffered writes and survives restart',()=>{
  const f=fixture();try{let s=f.open();s.grantEpoch({tenantId:'tenant-a',actor:'a',epoch:1});
    s.enqueue(write('a','old'));
    s.grantEpoch({tenantId:'tenant-a',actor:'a',epoch:2});
    assert.equal(s.flush()[0].code,'STALE_EPOCH');
    assert.throws(()=>s.enqueue(write('a','another')),/STALE_EPOCH/);
    s.enqueue(write('a','new',{epoch:2}));
    assert.equal(s.flush()[0].status,'committed');s.close();s=f.open();
    assert.throws(()=>s.grantEpoch({tenantId:'tenant-a',actor:'a',epoch:1}),/STALE_EPOCH/);
    assert.equal(s.load({tenantId:'tenant-a',actor:'a',stateName:'main'}).version,1);s.close();
  }finally{f.close();}
});
test('per-actor CAS conflict does not abort other actors in same batch',()=>{
  const f=fixture();try{const s=f.open();for(const a of ['a','b']) s.grantEpoch({tenantId:'tenant-a',actor:a,epoch:1});
    s.enqueue(write('a','a1'));
    s.enqueue(write('a','a2'));
    s.enqueue(write('b','b1'));
    const results=s.flush();
    assert.deepEqual(results.map(x=>x.status),['committed','rejected','committed']);
    assert.equal(results[1].code,'VERSION_CONFLICT');
    assert.equal(s.load({tenantId:'tenant-a',actor:'b',stateName:'main'}).version,1);s.close();
  }finally{f.close();}
});
test('event journal is replayed after latest snapshot and version CAS',()=>{
  const f=fixture();try{const s=f.open();s.grantEpoch({tenantId:'tenant-a',actor:'a',epoch:1});
    s.enqueue(write('a','initial'));assert.equal(s.flush()[0].version,1);
    s.enqueue(write('a','event1',{kind:'event',expectedVersion:1,payload:Buffer.from('delta1')}));
    s.enqueue(write('a','event2',{kind:'event',expectedVersion:2,payload:Buffer.from('delta2')}));
    assert.deepEqual(s.flush().map(x=>x.version),[2,3]);
    const recovered=s.load({tenantId:'tenant-a',actor:'a',stateName:'main'});
    assert.equal(recovered.snapshot.version,1);
    assert.deepEqual(recovered.events.map(e=>e.payload.toString()),['delta1','delta2']);
    s.close();
  }finally{f.close();}
});
test('admitted != durable; unsent batch does not appear after reopening',()=>{
  const f=fixture();try{let s=f.open();s.grantEpoch({tenantId:'tenant-a',actor:'a',epoch:1});
    assert.equal(s.enqueue(write('a','lost')).durable,false);
    s.close();s=f.open();
    assert.equal(s.load({tenantId:'tenant-a',actor:'a',stateName:'main'}).version,0);
    s.close();
  }finally{f.close();}
});
test('tenant authorization, strict quotas and copy-on-admission',()=>{
  const f=fixture({maxQueuedBytes:140,maxBatchBytes:5,maxPayloadBytes:5});try{const s=f.open();
    assert.throws(()=>s.grantEpoch({tenantId:'tenant-b',actor:'a',epoch:1}),/WRONG_TENANT/);
    s.grantEpoch({tenantId:'tenant-a',actor:'a',epoch:1});
    const source=Buffer.from('hello');
    s.enqueue(write('a','1',{payload:source}));source.fill(0);
    assert.throws(()=>s.enqueue(write('a','2')),/BACKPRESSURE/);
    assert.throws(()=>s.enqueue(write('a','3',{payload:Buffer.alloc(6)})),/PAYLOAD_TOO_LARGE/);
    assert.throws(()=>s.load({tenantId:'tenant-b',actor:'a',stateName:'main'}),/WRONG_TENANT/);
    assert.equal(s.flush()[0].status,'committed');
    assert.equal(s.load({tenantId:'tenant-a',actor:'a',stateName:'main'}).snapshot.payload.toString(),'hello');s.close();
  }finally{f.close();}
});
test('batch size bound causes multiple commits without dropping messages',()=>{
  const f=fixture({maxBatchEntries:2});try{const s=f.open();for(let i=0;i<5;i++){
    s.grantEpoch({tenantId:'tenant-a',actor:`a${i}`,epoch:1});s.enqueue(write(`a${i}`,`op${i}`));
  }
    assert.equal(s.flush().length,2);assert.equal(s.flush().length,2);assert.equal(s.flush().length,1);
    assert.equal(s.flush().length,0);assert.equal(s.queuedBytes,0);s.close();
  }finally{f.close();}
});
test('zero-size payload flood is bounded by queued entry quota',()=>{
  const f=fixture({maxQueuedEntries:2});try{const s=f.open();s.grantEpoch({tenantId:'tenant-a',actor:'a',epoch:1});
    s.enqueue(write('a','z1',{payload:Buffer.alloc(0)}));
    s.enqueue(write('a','z2',{payload:Buffer.alloc(0)}));
    assert.throws(()=>s.enqueue(write('a','z3',{payload:Buffer.alloc(0)})),/BACKPRESSURE/);
    s.close();
  }finally{f.close();}
});

test('stale activation cannot retrieve old committed dedup receipt',()=>{
  const f=fixture();try{const s=f.open();s.grantEpoch({tenantId:'tenant-a',actor:'a',epoch:1});
    s.enqueue(write('a','original'));assert.equal(s.flush()[0].status,'committed');
    s.grantEpoch({tenantId:'tenant-a',actor:'a',epoch:2});
    assert.throws(()=>s.enqueue(write('a','original')),/STALE_EPOCH/);
    assert.throws(()=>s.enqueue(write('a','original',{epoch:2,expectedVersion:1})),/OP_ID_CONFLICT/);
    s.close();
  }finally{f.close();}
});
test('control-character identities are rejected at admission',()=>{
  const f=fixture();try{const s=f.open();
    for(const actor of ['bad\0id','bad\nactor','bad\tactor']){
      assert.throws(()=>s.grantEpoch({tenantId:'tenant-a',actor,epoch:1}),/INVALID_EPOCH/);
      assert.throws(()=>s.enqueue(write(actor,'op')),/INVALID_WRITE/);
    }
    s.close();
  }finally{f.close();}
});

test('reject malformed Unicode and noncanonical persistence identifiers',()=>{
  const f=fixture();
  try {
    const s=f.open();
    for (const actor of ['\ud800','\udfff','e\u0301','a\0b','a\nb']) {
      assert.throws(()=>s.grantEpoch({tenantId:'tenant-a',actor,epoch:1}), /INVALID_EPOCH/);
      assert.throws(()=>s.enqueue(write(actor,'op')), /INVALID_WRITE/);
      assert.throws(()=>s.load({tenantId:'tenant-a',actor,stateName:'main'}), /INVALID_READ/);
    }
    s.grantEpoch({tenantId:'tenant-a',actor:'�',epoch:1});
    assert.equal(s.enqueue(write('�','ok')).status,'admitted');
    for (const stateName of ['\ud800','e\u0301']) {
      assert.throws(()=>s.enqueue(write('�','op',{stateName})), /INVALID_WRITE/);
      assert.throws(()=>s.load({tenantId:'tenant-a',actor:'�',stateName}), /INVALID_READ/);
    }
    assert.throws(()=>s.enqueue(write('�','\ud800')), /INVALID_WRITE/);
    assert.equal(s.flush()[0].status,'committed');
    s.close();
  } finally { f.close(); }
});

test('queue accounting reserves bytes for all identifier fields',()=>{
 const f=fixture({maxQueuedBytes:600,maxBatchBytes:200});
 try {
  const x=f.open(),actor='a'.repeat(128),stateName='s'.repeat(128),opId='o'.repeat(128);
  x.grantEpoch({tenantId:'tenant-a',actor,epoch:1});
  assert.equal(x.enqueue(write(actor,opId,{stateName,payload:Buffer.alloc(0)})).status,'admitted');
  assert.equal(x.queuedBytes,512);
  assert.throws(()=>x.enqueue(write(actor,'p'.repeat(128),{stateName,payload:Buffer.alloc(0)})),/BACKPRESSURE/);
  assert.equal(x.flush()[0].status,'committed');
  assert.equal(x.queuedBytes,0);
  x.close();
 } finally { f.close(); }
});
test('an oversized queue entry consumes no credits',()=>{
 const f=fixture({maxQueuedBytes:400});
 try {
  const x=f.open(),actor='a'.repeat(128);
  x.grantEpoch({tenantId:'tenant-a',actor,epoch:1});
  assert.throws(()=>x.enqueue(write(actor,'o'.repeat(128),{stateName:'s'.repeat(128),payload:Buffer.alloc(0)})),/BACKPRESSURE/);
  assert.equal(x.queuedBytes,0);assert.equal(x.queue.length,0);x.close();
 } finally {f.close();}
});

test('truncated committed journal is rejected during restore',()=>{
  const f=fixture();try{
    const s=f.open();s.grantEpoch({tenantId:'tenant-a',actor:'tampered',epoch:1});
    s.enqueue(write('tampered','first',{kind:'event',payload:Buffer.from('a')}));
    s.flush();
    s.enqueue(write('tampered','second',{kind:'event',expectedVersion:1,payload:Buffer.from('b')}));
    s.flush();
    s.db.exec("DELETE FROM events WHERE actor='tampered' AND version=1");
    assert.throws(()=>s.load({tenantId:'tenant-a',actor:'tampered',stateName:'main'}),/INCOMPLETE_ACTOR_JOURNAL/);
    s.close();
  }finally{f.close();}
});

test('fenced recovery checks current epoch in same SQLite snapshot',()=>{
  const f=fixture();try{
    const s=f.open();s.grantEpoch({tenantId:'tenant-a',actor:'reactivated',epoch:1});
    s.enqueue(write('reactivated','first'));assert.equal(s.flush()[0].status,'committed');
    s.grantEpoch({tenantId:'tenant-a',actor:'reactivated',epoch:2});
    assert.throws(()=>s.loadFenced({tenantId:'tenant-a',actor:'reactivated',stateName:'main',epoch:1}),/STALE_EPOCH/);
    assert.equal(s.loadFenced({tenantId:'tenant-a',actor:'reactivated',stateName:'main',epoch:2}).version,1);
    assert.throws(()=>s.loadFenced({tenantId:'tenant-a',actor:'reactivated',stateName:'main',epoch:0}),/INVALID_EPOCH/);
    s.close();
  }finally{f.close();}
});

test('restore rejects oversized persisted snapshot and journal event',()=>{
  const f=fixture();try{
    const s=f.open();
    s.grantEpoch({tenantId:'tenant-a',actor:'oversized-snapshot',epoch:1});
    s.enqueue(write('oversized-snapshot','snap'));
    assert.equal(s.flush()[0].status,'committed');
    s.db.exec("UPDATE snapshots SET payload=zeroblob(1048577) WHERE actor='oversized-snapshot'");
    assert.throws(()=>s.loadFenced({tenantId:'tenant-a',actor:'oversized-snapshot',stateName:'main',epoch:1}),/INVALID_ACTOR_SNAPSHOT/);
    s.grantEpoch({tenantId:'tenant-a',actor:'oversized-event',epoch:1});
    s.enqueue(write('oversized-event','evt',{kind:'event',payload:Buffer.from('x')}));
    assert.equal(s.flush()[0].status,'committed');
    s.db.exec("UPDATE events SET payload=zeroblob(1048577) WHERE actor='oversized-event'");
    assert.throws(()=>s.loadFenced({tenantId:'tenant-a',actor:'oversized-event',stateName:'main',epoch:1}),/ACTOR_EVENT_REPLAY_BYTES_LIMIT/);
    s.close();
  }finally{f.close();}
});
