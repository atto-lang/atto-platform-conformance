import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {BatchPersistenceSidecar} from './sidecar.mjs';
import {PolicyActorReference} from './policy-modes.mjs';
import {BankAccountCommandReference,apply_bank_event} from './bank-account-reference.mjs';

// Host-only SQLite integration; not native AttoLang, async-carrier, or source guest proof.
function fixture(run) {
  const dir=mkdtempSync(join(tmpdir(),'atto-command-actor-'));
  const path=join(dir,'actor.sqlite');
  let db;
  const open=()=>db=new BatchPersistenceSidecar({path,tenantId:'tenant-a'});
  try {run(open);}finally {try{db?.close();}catch{}rmSync(dir,{recursive:true,force:true});}
}
const grant=(db,actor,epoch)=>db.grantEpoch({tenantId:'tenant-a',actor,epoch});
const counter=(db,actor='counter',epoch=1,reducer=(s,e)=>({count:s.count+e.delta}))=>
  new PolicyActorReference({sidecar:db,tenantId:'tenant-a',actor,stateName:'main',
    epoch,policy:'#event_sourced',initialState:{count:0},reducer});
const balance=a=>a.handle_state('critical-read',s=>s.count);
const stage=(a,op='cmd-1',deltas=[2,5],result=7)=>a.stage_events(op,
  Buffer.from('counter:+2,+5'),deltas.map(delta=>({delta})),
  Buffer.from(JSON.stringify({count:result})));
const account=(db,epoch=1,actorId='bank-1')=>
  new BankAccountCommandReference({actor:new PolicyActorReference({
    sidecar:db,tenantId:'tenant-a',actor:actorId,stateName:'main',epoch,
    policy:'#event_sourced',initialState:{balance_cents:0},
    reducer:apply_bank_event,schemaVersion:1}),sidecar:db,tenantId:'tenant-a',actorId,epoch});

test('policy stage_events publishes neither event until verified two-event commit',()=>{
  fixture(open=>{
    const db=open();grant(db,'counter',1);
    const actor=counter(db);actor.restore();
    assert.equal(stage(actor).status,'admitted');
    assert.equal(balance(actor),0);assert.equal(actor.version,0);
    const [receipt]=db.flush();
    assert.equal(receipt.version,2);assert.equal(receipt.firstVersion,1);
    assert.equal(receipt.eventCount,2);
    assert.equal(balance(actor),0);
    assert.deepEqual(actor.apply_commit(receipt),{status:'committed',durable:true,version:2});
    assert.equal(balance(actor),7);
    assert.deepEqual(db.loadFenced({tenantId:'tenant-a',actor:'counter',stateName:'main',epoch:1})
      .events.map(e=>e.version),[1,2]);
  });
});

test('forged committed acknowledgment cannot publish either event',()=>{
  fixture(open=>{
    const db=open();grant(db,'counter',1);
    const actor=counter(db);actor.restore();stage(actor);
    assert.throws(()=>actor.apply_commit({opId:'cmd-1',status:'committed',
      durable:true,version:2,firstVersion:1,eventCount:2,
      resultBytes:Buffer.from('{"count":7}')}),/OUTCOME_UNKNOWN/);
    assert.equal(balance(actor),0);assert.equal(actor.has_pending_write,true);
    actor.apply_commit(db.flush()[0]);assert.equal(balance(actor),7);
  });
});

test('lost ACK resumes from durable proof and recovers after an epoch change',()=>{
  fixture(open=>{
    let db=open();grant(db,'counter',1);
    let actor=counter(db);actor.restore();stage(actor);
    assert.equal(actor.resolve_pending().status,'pending');
    db.flush();assert.equal(balance(actor),0);
    assert.equal(actor.resolve_pending().version,2);
    assert.equal(balance(actor),7);
    db.close();db=open();grant(db,'counter',2);
    actor=counter(db,'counter',2);actor.restore();
    assert.equal(actor.version,2);assert.equal(balance(actor),7);
    assert.throws(()=>stage(actor),/RELOAD_REQUIRED/);
    assert.equal(balance(actor),7);
  });
});

test('reducer throw rejects staging with no queued or visible changes',()=>{
  fixture(open=>{
    const db=open();grant(db,'counter',1);
    const actor=counter(db,'counter',1,(s,e)=>{
      if(e.delta===5)throw Error('DOMAIN_REJECTED');
      return {count:s.count+e.delta};
    });
    actor.restore();
    assert.throws(()=>stage(actor),/DOMAIN_REJECTED/);
    assert.equal(actor.version,0);assert.equal(balance(actor),0);
    assert.equal(db.queue.length,0);
  });
});

test('bank actor uses durable command API and stale duplicate cannot succeed',()=>{
  fixture(open=>{
    const db=open();grant(db,'bank-1',1);
    const bank=account(db);bank.restore();
    assert.equal(bank.submit('deposit-1',{kind:'deposit',amount_cents:100}).status,'admitted');
    assert.equal(bank.balance_cents,0);
    const receipt=db.flush()[0];
    assert.equal(receipt.eventCount,1);assert.equal(bank.balance_cents,0);
    bank.accept_commit(receipt);assert.equal(bank.balance_cents,100);
    assert.deepEqual(bank.submit('deposit-1',{kind:'deposit',amount_cents:100}),
      {status:'committed',durable:true,duplicate:true,version:1});
    grant(db,'bank-1',2);
    assert.throws(()=>bank.submit('deposit-1',{kind:'deposit',amount_cents:100}),/STALE_EPOCH/);
    const restarted=account(db,2);restarted.restore();
    assert.equal(restarted.balance_cents,100);
    assert.equal(restarted.submit('deposit-1',{kind:'deposit',amount_cents:100}).duplicate,true);
    assert.equal(db.loadFenced({tenantId:'tenant-a',actor:'bank-1',stateName:'main',epoch:2})
      .events.length,1);
  });
});
