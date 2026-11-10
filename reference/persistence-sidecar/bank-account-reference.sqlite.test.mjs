import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {BatchPersistenceSidecar} from './sidecar.mjs';
import {PolicyActorReference} from './policy-modes.mjs';
import {BankAccountCommandReference, apply_bank_event} from './bank-account-reference.mjs';

// Real SQLite tests, but still a synchronous host reference: NOT native .ores or async carriers.
const deposit = amount_cents => ({kind:'deposit',amount_cents});
const withdraw = amount_cents => ({kind:'withdraw',amount_cents});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(),'atto-bank-'));
  const path = join(dir,'bank.sqlite');
  return {open:() => new BatchPersistenceSidecar({path,tenantId:'tenant-a'}),
    close:() => rmSync(dir,{recursive:true,force:true})};
}
function bank(db, actorId, epoch) {
  const actor = new PolicyActorReference({sidecar:db,tenantId:'tenant-a',actor:actorId,
    stateName:'main',epoch,policy:'#event_sourced',initialState:{balance_cents:0},
    reducer:apply_bank_event,schemaVersion:1});
  return new BankAccountCommandReference({actor,sidecar:db,tenantId:'tenant-a',
    actorId,stateName:'main',epoch});
}
function commit(account,db,opId,command) {
  assert.equal(account.submit(opId,command).status,'admitted');
  const receipts=db.flush();assert.equal(receipts.length,1);
  return account.accept_commit(receipts[0]);
}

test('SQLite bank: immutable deposits/withdrawals replay and duplicate after epoch-fenced restart',()=>{
  const f=fixture();let db;
  try {
    db=f.open();db.grantEpoch({tenantId:'tenant-a',actor:'bank-1',epoch:1});
    let a=bank(db,'bank-1',1);a.restore();
    commit(a,db,'deposit-1',deposit(500));
    commit(a,db,'withdraw-1',withdraw(125));
    assert.equal(a.balance_cents,375);
    assert.deepEqual(a.submit('withdraw-fail',withdraw(376)),
      {status:'rejected',code:'INSUFFICIENT_FUNDS',durable:false});
    db.close();db=f.open();db.grantEpoch({tenantId:'tenant-a',actor:'bank-1',epoch:2});
    a=bank(db,'bank-1',2);assert.deepEqual(a.restore(),
      {status:'ready',version:2,balance_cents:375});
    assert.deepEqual(a.submit('deposit-1',deposit(500)),
      {status:'committed',durable:true,duplicate:true,version:1});
    assert.throws(()=>a.submit('deposit-1',deposit(501)),/OP_ID_CONFLICT/);
    assert.equal(db.loadFenced({tenantId:'tenant-a',actor:'bank-1',stateName:'main',epoch:2}).events.length,2);
  } finally {try{db?.close();}catch{} f.close();}
});

test('SQLite bank: commit then lose acknowledgement; restarted actor does not append twice',()=>{
  const f=fixture();let db;
  try {
    db=f.open();db.grantEpoch({tenantId:'tenant-a',actor:'bank-1',epoch:1});
    const a=bank(db,'bank-1',1);a.restore();
    assert.equal(a.submit('req-7',deposit(175)).durable,false);
    assert.equal(db.flush()[0].status,'committed');
    assert.equal(a.balance_cents,0); // actor never consumed ACK
    db.close();db=f.open();db.grantEpoch({tenantId:'tenant-a',actor:'bank-1',epoch:2});
    const b=bank(db,'bank-1',2);b.restore();
    assert.equal(b.balance_cents,175);
    assert.equal(b.submit('req-7',deposit(175)).duplicate,true);
    assert.equal(db.loadFenced({tenantId:'tenant-a',actor:'bank-1',stateName:'main',epoch:2}).events.length,1);
  } finally {try{db?.close();}catch{} f.close();}
});

test('SQLite bank: admitted but not committed is lost on close and same ID may commit after recovery',()=>{
  const f=fixture();let db;
  try {
    db=f.open();db.grantEpoch({tenantId:'tenant-a',actor:'bank-1',epoch:1});
    const a=bank(db,'bank-1',1);a.restore();a.submit('req-8',deposit(250));
    assert.equal(a.balance_cents,0);
    db.close();db=f.open();db.grantEpoch({tenantId:'tenant-a',actor:'bank-1',epoch:2});
    const b=bank(db,'bank-1',2);b.restore();assert.equal(b.balance_cents,0);
    commit(b,db,'req-8',deposit(250));assert.equal(b.balance_cents,250);
  } finally {try{db?.close();}catch{} f.close();}
});

test('SQLite bank: lost ACK resolution and forged ACK never publish without DB proof',()=>{
  const f=fixture();let db;
  try {
    db=f.open();db.grantEpoch({tenantId:'tenant-a',actor:'bank-1',epoch:1});
    const a=bank(db,'bank-1',1);a.restore();a.submit('req-9',deposit(50));
    assert.throws(()=>a.accept_commit({opId:'req-9',version:1,status:'committed',durable:true}),/OUTCOME_UNKNOWN/);
    assert.equal(a.balance_cents,0);
    assert.equal(a.reconcile_pending().status,'pending');
    db.flush();
    assert.deepEqual(a.reconcile_pending(),{status:'committed',durable:true,version:1});
    assert.equal(a.balance_cents,50);
  } finally {try{db?.close();}catch{} f.close();}
});

test('SQLite bank: two different actors commit in a single sidecar flush without sharing state',()=>{
  const f=fixture();let db;
  try {
    db=f.open();
    for(const actor of ['alice','bob'])db.grantEpoch({tenantId:'tenant-a',actor,epoch:1});
    const alice=bank(db,'alice',1),bob=bank(db,'bob',1);alice.restore();bob.restore();
    alice.submit('alice-1',deposit(100));bob.submit('bob-1',deposit(300));
    assert.equal(alice.balance_cents,0);assert.equal(bob.balance_cents,0);
    const receipts=db.flush();assert.equal(receipts.length,2);
    for(const receipt of receipts)(receipt.opId==='alice-1'?alice:bob).accept_commit(receipt);
    assert.equal(alice.balance_cents,100);assert.equal(bob.balance_cents,300);
  } finally {try{db?.close();}catch{} f.close();}
});

test('SQLite bank: stale incarnation fenced; snapshots prohibited without durable dedupe index',()=>{
  const f=fixture();let db;
  try {
    db=f.open();db.grantEpoch({tenantId:'tenant-a',actor:'bank-1',epoch:1});
    const a=bank(db,'bank-1',1);a.restore();commit(a,db,'req-1',deposit(100));
    db.grantEpoch({tenantId:'tenant-a',actor:'bank-1',epoch:2});
    assert.throws(()=>a.submit('stale',deposit(4)),/STALE_EPOCH/);
    const b=bank(db,'bank-1',2);b.restore();
    // A snapshot would hide old operation IDs; refuse to resume without a durable index.
    assert.equal(db.enqueue({tenantId:'tenant-a',actor:'bank-1',stateName:'main',opId:'snapshot',
      epoch:2,expectedVersion:1,kind:'snapshot',schemaVersion:1,
      payload:Buffer.from(JSON.stringify({balance_cents:100}))}).status,'admitted');
    assert.equal(db.flush()[0].status,'committed');
    const after_snapshot=bank(db,'bank-1',2);
    assert.throws(()=>after_snapshot.restore(),/DURABLE_DEDUPE_INDEX_REQUIRED/);
  } finally {try{db?.close();}catch{} f.close();}
});
