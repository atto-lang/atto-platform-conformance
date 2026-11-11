// HOST REFERENCE ONLY: durable journal/command-ledger integrity, not .ores guest execution.
import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BatchPersistenceSidecar} from './sidecar.mjs';

const require_hash=(b)=>createHash('sha256').update(b).digest('hex');
function fixture(body) {
  const dir=mkdtempSync(join(tmpdir(),'atto-ledger-hardening-'));
  const db=new BatchPersistenceSidecar({path:join(dir,'test.sqlite'),tenantId:'tenant-hardening'});
  try {
    db.grantEpoch({tenantId:'tenant-hardening',actor:'account-1',epoch:1});
    body(db);
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
}
const load=(db,epoch=1)=>db.loadFenced({tenantId:'tenant-hardening',
  actor:'account-1',stateName:'ledger',epoch});
const base={tenantId:'tenant-hardening',actor:'account-1',stateName:'ledger'};
const command=(opId='command-1',expectedVersion=0,events=[10,20])=>({
  ...base,opId,epoch:1,expectedVersion,schemaVersion:1,
  commandBytes:Buffer.from('deposit:'+events.join(',')),
  events:events.map(n=>Buffer.from(JSON.stringify({cents:n}))),
  resultBytes:Buffer.from(JSON.stringify({balance_cents:events.reduce((a,b)=>a+b,0)}))
});
const legacy=(opId='legacy-1',expectedVersion=0,kind='event')=>({
  ...base,opId,epoch:1,expectedVersion,schemaVersion:1,kind,
  payload:Buffer.from(JSON.stringify({cents:7}))
});
const commit=(db,item,isCommand=false)=>{
  assert.equal((isCommand?db.enqueueCommand(item):db.enqueue(item)).status,'admitted');
  const [r]=db.flush();
  assert.equal(r.status,'committed');
  return r;
};

test('replay admits both legacy event proofs and multi-event command ledger',()=>{
  fixture(db=>{
    commit(db,legacy());
    const c=command('logical-1',1,[10,20]);
    assert.equal(commit(db,c,true).version,3);
    const recovered=load(db);
    assert.equal(recovered.version,3);
    assert.deepEqual(recovered.events.map(e=>e.version),[1,2,3]);
    assert.deepEqual(recovered.events.map(e=>e.opId),['legacy-1','logical-1','logical-1']);
    assert.equal(db.verifyCommand({...base,opId:'logical-1',epoch:1,
      commandBytes:c.commandBytes}).version,3);
  });
});

test('deleting a legacy operation proof fails recovery without an unsafe partial journal',()=>{
  fixture(db=>{
    commit(db,legacy());
    db.db.prepare('DELETE FROM operations WHERE tenant=? AND actor=? AND state_name=? AND op_id=?')
      .run(base.tenantId,base.actor,base.stateName,'legacy-1');
    assert.throws(()=>load(db),/INCOMPLETE_OPERATION_LEDGER/);
  });
});

test('deleting a multi-event command record fails recovery (cannot trust bare events)',()=>{
  fixture(db=>{
    commit(db,command(),true);
    db.db.prepare('DELETE FROM command_commits WHERE tenant=? AND actor=? AND state_name=? AND op_id=?')
      .run(base.tenantId,base.actor,base.stateName,'command-1');
    assert.throws(()=>load(db),/INCOMPLETE_OPERATION_LEDGER/);
  });
});

test('altered command version range fails recovery even when event versions are contiguous',()=>{
  fixture(db=>{
    commit(db,command(),true);
    db.db.prepare('UPDATE command_commits SET first_version=2 WHERE tenant=? AND actor=? AND state_name=?')
      .run(base.tenantId,base.actor,base.stateName);
    assert.throws(()=>load(db),/INCOMPLETE_OPERATION_LEDGER/);
  });
});

test('deleted middle event in command produces JOURNAL_GAP',()=>{
  fixture(db=>{
    commit(db,command(),true);
    db.db.prepare('DELETE FROM events WHERE tenant=? AND actor=? AND state_name=? AND version=1')
      .run(base.tenantId,base.actor,base.stateName);
    assert.throws(()=>load(db),/JOURNAL_GAP/);
  });
});

test('oversized SQLite event payload rejects replay without full BLOB materialization',()=>{
  fixture(db=>{
    commit(db,command(),true);
    db.db.prepare('UPDATE events SET payload=zeroblob(1048577) WHERE tenant=? AND actor=? AND state_name=? AND version=1')
      .run(base.tenantId,base.actor,base.stateName);
    assert.throws(()=>load(db),/INVALID_ACTOR_EVENT/);
  });
});

test('unbounded journal head fails before allocating a long replay list',()=>{
  fixture(db=>{
    commit(db,command(),true);
    db.db.prepare('UPDATE heads SET version=10001 WHERE tenant=? AND actor=? AND state_name=?')
      .run(base.tenantId,base.actor,base.stateName);
    assert.throws(()=>load(db),/ACTOR_JOURNAL_REPLAY_LIMIT/);
  });
});

test('snapshot barrier plus later command only replays post-snapshot events',()=>{
  fixture(db=>{
    commit(db,command('first',0,[10,20]),true);
    commit(db,{...legacy('snap',2,'snapshot'),
      payload:Buffer.from(JSON.stringify({balance_cents:30}))});
    commit(db,command('second',3,[5]),true);
    const restored=load(db);
    assert.equal(restored.version,4);
    assert.equal(restored.snapshot.version,3);
    assert.equal(restored.events.length,1);
    assert.equal(restored.events[0].version,4);
    assert.equal(db.verifyCommand({...base,opId:'first',epoch:1,
      commandBytes:Buffer.from('deposit:10,20')}).version,2);
  });
});

test('fenced replay refuses an outdated activation epoch',()=>{
  fixture(db=>{
    commit(db,command(),true);
    db.grantEpoch({tenantId:base.tenantId,actor:base.actor,epoch:2});
    assert.throws(()=>load(db,1),/STALE_EPOCH/);
    assert.equal(load(db,2).version,2);
  });
});


test('valid-looking mutated domain event is denied by durable command event digest',()=>{
  fixture(db=>{
    const c=command();commit(db,c,true);
    db.db.prepare('UPDATE events SET payload=? WHERE tenant=? AND actor=? AND state_name=? AND version=1')
      .run(Buffer.from('{"cents":99}'),base.tenantId,base.actor,base.stateName);
    assert.throws(()=>load(db),/INCOMPLETE_COMMAND_JOURNAL/);
    assert.throws(()=>db.verifyCommand({...base,opId:c.opId,epoch:1,
      commandBytes:c.commandBytes}),/INCOMPLETE_COMMAND_JOURNAL/);
  });
});

test('tampered command result bytes are never returned as a durable duplicate',()=>{
  fixture(db=>{
    const c=command();commit(db,c,true);
    db.db.prepare('UPDATE command_commits SET result_bytes=? WHERE tenant=? AND actor=? AND state_name=? AND op_id=?')
      .run(Buffer.from('{"balance_cents":999}'),base.tenantId,base.actor,base.stateName,c.opId);
    assert.throws(()=>db.verifyCommand({...base,opId:c.opId,epoch:1,
      commandBytes:c.commandBytes}),/CORRUPT_COMMAND_RESULT/);
    assert.throws(()=>db.enqueueCommand(c),/CORRUPT_COMMAND_RESULT/);
  });
});

test('old unverified command ledger entry cannot silently gain durable status',()=>{
  fixture(db=>{
    const c=command();commit(db,c,true);
    db.db.prepare('UPDATE command_commits SET events_digest=NULL WHERE tenant=? AND actor=? AND state_name=? AND op_id=?')
      .run(base.tenantId,base.actor,base.stateName,c.opId);
    assert.throws(()=>load(db),/UNVERIFIED_COMMAND_RECORD/);
    assert.throws(()=>db.verifyCommand({...base,opId:c.opId,epoch:1,
      commandBytes:c.commandBytes}),/UNVERIFIED_COMMAND_RECORD/);
  });
});

test('after an authenticated snapshot barrier, compaction retains durable command dedupe',()=>{
  fixture(db=>{
    const c=command();commit(db,c,true);
    const snapshot={...legacy('snapshot-1',2,'snapshot'),
      payload:Buffer.from('{"balance_cents":100}')};
    commit(db,snapshot);
    db.db.prepare('DELETE FROM events WHERE tenant=? AND actor=? AND state_name=? AND version<=2')
      .run(base.tenantId,base.actor,base.stateName);
    db.grantEpoch({tenantId:base.tenantId,actor:base.actor,epoch:2});
    const restored=load(db,2);
    assert.equal(restored.snapshot.version,3);
    assert.equal(restored.events.length,0);
    const proof=db.verifyCommand({...base,opId:c.opId,epoch:2,
      commandBytes:c.commandBytes});
    assert.equal(proof.version,2);
    const duplicate=db.enqueueCommand({...c,epoch:2});
    assert.equal(duplicate.duplicate,true);
    assert.equal(db.flush().length,0);
  });
});


test('tampered checkpoint BLOB never authorizes replay or dedupe after journal pruning',()=>{
  fixture(db=>{
    const c=command();commit(db,c,true);
    commit(db,{...legacy('snapshot-1',2,'snapshot'),
      payload:Buffer.from('{"balance_cents":100}')});
    db.db.prepare('DELETE FROM events WHERE tenant=? AND actor=? AND state_name=? AND version<=2')
      .run(base.tenantId,base.actor,base.stateName);
    db.db.prepare('UPDATE snapshots SET payload=? WHERE tenant=? AND actor=? AND state_name=?')
      .run(Buffer.from('{"balance_cents":999}'),base.tenantId,base.actor,base.stateName);
    db.grantEpoch({tenantId:base.tenantId,actor:base.actor,epoch:2});
    assert.throws(()=>load(db,2),/CORRUPT_SNAPSHOT_PROOF/);
    assert.throws(()=>db.verifyCommand({...base,opId:c.opId,epoch:2,
      commandBytes:c.commandBytes}),/CORRUPT_SNAPSHOT_PROOF/);
  });
});

test('snapshot proof remains invalid when attacker replaces BLOB and recomputes only its payload hash',()=>{
  fixture(db=>{
    const c=command();commit(db,c,true);
    commit(db,{...legacy('checkpoint-2',2,'snapshot'),
      payload:Buffer.from('{"balance_cents":100}')});
    const altered=Buffer.from('{"balance_cents":999}');
    // An attacker updating snapshot and checksum must also forge the separate
    // operation digest to avoid the independent on-disk ledger mismatch.
    db.db.prepare('UPDATE snapshots SET payload=?,payload_hash=? WHERE tenant=? AND actor=? AND state_name=?')
      .run(altered,require_hash(altered),base.tenantId,base.actor,base.stateName);
    assert.throws(()=>load(db),/CORRUPT_SNAPSHOT_PROOF|UNVERIFIED_SNAPSHOT/);
    assert.throws(()=>db.verifyCommand({...base,opId:c.opId,epoch:1,
      commandBytes:c.commandBytes}),/CORRUPT_SNAPSHOT_PROOF|UNVERIFIED_SNAPSHOT/);
  });
});

test('deleting original snapshot operation ledger refuses recovery and dedup receipts',()=>{
  fixture(db=>{
    const c=command();commit(db,c,true);
    commit(db,{...legacy('snapshot-delete',2,'snapshot'),
      payload:Buffer.from('{"balance_cents":100}')});
    db.db.prepare('DELETE FROM operations WHERE tenant=? AND actor=? AND state_name=? AND kind=?')
      .run(base.tenantId,base.actor,base.stateName,'snapshot');
    assert.throws(()=>load(db),/UNVERIFIED_SNAPSHOT/);
    assert.throws(()=>db.verifyCommand({...base,opId:c.opId,epoch:1,
      commandBytes:c.commandBytes}),/UNVERIFIED_SNAPSHOT/);
  });
});

test('snapshots without digests fail closed instead of silent legacy backfill',()=>{
  fixture(db=>{
    const c=command();commit(db,c,true);
    commit(db,{...legacy('snapshot-upgrade',2,'snapshot'),
      payload:Buffer.from('{"balance_cents":100}')});
    db.db.prepare('UPDATE snapshots SET payload_hash=NULL,operation_digest=NULL WHERE tenant=? AND actor=? AND state_name=?')
      .run(base.tenantId,base.actor,base.stateName);
    assert.throws(()=>load(db),/UNVERIFIED_SNAPSHOT/);
    assert.throws(()=>db.verifyCommand({...base,opId:c.opId,epoch:1,
      commandBytes:c.commandBytes}),/UNVERIFIED_SNAPSHOT/);
  });
});


test('modified legacy single-event bytes must not replay as valid actor state',()=>{
  fixture(db=>{
    commit(db,legacy());
    db.db.prepare('UPDATE events SET payload=? WHERE tenant=? AND actor=? AND state_name=? AND version=1')
      .run(Buffer.from('{"cents":999}'),base.tenantId,base.actor,base.stateName);
    assert.throws(()=>load(db),/CORRUPT_LEGACY_EVENT/);
  });
});

test('unverified pre-upgrade legacy event cannot silently become trusted replay',()=>{
  fixture(db=>{
    commit(db,legacy());
    db.db.prepare('UPDATE operations SET payload_hash=NULL WHERE tenant=? AND actor=? AND state_name=? AND kind=?')
      .run(base.tenantId,base.actor,base.stateName,'event');
    assert.throws(()=>load(db),/UNVERIFIED_LEGACY_EVENT/);
  });
});


test('legacy ACK and duplicate are refused after journal BLOB alteration',()=>{
  fixture(db=>{
    const write=legacy('legacy-blob');
    commit(db,write);
    assert.equal(db.verifyCommit(write).version,1);
    assert.equal(db.enqueue(write).duplicate,true);
    db.db.prepare('UPDATE events SET payload=? WHERE tenant=? AND actor=? AND state_name=? AND version=1')
      .run(Buffer.from('{"cents":999}'),base.tenantId,base.actor,base.stateName);
    assert.throws(()=>db.verifyCommit(write),/INCOMPLETE_OPERATION_LEDGER/);
    assert.throws(()=>db.enqueue(write),/INCOMPLETE_OPERATION_LEDGER/);
  });
});

test('legacy ACK and duplicate are refused after event deletion',()=>{
  fixture(db=>{
    const write=legacy('legacy-missing');
    commit(db,write);
    db.db.prepare('DELETE FROM events WHERE tenant=? AND actor=? AND state_name=? AND version=1')
      .run(base.tenantId,base.actor,base.stateName);
    assert.throws(()=>db.verifyCommit(write),/INCOMPLETE_OPERATION_LEDGER/);
    assert.throws(()=>db.enqueue(write),/INCOMPLETE_OPERATION_LEDGER/);
  });
});

test('legacy and command operation IDs collide in either direction',()=>{
  fixture(db=>{
    const c=command('shared-logical-id',0,[10,20]);
    commit(db,c,true);
    assert.throws(()=>db.enqueue(legacy('shared-logical-id',2)),/OP_ID_CONFLICT/);
    const old=legacy('shared-legacy-id',2);
    commit(db,old);
    assert.throws(()=>db.enqueueCommand(command('shared-legacy-id',3,[1])),/OP_ID_CONFLICT/);
    assert.equal(load(db).version,3);
  });
});

test('valid current snapshot supports same-byte duplicate but rejects altered checkpoint',()=>{
  fixture(db=>{
    const snap={...legacy('checkpoint-proof',0,'snapshot'),
      payload:Buffer.from('{"balance_cents":12}')};
    commit(db,snap);
    assert.equal(db.verifyCommit(snap).version,1);
    assert.equal(db.enqueue(snap).duplicate,true);
    db.db.prepare('UPDATE snapshots SET payload=? WHERE tenant=? AND actor=? AND state_name=?')
      .run(Buffer.from('{"balance_cents":999}'),base.tenantId,base.actor,base.stateName);
    assert.throws(()=>db.verifyCommit(snap),/INCOMPLETE_OPERATION_LEDGER/);
    assert.throws(()=>db.enqueue(snap),/INCOMPLETE_OPERATION_LEDGER/);
  });
});


test('custom large batching limits cannot admit events above immutable 1 MiB replay ceiling',()=>{
  fixture(db=>{
    db.maxPayloadBytes=2*1048576;
    db.maxBatchBytes=2*1048576;
    assert.throws(()=>db.enqueue({...legacy('oversized'),payload:Buffer.alloc(1048577)}),
      /PAYLOAD_TOO_LARGE/);
    assert.throws(()=>db.enqueueCommand({...command('oversized-command',0,[1]),events:[Buffer.alloc(1048577)]}),/PAYLOAD_TOO_LARGE/);
    assert.equal(db.queue.length,0);
  });
});


test('replay event-count ceiling rejects 10001st event but snapshot opens new suffix',()=>{
  fixture(db=>{
    db.db.exec('BEGIN IMMEDIATE');
    try {
      const insert=db.db.prepare(
        'INSERT INTO events(tenant,actor,state_name,version,schema_version,op_id,payload) VALUES(?,?,?,?,?,?,?)');
      const proof=db.db.prepare(
        'INSERT INTO operations(tenant,actor,state_name,op_id,digest,version,kind,payload_hash,origin_epoch) VALUES(?,?,?,?,?,?,?,?,?)');
      const empty=Buffer.alloc(0),payloadHash=require_hash(empty);
      for(let n=1;n<=10000;n++) {
        const opId='seed-'+n;
        insert.run(base.tenantId,base.actor,base.stateName,n,1,opId,empty);
        const digest=require_hash(Buffer.from(JSON.stringify([
          base.tenantId,base.actor,base.stateName,opId,1,n-1,
          'event',1,empty.toString('base64')
        ])));
        proof.run(base.tenantId,base.actor,base.stateName,opId,
                  digest,n,'event',payloadHash,1);
      }
      db.putHead.run(base.tenantId,base.actor,base.stateName,10000);
      db.db.exec('COMMIT');
    } catch(error) {db.db.exec('ROLLBACK');throw error;}
    assert.equal(db.enqueue(legacy('overflow-event',10000)).status,'admitted');
    const rejected=db.flush()[0];
    assert.equal(rejected.code,'REPLAY_LIMIT_EXCEEDED');
    assert.equal(rejected.durable,false);
    assert.equal(db.getHead.get(base.tenantId,base.actor,base.stateName).version,10000);
    // The checkpoint clears the replay suffix without dropping historical
    // op IDs, so a new post-checkpoint event may subsequently be written.
    assert.equal(commit(db,{...legacy('checkpoint-cap',10000,'snapshot'),
      payload:Buffer.from('trusted-checkpoint')}).version,10001);
    assert.equal(commit(db,legacy('after-checkpoint',10001)).version,10002);
    const restored=load(db);
    assert.equal(restored.snapshot.version,10001);
    assert.equal(restored.events.length,1);
    assert.equal(restored.events[0].version,10002);
  });
});

test('replay 16 MiB byte ceiling refuses later multi-event command and isolates actors',()=>{
  fixture(db=>{
    db.db.exec('BEGIN IMMEDIATE');
    try {
      const insert=db.db.prepare(
        'INSERT INTO events(tenant,actor,state_name,version,schema_version,op_id,payload) '+
        'VALUES(?,?,?,?,?,?,zeroblob(1048576))');
      for(let n=1;n<=16;n++)
        insert.run(base.tenantId,base.actor,base.stateName,n,1,'seed-large-'+n);
      db.putHead.run(base.tenantId,base.actor,base.stateName,16);
      db.db.exec('COMMIT');
    } catch(error) {db.db.exec('ROLLBACK');throw error;}
    const other={...base,actor:'other-account'};
    db.grantEpoch({tenantId:other.tenantId,actor:other.actor,epoch:1});
    const exceeded=command('overflow-bytes',16,[1,2]);
    assert.equal(db.enqueueCommand(exceeded).status,'admitted');
    assert.equal(db.enqueue({...legacy('unrelated',0),...other}).status,'admitted');
    const outcome=db.flush();
    assert.deepEqual(outcome.map(x=>x.status),['rejected','committed']);
    assert.equal(outcome[0].code,'REPLAY_LIMIT_EXCEEDED');
    assert.equal(db.getHead.get(base.tenantId,base.actor,base.stateName).version,16);
    assert.equal(db.getHead.get(other.tenantId,other.actor,other.stateName).version,1);
  });
});


test('corrupt checkpoint cannot authorize another durable event via replay-capacity accounting',()=>{
  fixture(db=>{
    const snap={...legacy('trusted-checkpoint',0,'snapshot'),
      payload:Buffer.from('balance=100')};
    commit(db,snap);
    db.db.prepare('UPDATE snapshots SET payload=? WHERE tenant=? AND actor=? AND state_name=?')
      .run(Buffer.from('balance=999'),base.tenantId,base.actor,base.stateName);
    assert.equal(db.enqueue(legacy('unsafe-after-corruption',1)).status,'admitted');
    assert.throws(()=>db.flush(),/OUTCOME_UNKNOWN/);
    assert.equal(db.getHead.get(base.tenantId,base.actor,base.stateName).version,1);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM events').get().n,0);
  });
});


test('missing journal row cannot be hidden by a fresh snapshot checkpoint',()=>{
  fixture(db=>{
    commit(db,legacy('written'));
    db.db.prepare('DELETE FROM events WHERE tenant=? AND actor=? AND state_name=? AND version=1')
      .run(base.tenantId,base.actor,base.stateName);
    const checkpoint={...legacy('launder-gap',1,'snapshot'),
      payload:Buffer.from('checkpoint')};
    assert.equal(db.enqueue(checkpoint).status,'admitted');
    assert.throws(()=>db.flush(),/OUTCOME_UNKNOWN/);
    assert.equal(db.getHead.get(base.tenantId,base.actor,base.stateName).version,1);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n,0);
  });
});

test('same-length mutated event cannot be laundered into a durable checkpoint',()=>{
  fixture(db=>{
    commit(db,legacy('proof-before'));
    db.db.prepare('UPDATE events SET payload=? WHERE tenant=? AND actor=? AND state_name=? AND version=1')
      .run(Buffer.from('{"cents":8}'),base.tenantId,base.actor,base.stateName);
    const checkpoint={...legacy('launder-bytes',1,'snapshot'),
      payload:Buffer.from('checkpoint')};
    assert.equal(db.enqueue(checkpoint).status,'admitted');
    assert.throws(()=>db.flush(),/OUTCOME_UNKNOWN/);
    assert.equal(db.getHead.get(base.tenantId,base.actor,base.stateName).version,1);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n,0);
  });
});


test('uncommitted future event row beyond the head cannot create phantom replay capacity',()=>{
  fixture(db=>{
    commit(db,legacy('trusted-first'));
    db.db.prepare(
      'INSERT INTO events(tenant,actor,state_name,version,schema_version,op_id,payload) '+
      'VALUES(?,?,?,?,?,?,?)'
    ).run(base.tenantId,base.actor,base.stateName,3,1,
      'forged-future',Buffer.from('{"cents":9}'));
    assert.equal(db.enqueue(legacy('must-not-advance',1)).status,'admitted');
    assert.throws(()=>db.flush(),/OUTCOME_UNKNOWN/);
    assert.equal(db.getHead.get(base.tenantId,base.actor,base.stateName).version,1);
    assert.equal(db.db.prepare(
      'SELECT COUNT(*) AS n FROM operations WHERE tenant=? AND actor=? AND state_name=?'
    ).get(base.tenantId,base.actor,base.stateName).n,1);
  });
});


test('rewriting both legacy event bytes and their payload hash cannot bypass full original digest',()=>{
  fixture(db=>{
    const first=legacy('event-coordinated-tamper');
    commit(db,first);
    const bytes=Buffer.from('{"cents":7}');
    const changed=Buffer.from('{"cents":8}');
    db.db.prepare('UPDATE events SET payload=? WHERE tenant=? AND actor=? AND state_name=? AND version=1')
      .run(changed,base.tenantId,base.actor,base.stateName);
    db.db.prepare('UPDATE operations SET payload_hash=? WHERE tenant=? AND actor=? AND state_name=? AND op_id=?')
      .run(require_hash(changed),base.tenantId,base.actor,base.stateName,first.opId);
    assert.throws(()=>load(db),/CORRUPT_LEGACY_EVENT/);
    assert.equal(db.db.prepare('SELECT version FROM heads WHERE actor=?').get(base.actor).version,1);
  });
});

test('snapshot payload plus both hashes cannot bypass original operation digest',()=>{
  fixture(db=>{
    const checkpoint={...legacy('snapshot-coordinated-tamper',0,'snapshot'),
      payload:Buffer.from('balance=100')};
    commit(db,checkpoint);
    const changed=Buffer.from('balance=900');
    const h=require_hash(changed);
    db.db.prepare('UPDATE snapshots SET payload=?,payload_hash=? WHERE tenant=? AND actor=? AND state_name=?')
      .run(changed,h,base.tenantId,base.actor,base.stateName);
    db.db.prepare('UPDATE operations SET payload_hash=? WHERE tenant=? AND actor=? AND state_name=? AND op_id=?')
      .run(h,base.tenantId,base.actor,base.stateName,checkpoint.opId);
    assert.throws(()=>load(db),/CORRUPT_SNAPSHOT_PROOF/);
    assert.equal(db.db.prepare('SELECT version FROM snapshots WHERE actor=?').get(base.actor).version,1);
  });
});

test('legacy original epoch is verified after supervisor epoch rotation',()=>{
  fixture(db=>{
    const e=legacy('prior-epoch-event');
    commit(db,e);
    db.grantEpoch({tenantId:base.tenantId,actor:base.actor,epoch:2});
    assert.equal(db.loadFenced({...base,epoch:2}).events.length,1);
    db.db.prepare('UPDATE operations SET origin_epoch=? WHERE tenant=? AND actor=? AND state_name=? AND op_id=?')
      .run(2,base.tenantId,base.actor,base.stateName,e.opId);
    assert.throws(()=>db.loadFenced({...base,epoch:2}),/CORRUPT_LEGACY_EVENT/);
  });
});


test('legacy event retains durable duplicate receipt after verified snapshot compaction and epoch2 retry',()=>{
  fixture(db=>{
    const e=legacy('compacted-event');
    commit(db,e);
    const checkpoint={...legacy('checkpoint-after-event',1,'snapshot'),
      payload:Buffer.from('balance=7')};
    commit(db,checkpoint);
    db.db.prepare('DELETE FROM events WHERE tenant=? AND actor=? AND state_name=? AND version=1')
      .run(base.tenantId,base.actor,base.stateName);
    db.grantEpoch({tenantId:base.tenantId,actor:base.actor,epoch:2});
    assert.equal(load(db,2).snapshot.version,2);
    assert.equal(load(db,2).events.length,0);
    const retried={...e,epoch:2};
    assert.equal(db.verifyCommit(retried).version,1);
    const duplicate=db.enqueue(retried);
    assert.equal(duplicate.status,'committed');
    assert.equal(duplicate.durable,true);
    assert.equal(duplicate.duplicate,true);
    assert.equal(duplicate.version,1);
    assert.equal(db.flush().length,0);
    assert.equal(db.getHead.get(base.tenantId,base.actor,base.stateName).version,2);
    assert.throws(()=>db.enqueue(e),/STALE_EPOCH/);
    assert.throws(()=>db.enqueue({...retried,payload:Buffer.from('different')}),
      /OP_ID_CONFLICT/);
  });
});

test('superseded snapshot keeps historical operation receipt through actor epoch rotation',()=>{
  fixture(db=>{
    const first={...legacy('checkpoint-old',0,'snapshot'),payload:Buffer.from('v1')};
    const second={...legacy('checkpoint-new',1,'snapshot'),payload:Buffer.from('v2')};
    commit(db,first);commit(db,second);
    db.grantEpoch({tenantId:base.tenantId,actor:base.actor,epoch:2});
    assert.equal(load(db,2).snapshot.version,2);
    assert.equal(db.verifyCommit({...first,epoch:2}).version,1);
    assert.equal(db.enqueue({...first,epoch:2}).duplicate,true);
    assert.equal(db.getHead.get(base.tenantId,base.actor,base.stateName).version,2);
    assert.throws(()=>db.enqueue({...first,epoch:2,payload:Buffer.from('fake')}),
      /OP_ID_CONFLICT/);
  });
});

test('tampered active checkpoint cannot authenticate compacted legacy duplicate',()=>{
  fixture(db=>{
    const e=legacy('compacted-tamper-event');
    commit(db,e);
    const snap={...legacy('checkpoint-tampered',1,'snapshot'),
      payload:Buffer.from('balance=7')};
    commit(db,snap);
    db.db.prepare('DELETE FROM events WHERE tenant=? AND actor=? AND state_name=? AND version=1')
      .run(base.tenantId,base.actor,base.stateName);
    db.db.prepare('UPDATE snapshots SET payload=? WHERE tenant=? AND actor=? AND state_name=?')
      .run(Buffer.from('balance=9'),base.tenantId,base.actor,base.stateName);
    db.grantEpoch({tenantId:base.tenantId,actor:base.actor,epoch:2});
    assert.throws(()=>db.verifyCommit({...e,epoch:2}),/CORRUPT_SNAPSHOT_PROOF/);
    assert.throws(()=>db.enqueue({...e,epoch:2}),/CORRUPT_SNAPSHOT_PROOF/);
    assert.equal(db.getHead.get(base.tenantId,base.actor,base.stateName).version,2);
  });
});
