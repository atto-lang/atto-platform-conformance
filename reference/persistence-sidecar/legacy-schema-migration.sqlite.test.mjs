// HOST SQLITE MIGRATION CONTRACT: older BLOBs are never retroactively certified.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {BatchPersistenceSidecar} from './sidecar.mjs';
const tenantId='tenant-migration', actor='old-account', stateName='ledger';
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');

function oldFixture(body,{seedSnapshot=false,seedCommand=false}={}) {
  const dir=mkdtempSync(join(tmpdir(),'atto-old-persist-'));
  const path=join(dir,'legacy.sqlite');
  try {
    const raw=new DatabaseSync(path);
    raw.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE fences(tenant TEXT NOT NULL,actor TEXT NOT NULL,
        epoch INTEGER NOT NULL,PRIMARY KEY(tenant,actor));
      CREATE TABLE heads(tenant TEXT NOT NULL,actor TEXT NOT NULL,
        state_name TEXT NOT NULL,version INTEGER NOT NULL,
        PRIMARY KEY(tenant,actor,state_name));
      CREATE TABLE snapshots(tenant TEXT NOT NULL,actor TEXT NOT NULL,
        state_name TEXT NOT NULL,version INTEGER NOT NULL,
        schema_version INTEGER NOT NULL,payload BLOB NOT NULL,
        PRIMARY KEY(tenant,actor,state_name));
      CREATE TABLE events(tenant TEXT NOT NULL,actor TEXT NOT NULL,
        state_name TEXT NOT NULL,version INTEGER NOT NULL,
        schema_version INTEGER NOT NULL,op_id TEXT NOT NULL,
        payload BLOB NOT NULL,PRIMARY KEY(tenant,actor,state_name,version));
      CREATE TABLE operations(tenant TEXT NOT NULL,actor TEXT NOT NULL,
        state_name TEXT NOT NULL,op_id TEXT NOT NULL,digest TEXT NOT NULL,
        version INTEGER NOT NULL,kind TEXT NOT NULL,
        PRIMARY KEY(tenant,actor,state_name,op_id));
      CREATE TABLE command_commits(tenant TEXT NOT NULL,actor TEXT NOT NULL,
        state_name TEXT NOT NULL,op_id TEXT NOT NULL,
        command_hash TEXT NOT NULL,first_version INTEGER NOT NULL,
        last_version INTEGER NOT NULL,event_count INTEGER NOT NULL,
        result_bytes BLOB NOT NULL,
        PRIMARY KEY(tenant,actor,state_name,op_id));
    `);
    raw.prepare('INSERT INTO fences VALUES(?,?,?)').run(tenantId,actor,1);
    raw.prepare('INSERT INTO heads VALUES(?,?,?,?)').run(tenantId,actor,stateName,1);
    if(seedSnapshot) {
      raw.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,?)')
        .run(tenantId,actor,stateName,1,1,Buffer.from('balance=100'));
      raw.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?,?)')
        .run(tenantId,actor,stateName,'old-snapshot','legacy-digest',1,'snapshot');
    }
    if(seedCommand) {
      const commandBytes=Buffer.from('deposit:100');
      raw.prepare('INSERT INTO command_commits VALUES(?,?,?,?,?,?,?,?,?)')
        .run(tenantId,actor,stateName,'old-command',
          sha(commandBytes),1,1,1,Buffer.from('100'));
    }
    raw.close();
    const sidecar=new BatchPersistenceSidecar({path,tenantId});
    try {body(sidecar);} finally {sidecar.close();}
  } finally {rmSync(dir,{recursive:true,force:true});}
}

test('old SQLite tables gain nullable proofs without silently trusting history',()=>{
  oldFixture(db=>{
    const columns=(table)=>db.db.prepare('PRAGMA table_info('+table+')').all().map(r=>r.name);
    assert(columns('snapshots').includes('payload_hash'));
    assert(columns('snapshots').includes('operation_digest'));
    assert(columns('operations').includes('payload_hash'));
    assert(columns('operations').includes('origin_epoch'));
    assert.equal(db.db.prepare(
      'SELECT origin_epoch FROM operations WHERE tenant=? AND actor=? AND state_name=? AND op_id=?'
    ).get(tenantId,actor,stateName,'old-snapshot').origin_epoch,null);
    assert(columns('command_commits').includes('events_digest'));
    assert(columns('command_commits').includes('result_digest'));
    assert.throws(()=>db.loadFenced({tenantId,actor,stateName,epoch:1}),/UNVERIFIED_SNAPSHOT/);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n,1);
    // Quarantine cannot spill across actor IDs: a new actor still commits.
    db.grantEpoch({tenantId,actor:'fresh-account',epoch:1});
    assert.equal(db.enqueue({tenantId,actor:'fresh-account',stateName,opId:'fresh-op',
      epoch:1,expectedVersion:0,schemaVersion:1,kind:'event',payload:Buffer.from('ok')}).status,'admitted');
    assert.equal(db.flush()[0].durable,true);
    assert.equal(db.loadFenced({tenantId,actor:'fresh-account',stateName,epoch:1}).events.length,1);
  },{seedSnapshot:true});
});

test('pre-upgrade command record without digests can never become a durable duplicate',()=>{
  oldFixture(db=>{
    const commandBytes=Buffer.from('deposit:100'),opId='old-command';
    assert.throws(()=>db.verifyCommand({tenantId,actor,stateName,opId,epoch:1,
      commandBytes}),/UNVERIFIED_COMMAND_RECORD/);
    assert.throws(()=>db.enqueueCommand({tenantId,actor,stateName,opId,epoch:1,
      expectedVersion:0,schemaVersion:1,commandBytes,
      events:[Buffer.from('amount=100')],resultBytes:Buffer.from('100')}),
      /UNVERIFIED_COMMAND_RECORD/);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM events').get().n,0);
  },{seedCommand:true});
});
