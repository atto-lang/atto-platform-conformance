import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CriticalGateModel } from '../lib/critical-suspension-model.mjs';
import { verifyCriticalSuspensionReceipt } from '../bin/verify-critical-suspension-receipt.mjs';

const manifest = JSON.parse(await readFile(new URL('../contracts/v1/critical-suspension-v1.json', import.meta.url), 'utf8'));
const cases = manifest.cases;
const passCodes = Object.freeze({
  'compile-pass': { compiler_accepted: true },
  'compile-reject': { compiler_rejected: true, diagnostic_code: 'E_EXPECTED_REJECTION' },
  runtime: { native_guest_executed: true }
});
const receipt = () => ({
  schema: 'oreslang.critical-suspension.receipt/1',
  backend: 'java-graal', source_commit_sha: 'a'.repeat(40),
  source_tree_sha: 'b'.repeat(40), fixture_tree_sha: 'c'.repeat(40),
  compiler_sha256: 'd'.repeat(64), exact_tree_verified: true,
  executed_steps: 9, runner_id: 42, runner_admission_only: false,
  compiler_invoked: true, cross_backend_parity: false,
  cases: Object.fromEntries(cases.map(c =>
    [c.id, { phase: c.phase, status: 'pass', ...passCodes[c.phase] }]))
});

test('contract has distinct portable compiler and guest gates', () => {
  assert.deepEqual(manifest.target_backends,
    ['java-graal','llvm','cranelift','dotnet-nativeaot','wasm']);
  assert.equal(manifest.status, 'proposed-unimplemented');
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
  assert.ok(cases.length >= 30);
  for (const phase of ['compile-pass', 'compile-reject', 'runtime'])
    assert.ok(cases.filter(c => c.phase === phase).length >= 8);
  assert.equal(manifest.required_semantics.critical_body_must_not_suspend, true);
  assert.equal(manifest.required_semantics.serial_actor_turn_distinct_from_mutex, true);
});

test('uncontended enter uses a synchronous fast-path lease', () => {
  const gate = new CriticalGateModel();
  const entered = gate.enter('first');
  assert.equal(entered.suspended, false);
  assert.equal(gate.owner, entered.lease);
  gate.release(entered.lease);
  assert.equal(gate.owner, null);
});

test('contended entry is a queued continuation with FIFO handoff', async () => {
  const gate = new CriticalGateModel();
  const first = gate.enter('first');
  const second = gate.enter('second');
  const third = gate.enter('third');
  assert.equal(second.suspended, true);
  assert.equal(third.suspended, true);
  gate.release(first.lease);
  const secondLease = await second.completion;
  assert.equal(secondLease.task, 'second');
  gate.release(secondLease);
  const thirdLease = await third.completion;
  assert.equal(thirdLease.task, 'third');
  gate.release(thirdLease);
});

test('try enter never enqueues and cannot bypass a waiter', () => {
  const gate = new CriticalGateModel();
  const first = gate.tryEnter('first');
  assert.ok(first);
  const next = gate.enter('queued');
  assert.equal(gate.tryEnter('bypass'), null);
  assert.equal(gate.waiters.length, 1);
  next.completion.catch(() => {});
  next.cancel();
  gate.release(first);
});

test('cancel queued waiter retires its ticket exactly once', async () => {
  const gate = new CriticalGateModel();
  const first = gate.enter('first');
  const pending = gate.enter('second');
  assert.equal(pending.cancel(), true);
  assert.equal(pending.cancel(), false);
  await assert.rejects(pending.completion, /cancelled/);
  gate.release(first.lease);
  assert.equal(gate.owner, null);
});

test('handoff wins versus later cancellation once, not twice', async () => {
  const gate = new CriticalGateModel();
  const first = gate.enter('first');
  const pending = gate.enter('second');
  gate.release(first.lease);
  assert.equal(pending.cancel(), false);
  const lease = await pending.completion;
  gate.release(lease);
  assert.throws(() => gate.release(lease), /double release/);
});

test('retirement rejects queued tickets without reclaiming active body prematurely', async () => {
  const gate = new CriticalGateModel(7);
  const running = gate.enter('first', 7);
  const pending = gate.enter('second', 7);
  assert.equal(gate.retire(), true);
  assert.equal(gate.retire(), false);
  await assert.rejects(pending.completion, /retired/);
  assert.equal(gate.owner, running.lease);
  gate.release(running.lease);
  assert.equal(gate.owner, null);
  assert.throws(() => gate.enter('stale', 7), /retired/);
});

test('generation mismatch cannot acquire or release another gate', () => {
  const old = new CriticalGateModel(4);
  const current = new CriticalGateModel(5);
  const lease = old.tryEnter('old', 4);
  assert.throws(() => current.tryEnter('stale', 4), /stale/);
  assert.throws(() => current.release(lease), /foreign/);
  old.release(lease);
});

test('recursion does not grant second lease', () => {
  const gate = new CriticalGateModel();
  const lease = gate.tryEnter('owner');
  assert.equal(gate.tryEnter('owner'), null);
  gate.release(lease);
});

test('a complete receipt remains unauthenticated even if internally consistent', () => {
  assert.equal(verifyCriticalSuspensionReceipt(receipt(), manifest).classification,
    'ONE_BACKEND_RECORD_CONSISTENT_UNATTESTED');
});

test('zero-step and runner-id zero are not execution evidence', () => {
  for (const patch of [{ executed_steps: 0 }, { executed_steps: null },
      { runner_id: 0 }, { runner_admission_only: true }]) {
    assert.throws(() => verifyCriticalSuspensionReceipt({...receipt(), ...patch}, manifest));
  }
});

test('incomplete, pending, skipped and wrong-phase cases fail closed', () => {
  const id = cases[0].id;
  for (const mode of ['delete', 'skip', 'wrong-phase']) {
    const r = receipt();
    if (mode === 'delete') delete r.cases[id];
    if (mode === 'skip') r.cases[id].status = 'skip';
    if (mode === 'wrong-phase') r.cases[id].phase = 'runtime';
    assert.throws(() => verifyCriticalSuspensionReceipt(r, manifest));
  }
});

test('runtime guest execution and compile-negative diagnostics are mandatory', () => {
  const runtime = cases.find(c => c.phase === 'runtime').id;
  const negative = cases.find(c => c.phase === 'compile-reject').id;
  const positive = cases.find(c => c.phase === 'compile-pass').id;
  for (const [id, field] of [[runtime, 'native_guest_executed'],
      [negative, 'compiler_rejected'], [positive, 'compiler_accepted']]) {
    const r = receipt();
    r.cases[id][field] = false;
    assert.throws(() => verifyCriticalSuspensionReceipt(r, manifest));
  }
  const r = receipt();
  delete r.cases[negative].diagnostic_code;
  assert.throws(() => verifyCriticalSuspensionReceipt(r, manifest));
});

test('a lone backend cannot claim cross-backend parity', () => {
  const r = receipt();
  r.cross_backend_parity = true;
  assert.throws(() => verifyCriticalSuspensionReceipt(r, manifest), /cross-backend/);
});

test('missing exact-tree and compiler identity fail closed', () => {
  for (const patch of [{exact_tree_verified:false}, {compiler_invoked:false},
     {source_tree_sha:'unknown'}, {compiler_sha256:'unknown'}]) {
    assert.throws(() => verifyCriticalSuspensionReceipt({...receipt(), ...patch}, manifest));
  }
});

