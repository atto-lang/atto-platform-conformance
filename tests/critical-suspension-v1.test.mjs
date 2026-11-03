import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CriticalGateModel } from '../lib/critical-suspension-model.mjs';
import { verifyCriticalSuspensionReceipt } from '../bin/verify-critical-suspension-receipt.mjs';

const manifest = JSON.parse(await readFile(new URL('../contracts/v1/critical-suspension-v1.json', import.meta.url), 'utf8'));
const cases = manifest.cases;
const passCodes = Object.freeze({
  'compile-pass': { compiler_accepted: true, exit_code: 0, timed_out: false, signal: null },
  'compile-reject': { compiler_rejected: true, exit_code: 1, timed_out: false,
    signal: null, emitted_artifact: false },
  runtime: { native_guest_executed: true, guest_mode: 'COMPILED_NATIVE_EXECUTABLE',
    guest_executable_sha256: 'e'.repeat(64), compiler_accepted: true,
    exit_code: 0, timed_out: false, signal: null }
});
const receipt = () => ({
  schema: 'oreslang.critical-suspension.receipt/1',
  backend: 'java-graal', source_commit_sha: 'a'.repeat(40),
  source_tree_sha: 'b'.repeat(40), fixture_tree_sha: 'c'.repeat(40),
  compiler_sha256: 'd'.repeat(64), exact_tree_verified: true,
  executed_steps: 9, runner_id: 42, run_id: 101, job_id: 102,
  run_attempt: 1, test_plan_sha256: 'f'.repeat(64), runner_admission_only: false,
  compiler_invoked: true, cross_backend_parity: false,
  cases: Object.fromEntries(cases.map(c =>
    [c.id, { phase: c.phase, status: 'pass', ...passCodes[c.phase], ...(c.phase === 'compile-reject'
      ? {diagnostic_code:c.expected_diagnostic, stderr:c.expected_diagnostic + ': expected'}
      : {}) }]))
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

test('recursion fails closed instead of being misreported as ordinary contention', () => {
  const gate = new CriticalGateModel();
  const lease = gate.tryEnter('owner');
  assert.throws(() => gate.tryEnter('owner'), /recursive/);
  assert.throws(() => gate.enter('owner'), /recursive/);
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

test('full matrix cannot omit run, job, attempt, or test-plan identity', () => {
  for (const [field,value] of [['run_id',null],['run_id',0],
      ['job_id',null],['job_id',0],['run_attempt',0],
      ['test_plan_sha256','not-a-digest']]) {
    const r=receipt();
    r[field]=value;
    assert.throws(()=>verifyCriticalSuspensionReceipt(r,manifest), /identity required|test_plan_sha256/);
  }
});

test('compile negatives reject unrelated first diagnostics, crashes, timeouts and emitted objects', () => {
  const negative=cases.find(c=>c.phase==='compile-reject');
  for (const [field,value] of [
    ['stderr', 'E_UNKNOWN: earlier failure; ' + negative.expected_diagnostic + ': later'],
    ['exit_code',-11],['exit_code',0],['signal','SIGSEGV'],
    ['timed_out',true],['emitted_artifact',true],
    ['compiler_accepted',true]
  ]) {
    const r=receipt();r.cases[negative.id][field]=value;
    assert.throws(()=>verifyCriticalSuspensionReceipt(r,manifest));
  }
});

test('full native runtime cannot be relabeled Graal Polyglot or host-only', () => {
  const runtime=cases.find(c=>c.phase==='runtime');
  for (const [field,value] of [
    ['guest_mode','GRAAL_POLYGLOT'],
    ['guest_executable_sha256',null],
    ['guest_executable_sha256','not-a-digest'],
    ['compiler_accepted',false],
    ['exit_code',1],['timed_out',true],['signal','SIGILL'],
    ['host_test_executed',true]
  ]) {
    const r=receipt();r.cases[runtime.id][field]=value;
    assert.throws(()=>verifyCriticalSuspensionReceipt(r,manifest));
  }
});

test('host and compiler phase flags cannot spoof native execution', () => {
  const negative=cases.find(c=>c.phase==='compile-reject');
  const positive=cases.find(c=>c.phase==='compile-pass');
  for (const [caseId,field] of [
    [negative.id,'native_guest_executed'],[negative.id,'guest_executed'],
    [positive.id,'native_guest_executed'],[positive.id,'compiler_rejected']
  ]) {
    const r=receipt();r.cases[caseId][field]=true;
    assert.throws(()=>verifyCriticalSuspensionReceipt(r,manifest),/contradictory/);
  }
  const badExit=receipt();
  badExit.cases[positive.id].exit_code=124;
  assert.throws(()=>verifyCriticalSuspensionReceipt(badExit,manifest),/clean exit/);
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


test('compile-negative requires its exact planned diagnostic, not an unrelated syntax error', () => {
  const negative = cases.find(c => c.phase === 'compile-reject');
  const r = receipt();
  r.cases[negative.id].diagnostic_code = 'E_UNDECLARED_SYMBOL';
  assert.throws(() => verifyCriticalSuspensionReceipt(r, manifest), /EXACT expected diagnostic/);
  assert.equal(typeof negative.expected_diagnostic, 'string');
});

test('every compile-negative case declares a stable unique target diagnostic class', () => {
  for (const c of cases.filter(c => c.phase === 'compile-reject'))
    assert.match(c.expected_diagnostic, /^E_[A-Z0-9_]+$/);
});


test('bounded critical admission fails before creating extra pending tickets', async () => {
  const gate = new CriticalGateModel(1, 2);
  const active = gate.enter('active');
  const first = gate.enter('first');
  const second = gate.enter('second');
  assert.throws(() => gate.enter('third'), /waiter limit/);
  assert.equal(gate.waiters.length, 2);
  assert.equal(first.cancel(), true);
  await assert.rejects(first.completion, /cancelled/);
  assert.equal(gate.waiters.length, 1);
  const third = gate.enter('third');
  gate.release(active.lease);
  const secondLease = await second.completion;
  assert.equal(secondLease.task, 'second');
  gate.release(secondLease);
  const thirdLease = await third.completion;
  assert.equal(thirdLease.task, 'third');
  gate.release(thirdLease);
});

test('same continuation cannot recursively acquire or queue twice', async () => {
  const gate = new CriticalGateModel();
  const owner = gate.enter('owner');
  assert.throws(() => gate.tryEnter('owner'), /recursive/);
  assert.throws(() => gate.enter('owner'), /recursive/);
  const pending = gate.enter('waiting');
  // The nonqueueing path must also reject a second ticket for the same
  // pending continuation; it cannot treat identity aliasing as mere "busy".
  assert.throws(() => gate.tryEnter('waiting'), /duplicate continuation/);
  assert.throws(() => gate.enter('waiting'), /duplicate continuation/);
  assert.equal(gate.tryEnter('other'), null);
  assert.equal(gate.waiters.length, 1);
  assert.equal(pending.cancel(), true);
  await assert.rejects(pending.completion, /cancelled/);
  gate.release(owner.lease);
});

test('missing or non-finite continuation identity cannot acquire or consume FIFO capacity', async () => {
  const gate = new CriticalGateModel(9, 2);
  for (const identity of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.throws(() => gate.tryEnter(identity, 9), /identity required/);
    assert.throws(() => gate.enter(identity, 9), /identity required/);
  }
  assert.equal(gate.owner, null);
  assert.equal(gate.waiters.length, 0);
  const active = gate.enter('active', 9);
  const waiting = gate.enter('waiting', 9);
  assert.equal(gate.waiters.length, 1);
  for (const identity of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.throws(() => gate.tryEnter(identity, 9), /identity required/);
    assert.throws(() => gate.enter(identity, 9), /identity required/);
  }
  assert.equal(gate.waiters.length, 1);
  gate.release(active.lease);
  const lease = await waiting.completion;
  assert.equal(lease.task, 'waiting');
  gate.release(lease);
  gate.retire();
});

test('invalid waiter budgets and generations fail closed', () => {
  for (const capacity of [0, -1, 8193, Infinity, NaN, false, null, '2'])
    assert.throws(() => new CriticalGateModel(1, capacity), /waiter capacity/);
  for (const generation of [0, -1, Infinity, NaN, false, null, '1'])
    assert.throws(() => new CriticalGateModel(generation), /generation/);
});

test('multiple cancelled waiters cannot leak capacity into retired incarnation', async () => {
  const gate = new CriticalGateModel(91, 3);
  const active = gate.enter('active', 91);
  const a = gate.enter('a', 91);
  const b = gate.enter('b', 91);
  const c = gate.enter('c', 91);
  assert.equal(b.cancel(), true);
  await assert.rejects(b.completion, /cancelled/);
  assert.equal(gate.retire(), true);
  await Promise.all([
    assert.rejects(a.completion, /retired/),
    assert.rejects(c.completion, /retired/)
  ]);
  assert.equal(gate.waiters.length, 0);
  assert.equal(gate.owner, active.lease);
  gate.release(active.lease);
  assert.equal(gate.owner, null);
});
