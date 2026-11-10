// Source-free Node/SQLite host tests for the command-transaction actor adapter.
// NOT compiled .ores, scheduler-side async persistence or GraalVM AOT evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BatchPersistenceSidecar} from './sidecar.mjs';
import {TransactionalBankAccountReference} from './bank-account-transactional.mjs';

function fixture(body) {
  const dir=mkdtempSync(join(tmpdir(),'atto-bank-tx-'));
  const path=join(dir,'bank.sqlite');
  const databases=[];
  const open=()=>{const db=new BatchPersistenceSidecar({path,tenantId:'tenant-tx'});
    databases.push(db);return db;};
  try {body(open);} finally {
    for(const db of databases)try{db.close();}catch{}
    rmSync(dir,{recursive:true,force:true});
  }
}
const openBank=(db,actorId='bank-1',epoch=1)=>{
  db.grantEpoch({tenantId:'tenant-tx',actor:actorId,epoch});
  const bank=new TransactionalBankAccountReference({
    sidecar:db,tenantId:'tenant-tx',actorId,stateName:'main',epoch
  });
  bank.restore();return bank;
};
const command=(kind,amount_cents)=>({kind,amount_cents});
const deposit=n=>command('deposit',n);
const withdraw=n=>command('withdraw',n);
const commit=(a,db,opId,request)=>{
  assert.equal(a.submit(opId,request).status,'admitted');
  const [receipt]=db.flush();
  assert.equal(receipt.status,'committed');
  return a.accept_commit(receipt);
};
const stream=(db,actor='bank-1',epoch=1)=>db.loadFenced({
  tenantId:'tenant-tx',actor,stateName:'main',epoch
});

test('deposit and withdraw commit atomically; state is invisible until provider proof',()=>{
  fixture(open=>{
    const db=open(),a=openBank(db);
    assert.equal(a.submit('deposit-100',deposit(100)).durable,false);
    assert.equal(a.balance_cents,0);
    assert.equal(stream(db).version,0);
    const [receipt]=db.flush();
    assert.deepEqual([receipt.firstVersion,receipt.version,receipt.eventCount],[1,2,2]);
    assert.equal(a.balance_cents,0);
    assert.deepEqual(a.accept_commit(receipt),{status:'committed',durable:true,version:2});
    assert.equal(a.balance_cents,100);
    commit(a,db,'withdraw-30',withdraw(30));
    assert.equal(a.balance_cents,70);
    assert.equal(a.version,4);
    assert.deepEqual(stream(db).events.map(x=>x.version),[1,2,3,4]);
  });
});

test('reopen with new epoch and retry old logical command, without second deposit',()=>{
  fixture(open=>{
    let db=open(),a=openBank(db);
    commit(a,db,'charge-1',deposit(125));
    db.close();
    db=open();const restored=openBank(db,'bank-1',2);
    assert.equal(restored.balance_cents,125);
    assert.equal(restored.version,2);
    const duplicate=restored.submit('charge-1',deposit(125));
    assert.equal(duplicate.duplicate,true);
    assert.equal(duplicate.version,2);
    assert.equal(duplicate.durable,true);
    assert.equal(db.flush().length,0);
    assert.equal(stream(db,'bank-1',2).events.length,2);
    assert.throws(()=>restored.submit('charge-1',deposit(126)),/OP_ID_CONFLICT/);
    assert.equal(restored.balance_cents,125);
  });
});

test('commit then lose ACK, restart uses persisted command index and no duplicate',()=>{
  fixture(open=>{
    let db=open(),a=openBank(db);
    assert.equal(a.submit('lost-ack',deposit(88)).status,'admitted');
    assert.equal(db.flush()[0].durable,true);
    assert.equal(a.balance_cents,0);
    db.close();db=open();
    const b=openBank(db,'bank-1',2);
    assert.equal(b.balance_cents,88);
    assert.equal(b.submit('lost-ack',deposit(88)).duplicate,true);
    assert.equal(stream(db,'bank-1',2).version,2);
  });
});

test('forged success cannot publish state; lost ACK reconciles from durable record',()=>{
  fixture(open=>{
    const db=open(),a=openBank(db);
    a.submit('forged-ack',deposit(50));
    assert.throws(()=>a.accept_commit({opId:'forged-ack',status:'committed',
      durable:true,firstVersion:1,eventCount:2,version:2}),/OUTCOME_UNKNOWN/);
    assert.equal(a.balance_cents,0);
    assert.equal(a.has_pending_write,true);
    assert.equal(a.cancel_wait().requires_reconciliation,true);
    assert.equal(a.reconcile_pending().status,'pending');
    db.flush();
    assert.deepEqual(a.reconcile_pending(),{status:'committed',durable:true,version:2});
    assert.equal(a.balance_cents,50);
  });
});

test('SQLite second-event abort is all-or-nothing; uncertain outcome retains pending operation',()=>{
  fixture(open=>{
    const db=open(),a=openBank(db);
    db.db.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON events
      WHEN NEW.version=2 BEGIN SELECT RAISE(ABORT,'abort-test'); END;`);
    assert.equal(a.submit('abort-me',deposit(12)).status,'admitted');
    assert.throws(()=>db.flush(),/OUTCOME_UNKNOWN/);
    assert.equal(db.db.prepare('SELECT count(*) n FROM events').get().n,0);
    assert.equal(db.db.prepare('SELECT count(*) n FROM command_commits').get().n,0);
    assert.equal(stream(db).version,0);
    assert.equal(a.balance_cents,0);
    assert.equal(a.reconcile_pending().status,'pending');
    db.db.exec('DROP TRIGGER fail_second');
    const [receipt]=db.flush();
    assert.equal(receipt.version,2);
    a.accept_commit(receipt);
    assert.equal(a.balance_cents,12);
  });
});

test('legacy snapshot barrier and pruned old events retain cross-epoch dedupe',()=>{
  fixture(open=>{
    let db=open(),a=openBank(db);
    commit(a,db,'old-deposit',deposit(100));
    const snapshot={tenantId:'tenant-tx',actor:'bank-1',stateName:'main',
      opId:'checkpoint-1',epoch:1,expectedVersion:2,kind:'snapshot',
      schemaVersion:1,payload:Buffer.from('{"balance_cents":100}')};
    assert.equal(db.enqueue(snapshot).status,'admitted');
    assert.equal(db.flush()[0].version,3);
    // Represent retention-aware compaction: snapshot & durable command index persist.
    db.db.prepare('DELETE FROM events WHERE tenant=? AND actor=? AND state_name=? AND version<=?')
      .run('tenant-tx','bank-1','main',2);
    db.close();db=open();
    const restored=openBank(db,'bank-1',2);
    assert.equal(restored.balance_cents,100);
    assert.equal(restored.version,3);
    assert.equal(restored.submit('old-deposit',deposit(100)).duplicate,true);
    assert.equal(db.flush().length,0);
    commit(restored,db,'new-deposit',deposit(20));
    assert.equal(restored.balance_cents,120);
    assert.equal(restored.version,5);
    assert.deepEqual(stream(db,'bank-1',2).events.map(e=>e.version),[4,5]);
  });
});

test('invalid snapshot and corrupt tail cannot publish partly recovered state',()=>{
  fixture(open=>{
    const db=open(),a=openBank(db);
    commit(a,db,'first',deposit(10));
    db.db.prepare('UPDATE events SET payload=? WHERE version=?')
      .run(Buffer.from('not-json'),2);
    const newGeneration=new TransactionalBankAccountReference({
      sidecar:db,tenantId:'tenant-tx',actorId:'bank-1',stateName:'main',epoch:1});
    assert.throws(()=>newGeneration.restore(),/INVALID_JOURNAL/);
    assert.throws(()=>newGeneration.balance_cents,/RECOVERY_NOT_COMPLETE/);
  });
});

test('overdraft, invalid amount and overflow rejected before enqueuing any event',()=>{
  fixture(open=>{
    const db=open(),a=openBank(db);
    assert.deepEqual(a.submit('overdraft',withdraw(1)),
      {status:'rejected',code:'INSUFFICIENT_FUNDS',durable:false});
    assert.throws(()=>a.submit('bad',deposit(0)),/INVALID_COMMAND/);
    assert.throws(()=>a.submit('bad2',deposit(-1)),/INVALID_COMMAND/);
    assert.equal(db.queue.length,0);
    assert.equal(a.version,0);
    assert.equal(a.balance_cents,0);
  });
});

test('two actors share a batch but never share state, operation version or activation',()=>{
  fixture(open=>{
    const db=open(),alice=openBank(db,'alice'),bob=openBank(db,'bob');
    alice.submit('same-op',deposit(10));
    bob.submit('same-op',deposit(40));
    assert.equal(alice.balance_cents,0);
    assert.equal(bob.balance_cents,0);
    const receipts=db.flush();
    assert.equal(receipts.length,2);
    alice.accept_commit(receipts[0]);
    bob.accept_commit(receipts[1]);
    assert.equal(alice.balance_cents,10);
    assert.equal(bob.balance_cents,40);
    assert.equal(alice.version,2);
    assert.equal(bob.version,2);
  });
});

test('stale activation cannot replay or submit after supervisor advances fence',()=>{
  fixture(open=>{
    const db=open(),a=openBank(db);
    commit(a,db,'first',deposit(10));
    db.grantEpoch({tenantId:'tenant-tx',actor:'bank-1',epoch:2});
    assert.throws(()=>a.submit('late',deposit(10)),/STALE_EPOCH/);
    const b=openBank(db,'bank-1',2);
    assert.equal(b.balance_cents,10);
    assert.equal(b.submit('first',deposit(10)).duplicate,true);
  });
});
