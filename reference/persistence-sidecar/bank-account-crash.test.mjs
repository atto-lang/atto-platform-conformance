// HOST REFERENCE ONLY. Exercises real SQLite commit/reopen plus abrupt OS process
// termination; it does NOT compile or execute an AttoLang (.ores) guest actor.
// Run: node --disable-warning=ExperimentalWarning --test reference/persistence-sidecar/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BatchPersistenceSidecar} from './sidecar.mjs';
import {PolicyActorReference} from './policy-modes.mjs';

const TENANT = 'tenant-bank', ACTOR = 'account-42', SLOT = 'ledger';
const location = fileURLToPath(import.meta.url);
function reducer(state, event) {
  if (!['MoneyDeposited', 'MoneyWithdrawn'].includes(event.type) ||
      !Number.isSafeInteger(event.cents) || event.cents <= 0)
    throw new Error('INVALID_DOMAIN_EVENT');
  const delta = event.type === 'MoneyDeposited' ? event.cents : -event.cents;
  const next = state.balance_cents + delta;
  if (!Number.isSafeInteger(next) || next < 0) throw new Error('INVALID_BALANCE');
  return {balance_cents: next};
}
const actor = (db, epoch) => new PolicyActorReference({
  sidecar: db, tenantId: TENANT, actor: ACTOR, stateName: SLOT, epoch,
  policy: '#event_sourced', schemaVersion: 1, initialState: {balance_cents: 0},
  reducer
});
const balance = (a) => a.handle_state('critical-read', s => s.balance_cents);
const open = (path) => new BatchPersistenceSidecar({path, tenantId: TENANT});
function append(a, db, id, event, acknowledge = true) {
  const admitted = a.stage_event(id, event);
  assert.equal(admitted.durable, false, 'admitted != committed');
  const [receipt] = db.flush();
  assert.equal(receipt?.status, 'committed');
  assert.equal(receipt?.durable, true);
  if (acknowledge) a.apply_commit(receipt);
  return receipt;
}
function runCrash(path, mode) {
  const child = spawnSync(process.execPath, [
    '--disable-warning=ExperimentalWarning', location, mode, path
  ], {encoding: 'utf8', timeout: 15000});
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.signal, 'SIGKILL',
    `expected deliberate SIGKILL; exit=${child.status}; stderr=${child.stderr}`);
  assert.equal(child.status, null);
}
function withStore(action) {
  const dir = mkdtempSync(join(tmpdir(), 'ores-bank-crash-'));
  try { return action(join(dir, 'bank.sqlite')); }
  finally { rmSync(dir, {recursive:true, force:true}); }
}

// Child process intentionally never closes SQLite, invokes a recovery hook or
// acknowledges the second write: the OS terminates it immediately after COMMIT.
if (process.argv[2] === '--after-commit' || process.argv[2] === '--before-commit') {
  const mode = process.argv[2], db = open(process.argv[3]);
  db.grantEpoch({tenantId:TENANT, actor:ACTOR, epoch:1});
  const a = actor(db, 1);
  if (mode === '--after-commit') {
    append(a, db, 'deposit-100', {type:'MoneyDeposited',cents:10000});
    assert.equal(balance(a), 10000);
    append(a, db, 'deposit-50', {type:'MoneyDeposited',cents:5000}, false);
    assert.equal(balance(a), 10000, 'unacknowledged candidate became visible');
  } else {
    assert.equal(a.stage_event('not-committed', {type:'MoneyDeposited',cents:3700}).status, 'admitted');
    assert.equal(balance(a), 0);
  }
  process.kill(process.pid, 'SIGKILL');
  throw new Error('SIGKILL_FAILED');
} else {
  test('bank actor: committed journal survives SIGKILL before ACK; duplicate never re-applies', {
    skip: process.platform === 'win32' ? 'POSIX SIGKILL required' : false
  }, () => withStore(path => {
    runCrash(path, '--after-commit');
    const db = open(path);
    try {
      db.grantEpoch({tenantId:TENANT, actor:ACTOR, epoch:2});
      const recovered = actor(db, 2);
      recovered.restore();
      assert.equal(balance(recovered), 15000);
      assert.equal(recovered.version, 2);
      assert.equal(db.load({tenantId:TENANT, actor:ACTOR, stateName:SLOT}).events.length, 2);
      // Operations written by a fenced epoch cannot be replayed as new writes.
      assert.throws(() => recovered.stage_event('deposit-50',
        {type:'MoneyDeposited',cents:5000}), /OP_ID_CONFLICT/);
      assert.equal(balance(recovered), 15000);
      // Deterministic command validation before staging an event.
      assert.throws(() => recovered.stage_event('overdraft',
        {type:'MoneyWithdrawn',cents:20000}), /INVALID_BALANCE/);
      assert.equal(balance(recovered), 15000);
      assert.equal(db.flush().length, 0);
      const admitted = recovered.stage_event('withdraw-25',
        {type:'MoneyWithdrawn',cents:2500});
      assert.equal(admitted.durable, false);
      assert.equal(balance(recovered), 15000);
      const [receipt] = db.flush();
      recovered.apply_commit(receipt);
      assert.equal(balance(recovered), 12500);
      assert.equal(recovered.version, 3);
    } finally { db.close(); }
  }));

  test('bank actor: SIGKILL before flush loses admitted event, and retry may commit', {
    skip: process.platform === 'win32' ? 'POSIX SIGKILL required' : false
  }, () => withStore(path => {
    runCrash(path, '--before-commit');
    const db = open(path);
    try {
      db.grantEpoch({tenantId:TENANT, actor:ACTOR, epoch:2});
      const recovered = actor(db, 2);
      recovered.restore();
      assert.equal(balance(recovered), 0);
      assert.equal(recovered.version, 0);
      assert.equal(db.load({tenantId:TENANT, actor:ACTOR, stateName:SLOT}).events.length, 0);
      append(recovered, db, 'not-committed', {type:'MoneyDeposited',cents:3700});
      assert.equal(balance(recovered), 3700);
      assert.equal(recovered.version, 1);
    } finally { db.close(); }
  }));

  test('bank actor: incomplete journal refuses recovery without publishing partial state', () =>
    withStore(path => {
      const db = open(path);
      try {
        db.grantEpoch({tenantId:TENANT, actor:ACTOR, epoch:1});
        const a = actor(db, 1);
        append(a, db, 'first', {type:'MoneyDeposited',cents:1000});
        append(a, db, 'second', {type:'MoneyDeposited',cents:2000});
        db.db.prepare('DELETE FROM events WHERE tenant=? AND actor=? AND state_name=? AND version=?')
          .run(TENANT, ACTOR, SLOT, 1);
        db.grantEpoch({tenantId:TENANT, actor:ACTOR, epoch:2});
        const recovered = actor(db, 2);
        assert.throws(() => recovered.restore(), /JOURNAL_GAP/);
        assert.equal(balance(recovered), 0);
        assert.equal(recovered.version, 0);
      } finally { db.close(); }
    }));
  test('bank actor: oversized journal BLOB is rejected before materialization or state publication', () =>
    withStore(path => {
      const db = open(path);
      try {
        db.grantEpoch({tenantId:TENANT, actor:ACTOR, epoch:1});
        const a = actor(db, 1);
        append(a, db, 'valid-event', {type:'MoneyDeposited',cents:1000});
        db.db.prepare('UPDATE events SET payload=zeroblob(1048577) WHERE tenant=? AND actor=? AND state_name=? AND version=1')
          .run(TENANT, ACTOR, SLOT);
        db.grantEpoch({tenantId:TENANT, actor:ACTOR, epoch:2});
        const recovered = actor(db, 2);
        assert.throws(() => recovered.restore(), /INVALID_ACTOR_EVENT/);
        assert.equal(balance(recovered), 0);
        assert.equal(recovered.version, 0);
      } finally { db.close(); }
    }));
  test('bank actor: excessive declared replay depth fails closed before allocating events', () =>
    withStore(path => {
      const db = open(path);
      try {
        db.grantEpoch({tenantId:TENANT, actor:ACTOR, epoch:1});
        const a = actor(db, 1);
        append(a, db, 'valid-event', {type:'MoneyDeposited',cents:1000});
        db.db.prepare('UPDATE heads SET version=? WHERE tenant=? AND actor=? AND state_name=?')
          .run(10001, TENANT, ACTOR, SLOT);
        db.grantEpoch({tenantId:TENANT, actor:ACTOR, epoch:2});
        const recovered = actor(db, 2);
        assert.throws(() => recovered.restore(), /ACTOR_JOURNAL_REPLAY_LIMIT/);
        assert.equal(balance(recovered), 0);
      } finally { db.close(); }
    }));

  test('bank actor: tampered operation ledger prevents journal replay and state publication', () =>
    withStore(path => {
      const db = open(path);
      try {
        db.grantEpoch({tenantId:TENANT, actor:ACTOR, epoch:1});
        const original = actor(db, 1);
        append(original, db, 'deposit-with-proof', {type:'MoneyDeposited',cents:2000});
        db.db.prepare('DELETE FROM operations WHERE tenant=? AND actor=? AND state_name=? AND op_id=?')
          .run(TENANT, ACTOR, SLOT, 'deposit-with-proof');
        db.grantEpoch({tenantId:TENANT, actor:ACTOR, epoch:2});
        const recovered = actor(db, 2);
        assert.throws(() => recovered.restore(), /INCOMPLETE_OPERATION_LEDGER/);
        assert.equal(balance(recovered), 0);
        assert.equal(recovered.version, 0);
      } finally { db.close(); }
    }));

}
