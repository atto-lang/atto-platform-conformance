import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BatchPersistenceSidecar} from './sidecar.mjs';
import {PolicyActorReference} from './policy-modes.mjs';
import {BankAccountCommandReference,apply_bank_event} from './bank-account-reference.mjs';

// Real OS-level SIGKILL + Node 22 built-in SQLite WAL/FULL durability model.
// NOT power-loss simulation, a compiled .ores actor, or supervisor execution.
const refs={
  sidecar:new URL('./sidecar.mjs',import.meta.url).href,
  policy:new URL('./policy-modes.mjs',import.meta.url).href,
  bank:new URL('./bank-account-reference.mjs',import.meta.url).href
};
const t='tenant-a';
const grant=(db,actor,epoch)=>db.grantEpoch({tenantId:t,actor,epoch});
function bank(db,epoch) {
  const actor=new PolicyActorReference({sidecar:db,tenantId:t,actor:'bank',
    stateName:'main',epoch,policy:'#event_sourced',
    initialState:{balance_cents:0},reducer:apply_bank_event,schemaVersion:1});
  return new BankAccountCommandReference({actor,sidecar:db,tenantId:t,
    actorId:'bank',stateName:'main',epoch});
}
function counter(db,epoch) {
  return new PolicyActorReference({sidecar:db,tenantId:t,actor:'counter',
    stateName:'main',epoch,policy:'#event_sourced',initialState:{sum:0},
    reducer:(s,e)=>({sum:s.sum+e.delta}),schemaVersion:1});
}
const recovered=(db,epoch)=>{const a=bank(db,epoch);a.restore();return a;};
const journal=(db,actor,epoch)=>db.loadFenced({tenantId:t,actor,stateName:'main',epoch});
const deposit=amount_cents=>({kind:'deposit',amount_cents});
const commit=(a,db,id,n)=>{
  assert.equal(a.submit(id,deposit(n)).status,'admitted');
  const [r]=db.flush();
  assert.equal(r.status,'committed');
  assert.equal(a.accept_commit(r).status,'committed');
};
function killed_process(path,mode) {
  const source=`
    import {BatchPersistenceSidecar} from ${JSON.stringify(refs.sidecar)};
    import {PolicyActorReference} from ${JSON.stringify(refs.policy)};
    import {BankAccountCommandReference,apply_bank_event} from ${JSON.stringify(refs.bank)};
    const mode=${JSON.stringify(mode)}, path=${JSON.stringify(path)};
    const db=new BatchPersistenceSidecar({path,tenantId:'tenant-a'});
    const bank=()=>{
      const actor=new PolicyActorReference({sidecar:db,tenantId:'tenant-a',actor:'bank',
        stateName:'main',epoch:1,policy:'#event_sourced',
        initialState:{balance_cents:0},reducer:apply_bank_event,schemaVersion:1});
      return new BankAccountCommandReference({actor,sidecar:db,tenantId:'tenant-a',
        actorId:'bank',epoch:1});
    };
    const commit=(a,id,n)=>{
      if(a.submit(id,{kind:'deposit',amount_cents:n}).status!=='admitted')throw Error('NO_ADMISSION');
      const result=db.flush()[0];
      if(result?.status!=='committed')throw Error('NO_COMMIT');
      a.accept_commit(result);
    };
    if(mode==='multi_event_abort') {
      db.grantEpoch({tenantId:'tenant-a',actor:'counter',epoch:1});
      const a=new PolicyActorReference({sidecar:db,tenantId:'tenant-a',actor:'counter',
        epoch:1,policy:'#event_sourced',initialState:{sum:0},
        reducer:(s,e)=>({sum:s.sum+e.delta})});
      a.restore();
      a.stage_events('sum-1',Buffer.from('sum:3,4'),[{delta:3},{delta:4}],
        Buffer.from('{"sum":7}'));
      db.db.exec(\`CREATE TRIGGER kill_insert BEFORE INSERT ON events WHEN NEW.version=2
        BEGIN SELECT RAISE(ABORT,'forced SQL abort'); END;\`);
      let failed=false;
      try{db.flush();}catch(e){failed=String(e).includes('OUTCOME_UNKNOWN');}
      if(!failed)throw Error('EXPECTED_SQL_ROLLBACK');
    } else {
      db.grantEpoch({tenantId:'tenant-a',actor:'bank',epoch:1});
      const a=bank();a.restore();
      if(a.submit('deposit-001',{kind:'deposit',amount_cents:100}).status!=='admitted')
        throw Error('NO_ADMISSION');
      if(mode!=='admission_only') {
        const [receipt]=db.flush();
        if(receipt?.status!=='committed')throw Error('NO_COMMIT');
        if(mode!=='commit_before_ack') {
          a.accept_commit(receipt);
          if(mode==='checkpoint_committed'||mode==='tail_commit_no_ack'||
             mode==='checkpoint_abort'||mode==='checkpoint_mid_transaction_sigkill') {
            if(mode==='checkpoint_abort') {
              db.db.exec(\`CREATE TRIGGER kill_prune BEFORE DELETE ON events
                BEGIN SELECT RAISE(ABORT,'forced SQL abort'); END;\`);
              let failed=false;
              try{a.checkpoint_and_compact();}catch(e){failed=String(e).includes('OUTCOME_UNKNOWN');}
              if(!failed)throw Error('EXPECTED_CHECKPOINT_ROLLBACK');
            } else if(mode==='checkpoint_mid_transaction_sigkill') {
              // Terminate DURING the same SQLite BEGIN IMMEDIATE transaction,
              // after the checkpoint and manifest INSERTs but before COMMIT.
              db.db.function('kill_mid_prune',()=>{
                process.kill(process.pid,'SIGKILL');
              });
              db.db.exec(\`CREATE TRIGGER kill_mid_prune BEFORE DELETE ON events
                BEGIN SELECT kill_mid_prune(); END;\`);
              a.checkpoint_and_compact();
              throw Error('EXPECTED_SIGNAL_INSIDE_SQLITE');
            } else {
              if(a.checkpoint_and_compact().version!==1)throw Error('CHECKPOINT_FAILED');
              if(mode==='tail_commit_no_ack') {
                if(a.submit('deposit-002',{kind:'deposit',amount_cents:25}).status!=='admitted')
                  throw Error('NO_TAIL_ADMISSION');
                if(db.flush()[0]?.status!=='committed')throw Error('NO_TAIL_COMMIT');
              }
            }
          } else throw Error('UNKNOWN_MODE');
        }
      }
    }
    // No graceful close or actor acknowledgment after the selected crash point.
    process.kill(process.pid,'SIGKILL');
  `;
  const child=spawnSync(process.execPath,
    ['--disable-warning=ExperimentalWarning','--input-type=module','-e',source],
    {encoding:'utf8',timeout:15000});
  assert.equal(child.error,undefined,child.stderr||child.stdout);
  assert.equal(child.signal,'SIGKILL',
    `mode=${mode}; status=${child.status}; stderr=${child.stderr}; stdout=${child.stdout}`);
}
function fixture(mode,fn) {
  const dir=mkdtempSync(join(tmpdir(),'atto-sigkill-'));
  const path=join(dir,'journal.sqlite');
  let db=null;
  try {
    killed_process(path,mode);
    const open=()=>new BatchPersistenceSidecar({path,tenantId:t});
    db=open();
    fn({db,open,reopen:()=>{db.close();db=open();return db;}});
  } finally {try{db?.close();}catch{}rmSync(dir,{recursive:true,force:true});}
}

test('SIGKILL after admission but before SQLite flush: retry commits exactly once',()=>{
  fixture('admission_only',({db})=>{
    grant(db,'bank',2);const a=recovered(db,2);
    assert.equal(a.version,0);assert.equal(a.balance_cents,0);
    commit(a,db,'deposit-001',100);
    assert.equal(a.balance_cents,100);
    assert.equal(journal(db,'bank',2).events.length,1);
  });
});
test('SIGKILL after DB commit before actor ACK: epoch-2 retry never appends twice',()=>{
  fixture('commit_before_ack',({db})=>{
    grant(db,'bank',2);const a=recovered(db,2);
    assert.equal(a.version,1);assert.equal(a.balance_cents,100);
    assert.equal(a.submit('deposit-001',deposit(100)).duplicate,true);
    assert.equal(db.flush().length,0);
    assert.equal(journal(db,'bank',2).events.length,1);
  });
});
test('SIGKILL immediately after checkpoint+prune: old command remains deduplicated',()=>{
  fixture('checkpoint_committed',({db})=>{
    grant(db,'bank',2);const a=recovered(db,2);
    assert.equal(a.version,1);assert.equal(a.balance_cents,100);
    const x=journal(db,'bank',2);
    assert.equal(x.events.length,0);assert.equal(x.snapshot.version,1);
    assert.equal(a.submit('deposit-001',deposit(100)).duplicate,true);
    assert.equal(db.db.prepare('SELECT command_count FROM checkpoint_index_manifests')
      .get().command_count,1);
  });
});
test('SIGKILL after checkpoint then second commit without ACK: replay tail and compact',()=>{
  fixture('tail_commit_no_ack',({db,reopen})=>{
    grant(db,'bank',2);let a=recovered(db,2);
    assert.equal(a.balance_cents,125);assert.equal(a.version,2);
    assert.equal(a.submit('deposit-002',deposit(25)).duplicate,true);
    assert.equal(journal(db,'bank',2).events.length,1);
    assert.equal(a.checkpoint_and_compact().prunedEvents,1);
    db=reopen();grant(db,'bank',3);a=recovered(db,3);
    assert.equal(a.balance_cents,125);
    assert.equal(a.submit('deposit-001',deposit(100)).duplicate,true);
    assert.equal(a.submit('deposit-002',deposit(25)).duplicate,true);
    assert.equal(journal(db,'bank',3).events.length,0);
  });
});
test('SIGKILL after injected prune rollback: original journal fully recoverable',()=>{
  fixture('checkpoint_abort',({db})=>{
    grant(db,'bank',2);const a=recovered(db,2);
    assert.equal(a.balance_cents,100);
    assert.equal(journal(db,'bank',2).snapshot,null);
    assert.equal(journal(db,'bank',2).events.length,1);
    assert.equal(a.submit('deposit-001',deposit(100)).duplicate,true);
    db.db.exec('DROP TRIGGER kill_prune');
    assert.equal(a.checkpoint_and_compact().prunedEvents,1);
  });
});
test('SIGKILL after second-event transaction abort: no partial state or command index',()=>{
  fixture('multi_event_abort',({db})=>{
    grant(db,'counter',2);const a=counter(db,2);
    a.restore();assert.equal(a.version,0);
    assert.equal(a.handle_state('critical-read',s=>s.sum),0);
    assert.equal(journal(db,'counter',2).events.length,0);
    assert.equal(db.db.prepare('SELECT count(*) AS n FROM command_commits').get().n,0);
    db.db.exec('DROP TRIGGER kill_insert');
    assert.equal(a.stage_events('sum-1',Buffer.from('sum:3,4'),
      [{delta:3},{delta:4}],Buffer.from('{"sum":7}')).status,'admitted');
    a.apply_commit(db.flush()[0]);
    assert.equal(a.version,2);
    assert.equal(a.handle_state('critical-read',s=>s.sum),7);
  });
});

test('SIGKILL inside SQLite DELETE trigger rolls back checkpoint and index manifest',()=>{
  fixture('checkpoint_mid_transaction_sigkill',({db})=>{
    grant(db,'bank',2);
    const a=recovered(db,2);
    assert.equal(a.balance_cents,100);
    assert.equal(a.version,1);
    assert.equal(journal(db,'bank',2).snapshot,null);
    assert.equal(journal(db,'bank',2).events.length,1);
    assert.equal(db.db.prepare('SELECT count(*) AS n FROM checkpoints').get().n,0);
    assert.equal(db.db.prepare('SELECT count(*) AS n FROM checkpoint_index_manifests').get().n,0);
    assert.equal(db.db.prepare('SELECT count(*) AS n FROM command_commits').get().n,1);
    assert.equal(a.submit('deposit-001',deposit(100)).duplicate,true);
    // The test-only SQL crash hook remains in schema after process death.
    // Drop it under trusted host control before attempting recovery compaction.
    db.db.exec('DROP TRIGGER kill_mid_prune');
    assert.equal(a.checkpoint_and_compact().prunedEvents,1);
  });
});
