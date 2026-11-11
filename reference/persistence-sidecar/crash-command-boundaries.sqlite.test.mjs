// REAL Node 22 SQLite sidecar subprocess crash-boundary tests.
// Not .ores guest AOT proof, hardware power-cut durability or Java parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BatchPersistenceSidecar} from './sidecar.mjs';

const child=fileURLToPath(new URL('./crash-command-child.mjs',import.meta.url));
const identity={tenantId:'tenant-crash',actor:'bank-1',stateName:'main'};
const command=(epoch=2)=>({...identity,opId:'deposit-100',epoch,
  expectedVersion:0,schemaVersion:1,
  commandBytes:Buffer.from('deposit:100'),
  events:[Buffer.from('{"delta":40}'),Buffer.from('{"delta":60}')],
  resultBytes:Buffer.from('{"balance_cents":100}')});
const load=db=>db.loadFenced({...identity,epoch:2});
const proof=(db,epoch=2)=>db.verifyCommand({...identity,opId:'deposit-100',
  epoch,commandBytes:Buffer.from('deposit:100')});

function withCrashedChild(phase,inspect) {
  const root=mkdtempSync(join(tmpdir(),'atto-actual-flush-sigkill-'));
  const path=join(root,'ledger.sqlite');
  try {
    const killed=spawnSync(process.execPath,
      ['--disable-warning=ExperimentalWarning',child,path,phase],
      {encoding:'utf8',timeout:15000});
    assert.equal(killed.error,undefined,String(killed.error));
    assert.equal(killed.signal,'SIGKILL',
      'phase='+phase+' status='+killed.status+' stdout='+killed.stdout+
      ' stderr='+killed.stderr);
    const db=new BatchPersistenceSidecar({path,tenantId:identity.tenantId});
    try {
      db.grantEpoch({tenantId:identity.tenantId,actor:identity.actor,epoch:2});
      inspect(db);
    } finally {db.close();}
  } finally {rmSync(root,{recursive:true,force:true});}
}

for(const phase of ['before-begin','after-first-event']) {
  test('process SIGKILL '+phase+': atomic events, stream head and command receipt are absent',()=>{
    withCrashedChild(phase,db=>{
      assert.equal(load(db).version,0);
      assert.equal(load(db).events.length,0);
      assert.equal(proof(db),null);
      assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM events').get().n,0);
      assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM command_commits').get().n,0);
      const queued=db.enqueueCommand(command());
      assert.equal(queued.status,'admitted');
      const [result]=db.flush();
      assert.equal(result.status,'committed');
      assert.equal(result.durable,true);
      assert.deepEqual(load(db).events.map(e=>e.version),[1,2]);
      assert.deepEqual(load(db).events.map(e=>e.payload.toString()),
        ['{"delta":40}','{"delta":60}']);
      assert.equal(proof(db).version,2);
    });
  });
}

test('SIGKILL immediately after actual COMMIT: lost ACK is deduplicated after epoch rotation',()=>{
  withCrashedChild('after-commit',db=>{
    const recovered=load(db);
    assert.equal(recovered.version,2);
    assert.deepEqual(recovered.events.map(e=>e.version),[1,2]);
    assert.deepEqual(recovered.events.map(e=>e.payload.toString()),
      ['{"delta":40}','{"delta":60}']);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM events').get().n,2);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM command_commits').get().n,1);
    const verified=proof(db);
    assert.equal(verified.durable,true);
    assert.equal(verified.version,2);
    assert.equal(verified.resultBytes.toString(),'{"balance_cents":100}');
    const duplicate=db.enqueueCommand(command());
    assert.equal(duplicate.durable,true);
    assert.equal(duplicate.duplicate,true);
    assert.equal(duplicate.version,2);
    assert.equal(db.flush().length,0);
    assert.equal(load(db).version,2);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM events').get().n,2);
    assert.throws(()=>db.enqueueCommand({...command(),commandBytes:Buffer.from('deposit:999')}),
      /OP_ID_CONFLICT/);
    assert.throws(()=>proof(db,1),/STALE_EPOCH/);
  });
});
