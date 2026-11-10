// Executable Node 22 SQLite HOST REFERENCE only; never a compiled AttoLang actor.
// The same command/event semantics must later run in real .atto source on five
// independent compilers, with independent provenance and OS crash injection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {BatchPersistenceSidecar} from './sidecar.mjs';
import {PolicyActorReference} from './policy-modes.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'atto-bank-event-'));
  const path = join(dir, 'account.sqlite');
  const open = () => new BatchPersistenceSidecar({
    path, tenantId: 'tenant-a', maxBatchEntries: 256,
    maxQueuedEntries: 1024, maxQueuedBytes: 1024 * 1024,
  });
  return {open, close: () => rmSync(dir, {recursive:true, force:true})};
}
function reducer(previous, event) {
  if (!Number.isSafeInteger(previous.balance) || previous.balance < 0
      || !Number.isSafeInteger(event.amount) || event.amount <= 0) {
    throw new Error('INVALID_EVENT');
  }
  if (event.kind === 'MoneyDeposited') {
    const balance = previous.balance + event.amount;
    if (!Number.isSafeInteger(balance)) throw new Error('OVERFLOW');
    return {balance};
  }
  if (event.kind === 'MoneyWithdrawn') {
    if (event.amount > previous.balance) throw new Error('REPLAY_INVALID_WITHDRAWAL');
    return {balance: previous.balance - event.amount};
  }
  throw new Error('UNKNOWN_EVENT');
}
function account(db, actor = 'bank-42', epoch = 1) {
  return new PolicyActorReference({
    sidecar: db, tenantId: 'tenant-a', actor, epoch,
    stateName: 'main', initialState:{balance:0},
    reducer, policy:'#event_sourced', schemaVersion:1,
  });
}
const balance = actor => actor.handle_state('critical-read', s => s.balance);
function decide(actor, command) {
  return actor.handle_state('critical-read', s => {
    if (!Number.isSafeInteger(command.amount) || command.amount <= 0)
      throw new Error('INVALID_AMOUNT');
    if (command.kind === 'deposit') {
      if (!Number.isSafeInteger(s.balance + command.amount))
        throw new Error('OVERFLOW');
      return {kind:'MoneyDeposited', amount:command.amount};
    }
    if (command.kind === 'withdraw') {
      if (command.amount > s.balance) throw new Error('INSUFFICIENT_FUNDS');
      return {kind:'MoneyWithdrawn', amount:command.amount};
    }
    throw new Error('UNKNOWN_COMMAND');
  });
}

test('BankAccount host: decide -> admitted -> commit -> publish -> replay', () => {
  const f = fixture();
  try {
    let db = f.open();
    db.grantEpoch({tenantId:'tenant-a', actor:'bank-42', epoch:1});
    let actor = account(db);
    const deposit = decide(actor, {kind:'deposit', amount:100});
    assert.equal(actor.stage_event('dep-100', deposit).durable, false);
    assert.equal(balance(actor), 0, 'admitted-only event published state');
    const first = db.flush()[0];
    assert.equal(first.status, 'committed');
    assert.equal(first.durable, true);
    actor.apply_commit(first);
    assert.equal(balance(actor), 100);

    assert.throws(() => decide(actor, {kind:'withdraw', amount:101}), /INSUFFICIENT_FUNDS/);
    assert.equal(actor.version, 1);
    assert.equal(db.flush().length, 0, 'invalid command wrote to journal');

    assert.equal(actor.stage_event('wd-30',
      decide(actor,{kind:'withdraw',amount:30})).durable, false);
    assert.equal(balance(actor), 100);
    actor.apply_commit(db.flush()[0]);
    assert.equal(balance(actor), 70);
    db.close();

    db = f.open();
    actor = account(db);
    actor.restore();
    assert.equal(actor.version, 2);
    assert.equal(balance(actor), 70);
    db.close();
  } finally { f.close(); }
});

test('BankAccount host: lost ACK must not publish before trusted operation lookup', () => {
  const f = fixture();
  try {
    const db = f.open();
    db.grantEpoch({tenantId:'tenant-a', actor:'bank-42', epoch:1});
    const actor = account(db);
    assert.equal(actor.stage_event('dep-lost',
      decide(actor,{kind:'deposit',amount:42})).status, 'admitted');
    assert.equal(actor.resolve_pending().status, 'pending');
    assert.equal(balance(actor), 0);
    assert.equal(db.flush()[0].durable, true);
    // Simulate lost commit acknowledgment to the owner actor:
    assert.equal(balance(actor), 0);
    const resolved = actor.resolve_pending();
    assert.equal(resolved.durable, true);
    assert.equal(resolved.version, 1);
    assert.equal(balance(actor), 42);
    db.close();
  } finally { f.close(); }
});

test('BankAccount host: new epoch can replay, but old command ID cannot double append', () => {
  const f = fixture();
  try {
    let db = f.open();
    db.grantEpoch({tenantId:'tenant-a', actor:'bank-42', epoch:1});
    const oldActor = account(db);
    oldActor.stage_event('deposit-op', decide(oldActor,{kind:'deposit',amount:42}));
    assert.equal(db.flush()[0].durable,true);
    db.close();

    db = f.open();
    db.grantEpoch({tenantId:'tenant-a', actor:'bank-42', epoch:2});
    assert.throws(() => account(db,'bank-42',1).restore(), /STALE_EPOCH/);
    const newActor = account(db,'bank-42',2);
    newActor.restore();
    assert.equal(balance(newActor),42);
    assert.equal(newActor.version,1);
    assert.throws(() => newActor.stage_event('deposit-op',
      {kind:'MoneyDeposited',amount:42}), /OP_ID_CONFLICT/);
    assert.equal(balance(newActor),42);
    assert.equal(db.flush().length,0);
    assert.equal(db.loadFenced({tenantId:'tenant-a',actor:'bank-42',
      stateName:'main',epoch:2}).events.length,1);
    db.close();
  } finally {f.close();}
});

test('BankAccount host: two independent actors share a storage batch without early visibility',()=>{
  const f=fixture();
  try {
    const db=f.open();
    for (const name of ['alice','bob'])
      db.grantEpoch({tenantId:'tenant-a',actor:name,epoch:1});
    const alice=account(db,'alice'),bob=account(db,'bob');
    alice.stage_event('alice-1',decide(alice,{kind:'deposit',amount:25}));
    bob.stage_event('bob-1',decide(bob,{kind:'deposit',amount:80}));
    assert.equal(balance(alice),0);
    assert.equal(balance(bob),0);
    const receipts=db.flush();
    assert.equal(receipts.length,2);
    assert.ok(receipts.every(r=>r.status==='committed' && r.durable));
    for(const r of receipts) (r.opId==='alice-1'?alice:bob).apply_commit(r);
    assert.equal(balance(alice),25);
    assert.equal(balance(bob),80);
    db.close();
  } finally {f.close();}
});

test('BankAccount host: forged rejection preserves unresolved durable identity',()=>{
  const f=fixture();
  try {
    const db=f.open();
    db.grantEpoch({tenantId:'tenant-a',actor:'bank-42',epoch:1});
    const actor=account(db);
    actor.stage_event('dep-pending',decide(actor,{kind:'deposit',amount:7}));
    assert.throws(()=>actor.apply_commit({opId:'dep-pending',status:'rejected'}),
      /OUTCOME_UNKNOWN/);
    assert.equal(balance(actor),0);
    assert.equal(actor.has_pending_write,true);
    db.flush();
    assert.equal(actor.resolve_pending().status,'committed');
    assert.equal(balance(actor),7);
    db.close();
  }finally{f.close();}
});

test('BankAccount host: corrupted journal never publishes partially replayed state',()=>{
  const f=fixture();
  try {
    const db=f.open();
    db.grantEpoch({tenantId:'tenant-a',actor:'bank-42',epoch:1});
    const actor=account(db);
    actor.stage_event('dep-corrupt',{kind:'MoneyDeposited',amount:55});
    actor.apply_commit(db.flush()[0]);
    // Trusted test fault injection, not guest authorization.
    db.db.prepare("DELETE FROM events WHERE actor='bank-42' AND version=1").run();
    const restarted=account(db);
    assert.throws(()=>restarted.restore(), /JOURNAL_GAP/);
    assert.equal(balance(restarted),0);
    db.close();
  }finally{f.close();}
});
