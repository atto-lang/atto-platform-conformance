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
  assert.equal(registry.cases.length, 76);
  assert.equal(new Set(registry.cases.map(x=>x.id)).size,registry.cases.length);
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
test('sync is an inline execution mode, not a spawned await/do-task alias', () => {
  assert.match(registry.sync_inline_model,/caller TaskId/);
  assert.match(registry.sync_inline_model,/without an independent spawn or Future|no independent TaskSpawn/i);
  assert.match(registry.sync_inline_model,/MUST NOT canonicalize to do task/);
  const sync = cases.sync_payload;
  const awaitTask = cases.await_payload;
  const doSync = cases.discard_do_sync_task;
  const doTask = cases.discard_do_task;
  const required = [
    'INLINE_ENTER_BEFORE_BODY', 'NO_SYNTHETIC_SYNC_CHILD_SPAWN',
    'SAME_LOGICAL_TASK_ID', 'INLINE_EXIT_BEFORE_NEXT_PARENT_STATEMENT',
    'NO_INDEPENDENT_WORKER_DISPATCH',
  ];
  for (const item of [sync,doSync]) {
    assert.equal(item.kind,'positive');
    for (const name of required) assert.ok(item.expected.witnesses.includes(name),name);
  }
  assert.ok(awaitTask.expected.witnesses.includes('INDEPENDENT_CHILD_SPAWN'));
  assert.ok(doTask.expected.witnesses.includes('INDEPENDENT_CHILD_SPAWN'));
  assert.ok(!doSync.expected.witnesses.includes('INDEPENDENT_CHILD_SPAWN'));
  assert.match(getSource(sync).toString('utf8'),/sync task<int>/);
  assert.match(getSource(awaitTask).toString('utf8'),/await task<int>/);
  assert.match(getSource(doSync).toString('utf8'),/do sync task<void>/);
  assert.doesNotMatch(getSource(doSync).toString('utf8'),/do sync task<(?!void>)[^>]+>/);
  assert.doesNotMatch(getSource(doSync).toString('utf8'),/do sync task<void>\s*\{[^}]*return\s+[^;]+;/);
  assert.match(registry.sync_inline_model,/only an explicit void payload or inferred void/);
  assert.ok(doSync.expected.witnesses.includes('INLINE_VOID_COMPLETION_NO_RESULT'));
  assert.match(getSource(doTask).toString('utf8'),/do task<int>/);
});
test('void-only do sync task and standalone statements match the canonical spec', () => {
  const demo = cases.sync_inline_void_do_demo;
  const demoSource = getSource(demo).toString('utf8');
  assert.equal(demo.kind, 'positive');
  assert.match(demoSource, /do sync task \{\};/);
  assert.match(demoSource, /do sync task<void> \{\};/);
  assert.match(demoSource, /val result = sync task<int>/);
  assert.match(demoSource, /return result;/);
  assert.ok(demo.expected.witnesses.includes('INLINE_VOID_COMPLETION_NO_RESULT'));
  for (const id of ['sync_void_stmt_requires_do','sync_typed_void_stmt_requires_do']) {
    assert.equal(cases[id].kind, 'negative');
    assert.equal(cases[id].expected.diagnostic, 'E_SYNTAX');
    assert.equal(cases[id].expected.no_artifact, true);
    assert.doesNotMatch(getSource(cases[id]).toString('utf8'), /do sync task/);
  }
  for (const id of ['do_sync_nonvoid_type_rejected','do_sync_nonvoid_inferred_rejected']) {
    assert.equal(cases[id].kind, 'negative');
    assert.equal(cases[id].expected.diagnostic, 'E_TASK_RETURN_TYPE');
    assert.equal(cases[id].expected.no_artifact, true);
    assert.match(getSource(cases[id]).toString('utf8'), /do sync task/);
  }
});

test('inline sync task can cooperate and rejects suspension without same-thread continuation', () => {
  const pure = cases.sync_inline_non_susp;
  const ordered = cases.sync_inline_order;
  const suspended = cases.sync_inline_suspend;
  const lockedPure = cases.sync_inline_guard_pure;
  const lockedSuspend = cases.sync_inline_guard_suspend;
  assert.equal(pure.kind,'positive');
  assert.match(getSource(pure).toString('utf8'),/pub fnc main\(\): int/);
  assert.doesNotMatch(getSource(pure).toString('utf8'),/await/);
  assert.ok(pure.expected.witnesses.includes('NON_SUSP_CALLER_ADMITTED'));
  assert.deepEqual(ordered.expected.stdout,'7\n9\n');
  assert.match(getSource(ordered).toString('utf8'),/stdio\.println\(7\);[\s\S]*stdio\.println\(9\);/);
  assert.match(getSource(suspended).toString('utf8'),/sync task<int>[\s\S]*await task<int>/);
  assert.equal(suspended.kind,'negative');
  assert.equal(suspended.expected.diagnostic,'E_SYNC_TASK_SUSPEND');
  assert.equal(suspended.expected.no_artifact,true);
  assert.ok(pure.expected.witnesses.includes('SAME_CALLER_THREAD'));
  const cooperating = cases.sync_inline_cooperate;
  assert.equal(cooperating.kind,'positive');
  assert.match(getSource(cooperating).toString('utf8'),/sync task<int>\s*\{\s*rt cooperate;/);
  assert.ok(cooperating.expected.witnesses.includes('SAME_CALLER_THREAD_AFTER_COOPERATE'));
  assert.match(getSource(lockedPure).toString('utf8'),/using await lock\.lock_async/);
  assert.match(getSource(lockedPure).toString('utf8'),/sync task<int> \{ return 1; \}/);
  assert.ok(lockedPure.expected.witnesses.includes('GUARD_RELEASE_EXACTLY_ONCE'));
  assert.equal(lockedSuspend.kind,'negative');
  assert.equal(lockedSuspend.expected.diagnostic,'E_SYNC_TASK_SUSPEND');
  assert.equal(lockedSuspend.expected.no_artifact,true);
  assert.match(getSource(lockedSuspend).toString('utf8'),/sync task<int>[\s\S]*await task<int>/);
  const effect = cases.sync_needs_susp;
  assert.equal(effect.expected.diagnostic,'E_SYNC_TASK_SUSPEND');
  assert.match(getSource(effect).toString('utf8'),/pub fnc main\(\): int/);
  assert.match(getSource(effect).toString('utf8'),/return await task<int>/);
  assert.equal(registry.inline_sync_runtime_probes.length,5);
  for (const p of registry.inline_sync_runtime_probes) {
    assert.equal(p.evidence_required,true);
    assert.equal(p.release_qualified,false);
    assert.ok(p.assertions?.length>=3,p.id);
  }
  assert.ok(registry.inline_sync_runtime_probes.find(p=>p.id==='do_sync_cannot_alias_do_task')
    .assertions.includes('FORMATTER_PRESERVES_SYNC'));
});
test('all compiler backends remain not-executed until real guest receipts', () => {
  assert.equal(Object.keys(registry.backends).length,11);
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
  assert.equal(registry.lock_cancellation_runtime_probes.length, 17);
  const ids = registry.lock_cancellation_runtime_probes.map(p => p.id);
  assert.equal(new Set(ids).size, registry.lock_cancellation_runtime_probes.length);
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

test('normal parent return triggers child cancellation but preserves successful parent outcome', () => {
  const probe = registry.lock_cancellation_runtime_probes.find(p => p.id ===
    'successful_parent_scope_exit_cancels_descendants');
  assert.equal(probe.evidence_required, true);
  for (const required of [
    'PARENT_SUCCESS_NOT_REPLACED_BY_CANCELLATION',
    'CHILD_AND_GRANDCHILD_RECEIVE_TRANSITIVE_CANCELLATION',
    'NO_CHILD_JOIN_WHILE_PARENT_GUARD_HELD',
    'UNRELATED_SIBLING_UNAFFECTED',
    'NO_PARENT_STORAGE_REUSE_BEFORE_DESCENDANTS_RETIRED'
  ]) assert.ok(probe.assertions.includes(required), required);
});

test('lexical using guard exits before task terminal and cancellation cannot double-unlock', () => {
  const p = registry.lock_cancellation_runtime_probes.find(x =>
    x.id === 'lexical_guard_scope_exit_while_task_continues');
  assert.equal(p.evidence_required, true);
  assert.ok(p.assertions.includes('GUEST_CANNOT_FORGE_GUARD_RELEASE'));
  assert.ok(p.assertions.includes('NO_TASK_RETIRE_NEEDED_BEFORE_GUARD_RELEASE'));
  assert.ok(p.assertions.includes('A_CANCELLATION_AFTER_RELEASE_DOES_NOT_DOUBLE_UNLOCK'));
  assert.ok(p.required_order.indexOf('A_RELEASE') < p.required_order.indexOf('A_TERMINAL'));
});

test('trusted lock-park receipt gates cancel and grant wakes', () => {
  const probes = Object.fromEntries(registry.lock_cancellation_runtime_probes.map(p => [p.id,p]));
  const park = probes.lock_park_cancel_linearization;
  assert.equal(park.evidence_required, true);
  for (const witness of [
    'NO_CANCEL_WAKE_UNLESS_B_WAS_TRUSTED_PARKED',
    'NO_GRANT_WAKE_UNLESS_B_WAS_TRUSTED_PARKED',
    'NO_DUPLICATE_DISPATCH_OF_RUNNING_CONTINUATION',
    'GUARD_HOLDING_TASK_CANNOT_PARK_LOCK_WAIT',
    'WRONG_TICKET_OR_WRONG_TENANT_PARK_REJECTED',
    'CANCEL_BEFORE_PARK_RETURNS_CANCELLATION_PENDING',
    'GRANT_BEFORE_PARK_IS_CLAIMABLE_WITHOUT_PARK',
    'ACK_AFTER_READY_QUEUE_ADMISSION_ONLY',
    'ACK_IDENTIFIES_EXACT_PARKED_TASK_AND_GRANT',
    'NO_PREMATURE_GUARD_RELEASE',
    'PARKED_TASK_CANNOT_CERTIFY_SUCCESSFUL_PHYSICAL_EXIT',
    'PARKED_GRANT_CANNOT_BE_CLAIMED_BEFORE_TRUSTED_READY_QUEUE_ACK'
  ]) assert.ok(park.assertions.includes(witness), witness);
  assert.deepEqual(park.required_happens_before, [
    ['TRUSTED_PARK','CANCEL_WAKE_IF_CANCEL_WINS_LATER'],
    ['TRUSTED_PARK','GRANT_WAKE_IF_GRANT_WINS_LATER']
  ]);
  assert.ok(probes.queued_wait_cancel.assertions.includes('WAKE_REQUIRES_TRUSTED_LOCK_PARK_RECEIPT'));
  assert.ok(probes.grant_cancel_race.assertions.includes('GRANT_HINT_REQUIRES_TRUSTED_LOCK_PARK_RECEIPT'));
});

test('atomic host ready admission cannot lose a lock grant or dispatch twice', () => {
  const probe = registry.lock_cancellation_runtime_probes.find(p => p.id === 'atomic_host_ready_admission');
  assert.equal(probe.evidence_required, true);
  assert.equal(probe.release_qualified, false);
  for (const witness of [
    'GRANT_ACK_AND_READY_QUEUE_INSERTION_ONE_SERIALIZED_TRANSITION',
    'FAILED_OR_CAPACITY_REJECTED_READY_ENQUEUE_LEAVES_GRANT_PENDING',
    'ONE_RUNNABLE_ENTRY_PER_LOGICAL_TASK',
    'READY_BUT_UNDISPATCHED_TASK_CANNOT_CLAIM_OR_PARK',
    'CANCELLATION_AND_GRANT_WAKE_FOR_SAME_TASK_NOT_DUPLICATED',
    'VALID_SUCCESSOR_NOT_LOST_AFTER_REVOKED_GRANT',
    'CANCELLED_WAITER_NEVER_RELEASES_ACTIVE_OWNER',
    'READY_QUEUE_NOT_VISIBLE_TO_UNTRUSTED_GUEST',
    'NONPARKING_HOST_ARBITER_WHEN_BUSY',
    'PHYSICAL_RETIREMENT_REQUIRES_TRUSTED_DISPATCH_AND_GUEST_EXIT'
  ]) assert.ok(probe.assertions.includes(witness), witness);
  assert.deepEqual(probe.required_happens_before, [
    ['TRUSTED_LOCK_PARK','HOST_READY_ADMISSION'],
    ['HOST_READY_ADMISSION','READY_GRANT_ACK'],
    ['HOST_READY_ADMISSION','SCHEDULER_POP_READY'],
    ['SCHEDULER_POP_READY','GUEST_CLAIM_OR_CANCEL_UNWIND']
  ]);
  assert.ok(Object.values(registry.backends).every(b =>
    b.status === 'NOT_EXECUTED' && b.release_qualified === false));
});

test('parked or ready-but-undispatched tasks cannot create lock tickets or children', () => {
  const probe = registry.lock_cancellation_runtime_probes.find(p =>
    p.id === 'parked_ready_task_admission_fence');
  assert.ok(probe, 'required lifecycle probe absent');
  assert.equal(probe.evidence_required, true);
  assert.equal(probe.release_qualified, false);
  for (const invariant of [
    'PARKED_TASK_CANNOT_ACQUIRE_ANOTHER_MUTEX',
    'PARKED_TASK_CANNOT_SPAWN_CHILD',
    'READY_BUT_UNDISPATCHED_TASK_CANNOT_ACQUIRE_MUTEX',
    'READY_BUT_UNDISPATCHED_TASK_CANNOT_SPAWN_CHILD',
    'NO_GHOST_TICKET_ON_REJECTION',
    'NO_FORGED_CHILD_TASK_CAPABILITY',
    'TASK_MAY_RETRY_ONLY_AFTER_AUTHENTICATED_READY_TO_RUNNING_TRANSITION'
  ]) assert.ok(probe.assertions.includes(invariant), invariant);
  assert.ok(Object.values(registry.backends).every(b =>
    b.status === 'NOT_EXECUTED' && b.release_qualified === false));
});

test('a lock park cannot strand an unclaimed grant or ambiguously suspend on two locks', () => {
  const probe = registry.lock_cancellation_runtime_probes.find(p =>
    p.id === 'lock_park_unclaimed_grant_and_ambiguous_wait');
  assert.equal(probe.evidence_required, true);
  assert.equal(probe.release_qualified, false);
  for (const invariant of [
    'UNCLAIMED_GRANT_PREVENTS_PARK_ON_DIFFERENT_MUTEX',
    'ACTIVE_LEASE_PREVENTS_PARK',
    'MULTIPLE_OUTSTANDING_WAITS_WITHOUT_TYPED_SELECT_ARE_REJECTED',
    'NO_PHANTOM_READY_ENTRY_OR_WAKE_HINT',
    'CANCELLATION_REMOVES_ALL_PENDING_WAITS',
  ]) assert.ok(probe.assertions.includes(invariant), invariant);
});

test('legacy raw grant ack cannot bypass ready queue insertion', () => {
  const probe = registry.lock_cancellation_runtime_probes.find(p => p.id === 'atomic_host_ready_admission');
  assert.ok(probe, 'missing atomic admission probe');
  assert.equal(probe.evidence_required, true);
  assert.equal(probe.release_qualified, false);
  assert.ok(probe.assertions.includes('RAW_WAKE_HINT_ACK_WITHOUT_READY_QUEUE_REJECTED'));
  assert.ok(probe.assertions.includes('GRANT_ACK_AND_READY_QUEUE_INSERTION_ONE_SERIALIZED_TRANSITION'));
  assert.ok(Object.values(registry.backends).every(b =>
    b.status === 'NOT_EXECUTED' && b.release_qualified === false));
});

test('await of inline scalar or void is rejected, but awaiting a returned Future is valid', () => {
  assert.match(registry.await_inline_future_model, /type-directed|E_AWAIT_TYPE/);
  for (const id of ['await_sync_scalar_rejected','await_sync_void_rejected']) {
    const item = cases[id];
    assert.equal(item.kind, 'negative');
    assert.equal(item.expected.diagnostic, 'E_AWAIT_TYPE');
    assert.equal(item.expected.no_artifact, true);
    assert.match(getSource(item).toString('utf8'), /await sync task<(int|void)>/);
  }
  const value = cases.await_sync_future_valid;
  assert.equal(value.kind, 'positive');
  assert.equal(value.expected.guest_exit, 42);
  const source = getSource(value).toString('utf8');
  assert.match(source, /await sync task<Future<int>>/);
  assert.match(source, /return task<int> \{ return 42; \}/);
  for (const witness of ['SAME_LOGICAL_TASK_ID','NO_SYNTHETIC_SYNC_CHILD_SPAWN',
    'INDEPENDENT_CHILD_SPAWN','AWAIT_RETURNED_FUTURE_ONLY','TASK_JOIN_PHYSICAL_RETIRE']) {
    assert.ok(value.expected.witnesses.includes(witness), witness);
  }
});

test('runtime task expressions cannot initialize constexpr const bindings', () => {
  assert.match(registry.const_task_model, /Local const requires compile-time-evaluable/);
  for (const id of ['const_async_task_rejected','const_sync_task_rejected']) {
    const item = cases[id];
    assert.equal(item.kind, 'negative');
    assert.equal(item.expected.no_artifact, true);
    assert.equal(item.expected.diagnostic, 'E_CONST');
    const source = getSource(item).toString('utf8');
    assert.match(source, /const (Future<int>|int) /);
    assert.match(source, /(task<int>|sync task<int>)/);
    assert.doesNotMatch(source, /val (Future<int>|int) /);
  }
});

test('empty typed nonvoid tasks reject, but empty void do task spawns', () => {
  for (const id of ['empty_async_nonvoid_rejected','empty_sync_nonvoid_rejected']) {
    const item = cases[id];
    assert.equal(item.kind, 'negative');
    assert.equal(item.expected.diagnostic, 'E_TASK_RETURN_TYPE');
    assert.equal(item.expected.no_artifact, true);
    assert.match(getSource(item).toString('utf8'), /task<int> \{\}/);
  }
  const stmt = cases.do_async_void_empty;
  assert.equal(stmt.kind, 'positive');
  assert.equal(stmt.expected.guest_exit, 42);
  assert.match(getSource(stmt).toString('utf8'), /do task<void> \{\}/);
  for (const witness of ['INDEPENDENT_CHILD_SPAWN','SUPERVISED_DISCARD','SCOPE_PHYSICAL_RETIRE']) {
    assert.ok(stmt.expected.witnesses.includes(witness), witness);
  }
});

test('unannotated task infers Future<void> or Future<int> and do task discards within scope', () => {
  const empty = cases.inferred_empty_task_future_void;
  const valued = cases.inferred_int_task_future;
  const discarded = cases.do_inferred_void_task;
  for (const item of [empty, valued, discarded]) {
    assert.equal(item.kind, 'positive');
    assert.equal(item.expected.guest_exit, 42);
    assert.ok(item.expected.witnesses.includes('INDEPENDENT_CHILD_SPAWN'));
  }
  assert.match(getSource(empty).toString('utf8'), /val Future<void> pending = task \{\}/);
  assert.ok(empty.expected.witnesses.includes('FUTURE_VOID_INFERRED'));
  assert.match(getSource(valued).toString('utf8'), /val Future<int> pending = task \{ return 42; \}/);
  assert.ok(valued.expected.witnesses.includes('FUTURE_INT_INFERRED'));
  assert.match(getSource(discarded).toString('utf8'), /do task \{\}/);
  assert.ok(discarded.expected.witnesses.includes('SUPERVISED_DISCARD'));
  assert.ok(discarded.expected.witnesses.includes('SCOPE_PHYSICAL_RETIRE'));
});

test('TaskFuture<T> owns the result receipt and a distinct task control capability', () => {
  assert.match(registry.taskfuture_control_model,/separate affine task-control/);
  assert.match(registry.taskfuture_control_model,/get_ready\(\): Future<T>/);
  assert.match(registry.taskfuture_control_model,/cancel_task\(\): void/);
  assert.match(registry.taskfuture_control_model,/cooperate\(\): void/);
  for (const id of [
    'taskfuture_await_ready','taskfuture_await_direct',
    'taskfuture_receipt_split_control','taskfuture_cooperate_request',
    'taskfuture_cancel_scope','taskfuture_cancel_after_split','taskfuture_legacy_future_projection',
    'taskfuture_legacy_cancel_alias','taskfuture_inferred_empty_void',
    'taskfuture_inferred_valued'
  ]) {
    const item = cases[id];
    assert.equal(item.kind,'positive',id);
    assert.equal(item.expected.guest_exit,42,id);
    assert.ok(item.expected.witnesses.length >= 2,id);
    assert.match(getSource(item).toString('utf8'),/task(?:<[^>]+>)?\s*\{/);
  }
  const plain = getSource(cases.taskfuture_await_ready).toString('utf8');
  assert.match(plain,/val TaskFuture<int> t = task<int>/);
  assert.match(plain,/await t\.get_ready\(\)/);
  assert.match(getSource(cases.taskfuture_await_direct).toString('utf8'),/return await t;/);
  const split = getSource(cases.taskfuture_receipt_split_control).toString('utf8');
  assert.match(split,/val Future<int> ready = t\.get_ready\(\)/);
  assert.match(split,/t\.cooperate\(\);[\s\S]*await ready;/);
  const splitCancelled = cases.taskfuture_cancel_after_split;
  const splitCancelledSource = getSource(splitCancelled).toString('utf8');
  assert.match(splitCancelledSource,/val Future<void> receipt = t\.get_ready\(\)/);
  assert.match(splitCancelledSource,/t\.cancel_task\(\);[\s\S]*t\.cooperate\(\)/);
  assert.ok(splitCancelled.expected.witnesses.includes('TASK_CONTROL_RIGHT_RETAINED'));
  assert.ok(splitCancelled.expected.witnesses.includes('CANCEL_PRIORITY_OVER_COOPERATE'));
  const cancel = cases.taskfuture_cancel_scope;
  assert.match(getSource(cancel).toString('utf8'),/t\.cancel_task\(\);[\s\S]*t\.cancel_task\(\)/);
  assert.ok(cancel.expected.witnesses.includes('SCOPE_PHYSICAL_RETIRE'));
  assert.match(getSource(cases.taskfuture_legacy_cancel_alias).toString('utf8'),/projected\.cancel\(\)/);
  assert.match(getSource(cases.taskfuture_inferred_empty_void).toString('utf8'),/TaskFuture<void> pending = task \{\}/);
  assert.match(getSource(cases.taskfuture_inferred_valued).toString('utf8'),/TaskFuture<int> pending = task \{ return 42; \}/);
});

test('TaskFuture control cannot duplicate receipts or apply to a result-only Future', () => {
  const failures = {
    taskfuture_duplicate_ready_rejected: 'E_TASK_RESULT_CONSUMED',
    taskfuture_duplicate_await_rejected: 'E_TASK_RESULT_CONSUMED',
    taskfuture_cooperate_on_future_rejected: 'E_TASK_CONTROL_TARGET',
    taskfuture_cancel_task_on_future_rejected: 'E_TASK_CONTROL_TARGET',
    taskfuture_get_ready_on_future_rejected: 'E_TASK_CONTROL_TARGET',
    taskfuture_await_cooperate_rejected: 'E_AWAIT_TYPE',
    taskfuture_await_cancel_task_rejected: 'E_AWAIT_TYPE',
    taskfuture_const_handle_rejected: 'E_CONST',
    taskfuture_sync_handle_rejected: 'E_TASK_RETURN_TYPE',
    taskfuture_ready_as_int_rejected: 'E_TASK_RETURN_TYPE',
    taskfuture_control_void_as_int_rejected: 'E_TASK_CONTROL_TYPE',
    taskfuture_wrong_payload_rejected: 'E_TASK_RETURN_TYPE'
  };
  for (const [id,code] of Object.entries(failures)) {
    const item = cases[id];
    assert.equal(item.kind,'negative',id);
    assert.equal(item.expected.diagnostic,code,id);
    assert.equal(item.expected.no_artifact,true,id);
    assert.match(getSource(item).toString('utf8'),/TaskFuture|Future<int>/,id);
  }
});

test('TaskFuture cooperation requires real scheduler proof and never reports guest evidence from source alone', () => {
  assert.equal(registry.taskfuture_runtime_probes.length,5);
  for (const probe of registry.taskfuture_runtime_probes) {
    assert.equal(probe.release_qualified,false,probe.id);
    assert.equal(probe.execution,'NOT_EXECUTED',probe.id);
    assert.ok(probe.required.length>=3,probe.id);
  }
  const ids = registry.taskfuture_runtime_probes.map(p=>p.id);
  for (const id of [
    'cooperate_running_child_yields_at_safe_point',
    'cooperate_guard_defers_until_release',
    'cooperate_cancel_priority',
    'get_ready_control_split',
    'cooperate_hint_bounded_coalescing'
  ]) assert.ok(ids.includes(id),id);
  assert.match(registry.taskfuture_control_model,/not forced preemption/);
});
