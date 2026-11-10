// HOST REFERENCE ONLY: durable journal/command-ledger integrity, not .ores guest execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BatchPersistenceSidecar} from './sidecar.mjs';

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
