import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BatchPersistenceSidecar} from './sidecar.mjs';
import {PolicyActorReference} from './policy-modes.mjs';
import {BankAccountCommandReference,apply_bank_event} from './bank-account-reference.mjs';

// These are real SQLite HOST tests, not compiled .ores or async-carrier proof.
function fixture(run) {
  const dir=mkdtempSync(join(tmpdir(),'atto-checkpoint-')), path=join(dir,'state.sqlite');
  const instances=[];
  const open=(options={})=>{const db=new BatchPersistenceSidecar({path,tenantId:'t',...options});instances.push(db);return db;};
  try {run(open);} finally {
    for(const db of instances)try{db.close();}catch{}
    rmSync(dir,{recursive:true,force:true});
  }
}
const grant=(db,actor,epoch)=>db.grantEpoch({tenantId:'t',actor,epoch});
function bank(db,epoch=1,id='account') {
  const actor=new PolicyActorReference({sidecar:db,tenantId:'t',actor:id,
    stateName:'main',epoch,policy:'#event_sourced',initialState:{balance_cents:0},
    reducer:apply_bank_event,schemaVersion:1});
  return new BankAccountCommandReference({actor,sidecar:db,tenantId:'t',
    actorId:id,stateName:'main',epoch});
}
const deposit=n=>({kind:'deposit',amount_cents:n});
const withdraw=n=>({kind:'withdraw',amount_cents:n});
function do_commit(a,db,opId,command) {
  assert.equal(a.submit(opId,command).status,'admitted');
  const [receipt]=db.flush();
  assert.equal(receipt.status,'committed');
  return a.accept_commit(receipt);
}
const read=(db,epoch=1,actor='account')=>db.loadFenced({tenantId:'t',actor,stateName:'main',epoch});
const scope=(epoch,opId,kind,n,actor='account')=>({tenantId:'t',actor,stateName:'main',opId,epoch,
  commandBytes:Buffer.from(JSON.stringify([kind,n]))});
const checkpoint_input=(epoch,version,payload,actor='account')=>({tenantId:'t',actor,
  stateName:'main',epoch,expectedVersion:version,schemaVersion:1,payload:Buffer.from(JSON.stringify(payload))});

test('checkpoint, journal prune, epoch-two restart and old op retry stay exactly once',()=>{
  fixture(open=>{
    let db=open();grant(db,'account',1);
    let a=bank(db);a.restore();
    do_commit(a,db,'deposit-1',deposit(100));
    do_commit(a,db,'withdraw-1',withdraw(20));
    assert.equal(a.balance_cents,80);
    const result=a.checkpoint_and_compact();
    assert.equal(result.version,2);assert.equal(result.prunedEvents,2);
    assert.equal(a.version,2);assert.equal(a.balance_cents,80);
    const stored=read(db);
    assert.equal(stored.snapshot.provenance,'command_checkpoint_v1');
    assert.equal(stored.snapshot.verifiedCommandIndex,true);
    assert.equal(stored.events.length,0);
    assert.equal(db.verifyCommand(scope(1,'deposit-1','deposit',100)).version,1);
    db.close();db=open();grant(db,'account',2);
    a=bank(db,2);
    assert.deepEqual(a.restore(),{status:'ready',version:2,balance_cents:80});
    assert.deepEqual(a.submit('deposit-1',deposit(100)),
      {status:'committed',durable:true,duplicate:true,version:1});
    assert.throws(()=>a.submit('deposit-1',deposit(101)),/OP_ID_CONFLICT/);
    do_commit(a,db,'deposit-2',deposit(9));
    assert.equal(a.balance_cents,89);
    assert.equal(read(db,2).events.length,1);
    assert.equal(a.checkpoint_and_compact().prunedEvents,1);
    assert.equal(read(db,2).events.length,0);
    db.close();db=open();grant(db,'account',3);
    a=bank(db,3);a.restore();
    assert.equal(a.balance_cents,89);
    assert.equal(a.submit('withdraw-1',withdraw(20)).duplicate,true);
    assert.equal(db.flush().length,0);
  });
});

test('checkpoint refuses pending, even when a provider commit may have lost its ACK',()=>{
  fixture(open=>{
    const db=open();grant(db,'account',1);
    const a=bank(db);a.restore();
    a.submit('pending-1',deposit(7));
    assert.throws(()=>a.checkpoint_and_compact(),/PENDING_OUTCOME_MUST_RESOLVE/);
    db.flush();
    assert.throws(()=>a.checkpoint_and_compact(),/PENDING_OUTCOME_MUST_RESOLVE/);
    assert.equal(a.reconcile_pending().status,'committed');
    assert.equal(a.checkpoint_and_compact().version,1);
  });
});

test('stale epoch and stale stream version cannot compact any history',()=>{
  fixture(open=>{
    const db=open();grant(db,'account',1);
    const a=bank(db);a.restore();do_commit(a,db,'d1',deposit(10));
    const before=read(db).events.length;
    assert.throws(()=>db.checkpointAndCompact(checkpoint_input(1,0,{balance_cents:10})),
      /INVALID_CHECKPOINT/);
    db.grantEpoch({tenantId:'t',actor:'account',epoch:2});
    assert.throws(()=>a.checkpoint_and_compact(),/STALE_EPOCH/);
    assert.equal(read(db,2).events.length,before);
    assert.throws(()=>db.checkpointAndCompact(checkpoint_input(2,2,{balance_cents:10})),
      /VERSION_CONFLICT/);
    assert.equal(read(db,2).snapshot,null);
  });
});

test('an unindexed legacy event stream cannot be compacted',()=>{
  fixture(open=>{
    const db=open();grant(db,'account',1);
    const legacy={tenantId:'t',actor:'account',stateName:'main',epoch:1,
      opId:'legacy-event',expectedVersion:0,kind:'event',
      schemaVersion:1,payload:Buffer.from('{"delta":1}')};
    db.enqueue(legacy);db.flush();
    assert.throws(()=>db.checkpointAndCompact(checkpoint_input(1,1,{balance_cents:1})),
      /UNINDEXED_JOURNAL/);
    assert.equal(read(db).events.length,1);
    assert.equal(read(db).snapshot,null);
  });
});

test('an event journal gap prevents compaction before data loss',()=>{
  fixture(open=>{
    const db=open();grant(db,'account',1);
    const a=bank(db);a.restore();do_commit(a,db,'d1',deposit(10));
    do_commit(a,db,'d2',deposit(20));
    db.db.prepare('DELETE FROM events WHERE tenant=? AND actor=? AND state_name=? AND version=?')
      .run('t','account','main',1);
    assert.throws(()=>a.checkpoint_and_compact(),/JOURNAL_GAP/);
    assert.equal(read(db).snapshot,null);
    assert.equal(read(db).events.length,1);
  });
});

test('transaction abort during event pruning retains all events and no checkpoint',()=>{
  fixture(open=>{
    const db=open();grant(db,'account',1);
    const a=bank(db);a.restore();do_commit(a,db,'d1',deposit(10));
    db.db.exec(`CREATE TRIGGER deny_prune BEFORE DELETE ON events
      BEGIN SELECT RAISE(ABORT,'injected prune failure'); END;`);
    assert.throws(()=>a.checkpoint_and_compact(),/OUTCOME_UNKNOWN/);
    assert.equal(read(db).events.length,1);
    assert.equal(read(db).snapshot,null);
    assert.equal(db.verifyCommand(scope(1,'d1','deposit',10)).version,1);
    db.db.exec('DROP TRIGGER deny_prune');
    assert.equal(a.checkpoint_and_compact().prunedEvents,1);
  });
});

test('checkpoint digest corruption fails closed under provider-fenced restore',()=>{
  fixture(open=>{
    const db=open();grant(db,'account',1);
    const a=bank(db);a.restore();do_commit(a,db,'d1',deposit(10));a.checkpoint_and_compact();
    db.db.prepare('UPDATE checkpoints SET payload=? WHERE tenant=? AND actor=? AND state_name=?')
      .run(Buffer.from('{"balance_cents":999}'),'t','account','main');
    assert.throws(()=>read(db),/CORRUPT_CHECKPOINT/);
    assert.throws(()=>bank(db).restore(),/CORRUPT_CHECKPOINT/);
  });
});

test('checkpoint repeat is idempotent only with identical state and version',()=>{
  fixture(open=>{
    const db=open();grant(db,'account',1);
    const a=bank(db);a.restore();do_commit(a,db,'d1',deposit(10));
    assert.equal(a.checkpoint_and_compact().duplicate,false);
    assert.equal(a.checkpoint_and_compact().duplicate,true);
    assert.throws(()=>db.checkpointAndCompact(checkpoint_input(1,1,{balance_cents:100})),
      /CHECKPOINT_CONFLICT/);
    assert.equal(read(db).snapshot.version,1);
  });
});

test('legacy snapshots remain ineligible for the new indexed compaction protocol',()=>{
  fixture(open=>{
    const db=open();grant(db,'account',1);
    const e={tenantId:'t',actor:'account',stateName:'main',epoch:1,opId:'old-snapshot',
      expectedVersion:0,kind:'snapshot',schemaVersion:1,
      payload:Buffer.from('{"balance_cents":10}')};
    db.enqueue(e);db.flush();
    assert.throws(()=>db.checkpointAndCompact(checkpoint_input(1,1,{balance_cents:10})),
      /LEGACY_SNAPSHOT_PRESENT/);
    assert.equal(read(db).snapshot.provenance,undefined);
    assert.throws(()=>bank(db).restore(),/DURABLE_DEDUPE_INDEX_REQUIRED/);
  });
});

test('multi-event actor checkpoint preserves reducer state and exact stream version',()=>{
  fixture(open=>{
    const db=open();grant(db,'counter',1);
    const make=epoch=>new PolicyActorReference({sidecar:db,tenantId:'t',
      actor:'counter',stateName:'main',epoch,policy:'#event_sourced',
      initialState:{n:0},reducer:(s,e)=>({n:s.n+e.delta})});
    let a=make(1);a.restore();
    a.stage_events('add-1',Buffer.from('add:3,4'),[{delta:3},{delta:4}],
      Buffer.from('{"n":7}'));
    assert.equal(a.handle_state('critical-read',s=>s.n),0);
    a.apply_commit(db.flush()[0]);
    assert.equal(a.version,2);
    assert.equal(a.checkpoint_and_compact().prunedEvents,2);
    grant(db,'counter',2);
    a=make(2);
    const loaded=a.restore();
    assert.equal(a.version,2);assert.equal(a.handle_state('critical-read',s=>s.n),7);
    assert.equal(loaded.snapshot.version,2);
    assert.equal(loaded.events.length,0);
    a.stage_events('add-2',Buffer.from('add:1'),[{delta:1}],
      Buffer.from('{"n":8}'));
    a.apply_commit(db.flush()[0]);
    assert.equal(a.version,3);
    assert.equal(a.handle_state('critical-read',s=>s.n),8);
  });
});

test('a failed second checkpoint leaves prior checkpoint and later event replayable',()=>{
  fixture(open=>{
    let db=open();grant(db,'account',1);
    const a=bank(db);a.restore();
    do_commit(a,db,'d1',deposit(20));a.checkpoint_and_compact();
    do_commit(a,db,'d2',deposit(30));
    db.db.exec(`CREATE TRIGGER deny_prune2 BEFORE DELETE ON events
      BEGIN SELECT RAISE(ABORT,'injected'); END;`);
    assert.throws(()=>a.checkpoint_and_compact(),/OUTCOME_UNKNOWN/);
    assert.equal(read(db).snapshot.version,1);
    assert.equal(read(db).events.length,1);
    db.db.exec('DROP TRIGGER deny_prune2');
    db.close();db=open();grant(db,'account',2);
    const restored=bank(db,2);
    assert.deepEqual(restored.restore(),{status:'ready',version:2,balance_cents:50});
    assert.equal(restored.submit('d1',deposit(20)).duplicate,true);
    assert.equal(restored.submit('d2',deposit(30)).duplicate,true);
  });
});

test('replay and checkpoint fail closed at configured bounded event limit',()=>{
  fixture(open=>{
    const db=open({maxReplayEvents:1});grant(db,'account',1);
    const a=bank(db);a.restore();
    do_commit(a,db,'d1',deposit(10));
    do_commit(a,db,'d2',deposit(20));
    assert.throws(()=>read(db),/REPLAY_LIMIT_EXCEEDED/);
    assert.throws(()=>a.checkpoint_and_compact(),/REPLAY_LIMIT_EXCEEDED/);
    assert.equal(db.db.prepare('SELECT count(*) n FROM events').get().n,2);
    assert.equal(db.db.prepare('SELECT count(*) n FROM checkpoints').get().n,0);
  });
});

test('bounded one-event replay can compact and subsequently reload from checkpoint',()=>{
  fixture(open=>{
    const db=open({maxReplayEvents:1});grant(db,'account',1);
    let a=bank(db);a.restore();do_commit(a,db,'d1',deposit(10));
    assert.equal(a.checkpoint_and_compact().prunedEvents,1);
    do_commit(a,db,'d2',deposit(20));
    const loaded=read(db);
    assert.equal(loaded.snapshot.version,1);assert.equal(loaded.events.length,1);
    grant(db,'account',2);a=bank(db,2);
    assert.deepEqual(a.restore(),{status:'ready',version:2,balance_cents:30});
  });
});

test('mixed journal schema versions are rejected before destructive checkpoint',()=>{
  fixture(open=>{
    const db=open();grant(db,'account',1);
    const a=bank(db);a.restore();do_commit(a,db,'d1',deposit(10));
    db.db.prepare('UPDATE events SET schema_version=? WHERE tenant=? AND actor=? AND state_name=?')
      .run(2,'t','account','main');
    assert.throws(()=>a.checkpoint_and_compact(),/SCHEMA_MIGRATION_REQUIRED/);
    assert.equal(db.db.prepare('SELECT count(*) n FROM events').get().n,1);
    assert.equal(db.db.prepare('SELECT count(*) n FROM checkpoints').get().n,0);
  });
});
