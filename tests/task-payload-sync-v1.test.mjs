// Source-only SHA, alias and matrix integrity. NOT a compiled .atto guest proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const registry = JSON.parse(readFileSync(new URL('../contracts/task-payload-sync-v1.json', import.meta.url), 'utf8'));
const getSource = item => readFileSync(new URL('../' + item.source_path, import.meta.url));
const gitSha = bytes => createHash('sha1').update(Buffer.from('blob ' + bytes.byteLength + '\0')).update(bytes).digest('hex');
const cases = Object.fromEntries(registry.cases.map(c => [c.id,c]));
test('versioned typed task fixtures are pinned to exact Git blob identity', () => {
  assert.equal(registry.schema, 'atto.task-payload-sync.v1');
  assert.equal(registry.status, 'TARGET_NOT_GUEST_VERIFIED');
  assert.equal(registry.cases.length, 32);
  assert.equal(new Set(registry.cases.map(x=>x.id)).size,32);
  for (const c of registry.cases) {
    assert.match(c.source_path,/^fixtures\/task-payload-sync-v1\/[a-z0-9_]+\.atto$/);
    assert.equal(gitSha(getSource(c)),c.source_git_blob,c.id);
    assert.ok(['positive','negative'].includes(c.kind));
    if (c.kind==='positive') assert.equal(c.expected.guest_exit,42);
    else {
      assert.equal(c.expected.no_artifact,true);
      assert.match(c.expected.diagnostic,/^E_[A-Z_]+$/);
    }
  }
});
test('await and sync typed task fixtures differ only in spelling', () => {
  assert.equal(getSource(cases.sync_payload).toString('utf8').replace('sync task<int>','await task<int>'),
    getSource(cases.await_payload).toString('utf8'));
});
test('do sync task canonicalizes to do task without losing body or type', () => {
  assert.equal(getSource(cases.discard_do_sync_task).toString('utf8').replace('do sync task<int>','do task<int>'),
    getSource(cases.discard_do_task).toString('utf8'));
});
test('all compiler backends remain not-executed until real guest receipts', () => {
  assert.equal(Object.keys(registry.backends).length,10);
  for (const [backend,entry] of Object.entries(registry.backends)) {
    assert.equal(entry.status,'NOT_EXECUTED',backend);
    assert.equal(entry.release_qualified,false,backend);
    assert.equal(entry.compiler_sha,null,backend);
    assert.equal(entry.guest_receipt,null,backend);
  }
});

test('separate logical task frames and safe physical coallocation are the target model', () => {
  assert.match(registry.execution_frame_model,/independent logical continuations/);
  assert.match(registry.execution_frame_model,/proven lifetime and alias safety/);
  const dual = getSource(cases.two_live_task_frames).toString('utf8');
  const local = getSource(cases.parent_child_frame_isolation).toString('utf8');
  const nested = getSource(cases.nested_task_frames).toString('utf8');
  assert.equal((dual.match(/task<int> \{/g) ?? []).length,2);
  assert.equal((dual.match(/val int local =/g) ?? []).length,2);
  assert.match(dual,/await left;/);
  assert.match(dual,/await right;/);
  assert.equal((local.match(/val int local =/g) ?? []).length,2);
  assert.match(local,/return local \+ child_result;/);
  assert.equal((nested.match(/task<int> \{/g) ?? []).length,2);
  assert.match(nested,/await nested;/);
});

test('cancellation contracts are pinned, fail closed and require runtime witnesses', () => {
  assert.match(registry.cancellation_model, /nonblocking idempotent cancellation/);
  assert.match(registry.cancellation_model, /physically retires/);
  const casesToProve = [
    'cancel_request_nonblocking',
    'cancel_idempotent',
    'cancel_scope_exit_discard',
    'cancel_nested_descendants',
    'cancel_preserves_sibling',
    'cancel_await_error',
  ];
  for (const id of casesToProve) {
    assert.equal(cases[id].kind, 'positive');
    assert.equal(cases[id].expected.guest_exit, 42);
    assert.ok(cases[id].expected.witnesses?.length >= 2, id);
    const source = getSource(cases[id]).toString('utf8');
    assert.match(source, /task<void>/, id);
  }
  const request = getSource(cases.cancel_request_nonblocking).toString('utf8');
  const repeated = getSource(cases.cancel_idempotent).toString('utf8');
  const scoped = getSource(cases.cancel_scope_exit_discard).toString('utf8');
  const nested = getSource(cases.cancel_nested_descendants).toString('utf8');
  const sibling = getSource(cases.cancel_preserves_sibling).toString('utf8');
  const observed = getSource(cases.cancel_await_error).toString('utf8');
  assert.equal((request.match(/worker\.cancel\(\);/g) ?? []).length, 1);
  assert.equal((repeated.match(/worker\.cancel\(\);/g) ?? []).length, 2);
  assert.match(scoped, /do task<void>/);
  assert.doesNotMatch(scoped, /\.cancel\(\);/);
  assert.match(nested, /outer\.cancel\(\);/);
  assert.match(nested, /do task<void>/);
  assert.match(sibling, /return await sibling;/);
  assert.match(observed, /catch \(Error error\)/);
  assert.match(observed, /await worker;/);
  assert.equal(cases.cancel_void_used_as_int.expected.diagnostic, 'E_TASK_CANCEL_TYPE');
  assert.equal(cases.cancel_nonfuture_receiver.expected.diagnostic, 'E_TASK_CANCEL_TARGET');
  const nonSusp = cases.cancel_implicit_scope_exit_needs_susp;
  assert.equal(nonSusp.expected.diagnostic, 'E_EFFECT');
  assert.match(getSource(nonSusp).toString('utf8'), /pub fnc main\(\): int/);
});

test('cancellable task lock leases have pinned positive and negative sources', () => {
  assert.match(registry.lock_cancellation_model, /exactly-once LIFO release/);
  assert.match(registry.lock_cancellation_model, /cleanup failures retain fenced ownership/);
  const positives = [
    'cancel_lock_scoped_release',
    'cancel_lock_early_return',
    'cancel_lock_nested_lifo',
  ];
  for (const id of positives) {
    const item = cases[id];
    assert.equal(item.kind, 'positive', id);
    assert.equal(item.expected.guest_exit, 42, id);
    assert.ok(item.expected.witnesses.length >= 3, id);
    const source = getSource(item).toString('utf8');
    assert.match(source, /using await .*\.lock_async\(\) as/, id);
    assert.match(source, /worker\.cancel\(\);/, id);
  }
  const nested = getSource(cases.cancel_lock_nested_lifo).toString('utf8');
  assert.match(nested, /using inner\.lock\(\) as inner_guard/);
  assert.doesNotMatch(nested, /using await inner\.lock_async/);
  const early = getSource(cases.cancel_lock_early_return).toString('utf8');
  assert.match(early, /return guard\.value;/);
  const negatives = {
    cancel_lock_await_inside_guard: 'E_GUARD_SUSPEND',
    cancel_lock_held_during_join: 'E_GUARD_SUSPEND',
    cancel_lock_guard_escape: 'E_GUARD_ESCAPE',
  };
  for (const [id,code] of Object.entries(negatives)) {
    assert.equal(cases[id].kind, 'negative');
    assert.equal(cases[id].expected.diagnostic, code);
    assert.equal(cases[id].expected.no_artifact, true);
  }
  assert.equal(registry.lock_cancellation_runtime_probes.length, 11);
  const ids = registry.lock_cancellation_runtime_probes.map(p => p.id);
  assert.equal(new Set(ids).size, 11);
  for (const p of registry.lock_cancellation_runtime_probes) {
    assert.ok(p.assertions?.length >= 3, p.id);
    assert.ok(p.action, p.id);
    assert.ok(p.given?.length >= 1, p.id);
  }
  const active = registry.lock_cancellation_runtime_probes.find(p => p.id === 'active_guard_cancel');
  assert.deepEqual(active.required_order, [
    'A_LOCK_CLAIM',
    'A_CANCEL_REQUEST',
    'A_SAFE_POINT_UNWIND',
    'A_LOCK_RELEASE',
    'A_PHYSICAL_RETIRE',
  ]);
  assert.deepEqual(active.happens_before, [
    ['A_LOCK_RELEASE','B_LOCK_CLAIM'],
    ['A_LOCK_RELEASE','A_PHYSICAL_RETIRE'],
  ]);
  for (const id of positives) {
    assert.ok(cases[id].expected.witnesses.some(w => /if_guard_claimed|if_both_claimed|each_claimed_lease/.test(w)), id);
  }
});

test('cross-mutex grant replay and tenant STOP are mandatory negative runtime probes', () => {
  const probes = Object.fromEntries(registry.lock_cancellation_runtime_probes.map(p => [p.id, p]));
  const replay = probes.task_cancel_cross_mutex_ticket_replay;
  assert.ok(replay?.evidence_required);
  assert.ok(replay.assertions.includes('WRONG_TICKET_REJECTED'));
  assert.ok(replay.assertions.includes('PER_MUTEX_GENERATION_UNIQUE'));
  const stop = probes.tenant_shutdown_claimed_guard;
  assert.ok(stop?.evidence_required);
  assert.ok(stop.assertions.includes('ACTIVE_LEASE_REMAINS_FENCED_UNTIL_HOLDER_UNWINDS'));
  assert.ok(stop.assertions.includes('SHUTDOWN_IDEMPOTENT'));
  assert.deepEqual(stop.required_order, [
    'A_LOCK_CLAIM', 'HOST_TENANT_STOP', 'B_WAIT_REVOKED',
    'A_SAFE_UNWIND', 'A_LOCK_RELEASE', 'TENANT_PHYSICAL_QUIESCENCE',
  ]);
});

test('scheduler cancellation and grant wake notifications are lossless and claim-checked', () => {
  const probes = Object.fromEntries(registry.lock_cancellation_runtime_probes.map(p => [p.id, p]));
  const queued = probes.queued_wait_cancel;
  assert.match(queued.notification_contract, /level-triggered notice/);
  assert.ok(queued.assertions.includes('CANCEL_WAKE_LEVEL_TRIGGERED_UNTIL_TRUSTED_EXIT'));
  assert.ok(queued.assertions.includes('CANCELLED_WAIT_HAS_NO_GUARD_RELEASE'));
  const grant = probes.grant_cancel_race;
  assert.match(grant.notification_contract, /after successful ready-queue admission/);
  for (const required of [
    'GRANT_WAKE_SURVIVES_FAILED_SCHEDULER_ENQUEUE',
    'ACK_ONLY_AFTER_READY_QUEUE_ADMISSION',
    'STALE_ACK_CANNOT_CLEAR_SUCCESSOR_WAKE',
    'CLAIM_REVALIDATES_AFTER_ACK',
  ]) {
    assert.ok(grant.assertions.includes(required), required);
  }
});
