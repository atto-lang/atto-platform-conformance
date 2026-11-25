import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BatchPersistenceSidecar} from './sidecar.mjs';

// SQLite host contract tests; do not interpret as compiler/guest or power-loss proof.
function fixture(run, config={}) {
  const dir=mkdtempSync(join(tmpdir(),'atto-command-'));
  const path=join(dir,'state.sqlite');
  const instances=[];
  const open=()=>{const db=new BatchPersistenceSidecar({path,tenantId:'tenant-a',...config});instances.push(db);return db;};
  try {run(open);} finally {
    for(const db of instances)try{db.close();}catch{}
    rmSync(dir,{recursive:true,force:true});
  }
}
function grant(db,actor='bank-1',epoch=1){
  db.grantEpoch({tenantId:'tenant-a',actor,epoch});
}
function cmd(overrides={}){
  return {tenantId:'tenant-a',actor:'bank-1',stateName:'main',opId:'deposit-001',
    epoch:1,expectedVersion:0,schemaVersion:1,commandBytes:Buffer.from('deposit:100'),
    events:[Buffer.from('{"delta":40}'),Buffer.from('{"delta":60}')],
    resultBytes:Buffer.from('{"balance_cents":100}'),...overrides};
}
const scope=e=>({tenantId:e.tenantId,actor:e.actor,stateName:e.stateName,
  opId:e.opId,epoch:e.epoch,commandBytes:e.commandBytes});
const state=(db,e)=>db.loadFenced({tenantId:e.tenantId,actor:e.actor,
  stateName:e.stateName,epoch:e.epoch});

test('atomic two-event append and provider-verifiable result',()=>{
  fixture(open=>{
    const db=open();grant(db);const e=cmd();
    assert.equal(db.enqueueCommand(e).status,'admitted');
    assert.equal(db.verifyCommand(scope(e)),null);
    assert.equal(state(db,e).version,0);
    const [receipt]=db.flush();
    assert.equal(receipt.status,'committed');assert.equal(receipt.version,2);
    assert.equal(receipt.firstVersion,1);assert.equal(receipt.eventCount,2);
    assert.deepEqual(state(db,e).events.map(x=>x.version),[1,2]);
    assert.deepEqual(state(db,e).events.map(x=>x.opId),[e.opId,e.opId]);
    assert.equal(db.verifyCommand(scope(e)).resultBytes.toString(),
      e.resultBytes.toString());
  });
});

test('lost ACK plus reopen and new epoch does not duplicate committed deposit',()=>{
  fixture(open=>{
    let db=open();grant(db);const e=cmd();
    db.enqueueCommand(e);db.flush();db.close();
    db=open();grant(db,'bank-1',2);
    const retry=cmd({epoch:2});
    const result=db.enqueueCommand(retry);
    assert.equal(result.duplicate,true);assert.equal(result.version,2);
    assert.equal(result.durable,true);
    assert.equal(db.flush().length,0);
    assert.equal(state(db,retry).events.length,2);
    assert.equal(db.verifyCommand(scope(retry)).version,2);
  });
});

test('same op ID and different command payload is forbidden across epochs',()=>{
  fixture(open=>{
    const db=open();grant(db);db.enqueueCommand(cmd());db.flush();grant(db,'bank-1',2);
    const different=cmd({epoch:2,commandBytes:Buffer.from('deposit:200')});
    assert.throws(()=>db.enqueueCommand(different),/OP_ID_CONFLICT/);
    assert.throws(()=>db.verifyCommand(scope(different)),/OP_ID_CONFLICT/);
  });
});

test('fencing happens before duplicate receipt lookup',()=>{
  fixture(open=>{
    const db=open();grant(db);const e=cmd();db.enqueueCommand(e);db.flush();
    grant(db,'bank-1',2);
    assert.throws(()=>db.enqueueCommand(e),/STALE_EPOCH/);
    assert.throws(()=>db.verifyCommand(scope(e)),/STALE_EPOCH/);
    assert.throws(()=>state(db,e),/STALE_EPOCH/);
  });
});

test('CAS conflict rejects all events and does not record the command',()=>{
  fixture(open=>{
    const db=open();grant(db);db.enqueueCommand(cmd());db.flush();
    const stale=cmd({opId:'deposit-002',expectedVersion:0});
    db.enqueueCommand(stale);
    assert.equal(db.flush()[0].code,'VERSION_CONFLICT');
    assert.equal(db.verifyCommand(scope(stale)),null);
    assert.equal(state(db,cmd()).version,2);
  });
});

test('SQLite abort on second event rolls back first event, head, and command record',()=>{
  fixture(open=>{
    const db=open();grant(db);const e=cmd();
    db.db.exec(`CREATE TRIGGER deny_second BEFORE INSERT ON events
      WHEN NEW.version=2 BEGIN SELECT RAISE(ABORT,'injected'); END;`);
    db.enqueueCommand(e);
    assert.throws(()=>db.flush(),/OUTCOME_UNKNOWN/);
    assert.equal(db.db.prepare('SELECT count(*) n FROM events').get().n,0);
    assert.equal(db.db.prepare('SELECT count(*) n FROM command_commits').get().n,0);
    assert.equal(state(db,e).version,0);
  });
});

test('two actors co-batch with independent stream versions',()=>{
  fixture(open=>{
    const db=open();grant(db,'bank-1');grant(db,'bank-2');
    const a=cmd(),b=cmd({actor:'bank-2',opId:'deposit-002',
      commandBytes:Buffer.from('deposit:50'),events:[Buffer.from('{"delta":50}')]});
    db.enqueueCommand(a);db.enqueueCommand(b);
    assert.deepEqual(db.flush().map(x=>x.version),[2,1]);
    assert.equal(db.verifyCommand(scope(a)).version,2);
    assert.equal(db.verifyCommand(scope(b)).version,1);
  });
});

test('queue copies event buffers; caller mutation cannot rewrite committed event',()=>{
  fixture(open=>{
    const db=open();grant(db);const e=cmd();
    db.enqueueCommand(e);
    e.events[0].fill(65);e.commandBytes.fill(66);
    db.flush();
    assert.equal(state(db,cmd()).events[0].payload.toString(),'{"delta":40}');
    assert.equal(db.verifyCommand(scope(cmd())).version,2);
  });
});

test('reject empty event list, oversize command and zero batch-admission bypass',()=>{
  fixture(open=>{
    const db=open();grant(db);
    assert.throws(()=>db.enqueueCommand(cmd({events:[]})),/INVALID_COMMAND_WRITE/);
    assert.throws(()=>db.enqueueCommand(cmd({commandBytes:Buffer.alloc(65537)})),/PAYLOAD_TOO_LARGE/);
    assert.throws(()=>db.enqueueCommand(cmd({events:[Buffer.alloc(65537),Buffer.alloc(1)]})),/PAYLOAD_TOO_LARGE/);
    assert.equal(db.queue.length,0);
  });
});

test('dedupe index survives event pruning; replay still needs an authenticated snapshot',()=>{
  fixture(open=>{
    const db=open();grant(db);db.enqueueCommand(cmd());db.flush();
    db.db.exec('DELETE FROM events');
    grant(db,'bank-1',2);
    const retry=cmd({epoch:2});
    assert.equal(db.verifyCommand(scope(retry)).version,2);
    assert.equal(db.enqueueCommand(retry).duplicate,true);
    assert.equal(db.flush().length,0);
  });
});

test('legacy single-event path still commits unchanged',()=>{
  fixture(open=>{
    const db=open();grant(db);
    const e={tenantId:'tenant-a',actor:'bank-1',stateName:'old',opId:'old-1',
      epoch:1,expectedVersion:0,kind:'event',schemaVersion:1,
      payload:Buffer.from('{"delta":5}')};
    assert.equal(db.enqueue(e).status,'admitted');
    assert.equal(db.flush()[0].version,1);
    assert.equal(db.verifyCommit(e).version,1);
  });
});

test('multiple commands on one actor preserve version order in one batch',()=>{
  fixture(open=>{
    const db=open();grant(db);
    db.enqueueCommand(cmd());
    db.enqueueCommand(cmd({opId:'withdraw-1',expectedVersion:2,
      commandBytes:Buffer.from('withdraw:10'),events:[Buffer.from('{"delta":-10}')]}));
    const results=db.flush();
    assert.deepEqual(results.map(x=>x.version),[2,3]);
    assert.equal(state(db,cmd()).events.length,3);
  });
});

test('batch byte budget includes canonical command and durable result payloads',()=>{
  fixture(open=>{
    const db=open();grant(db);
    const over=cmd({commandBytes:Buffer.alloc(80),events:[Buffer.alloc(30)],
      resultBytes:Buffer.alloc(30)});
    assert.throws(()=>db.enqueueCommand(over),/PAYLOAD_TOO_LARGE/);
    assert.equal(db.queue.length,0);
  },{maxBatchBytes:100});
});

test('flush splits commands by TOTAL batch bytes, not event bytes alone',()=>{
  fixture(open=>{
    const db=open();grant(db,'bank-1');grant(db,'bank-2');
    const common={commandBytes:Buffer.alloc(20),events:[Buffer.alloc(20)],resultBytes:Buffer.alloc(20)};
    const first=cmd(common);
    const second=cmd({...common,actor:'bank-2',opId:'another-command'});
    assert.equal(db.enqueueCommand(first).status,'admitted');
    assert.equal(db.enqueueCommand(second).status,'admitted');
    assert.equal(db.flush().length,1);
    assert.equal(db.verifyCommand(scope(first)).version,1);
    assert.equal(db.verifyCommand(scope(second)),null);
    assert.equal(db.flush().length,1);
    assert.equal(db.verifyCommand(scope(second)).version,1);
  },{maxBatchBytes:100});
});
