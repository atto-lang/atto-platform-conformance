import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const doc = await readFile(new URL('../docs/TIMER_TIMEOUT_OBSERVER_V1.md', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(
  new URL('../fixtures/timer-timeout-observer-v1/cases.json', import.meta.url), 'utf8'));

test('timer acceptance manifest is complete and explicitly unattested', () => {
  assert.equal(manifest.contract, 'timer-timeout-observer-v1');
  assert.equal(manifest.status, 'candidate-unattested');
  assert.deepEqual(manifest.backends, ['java', 'llvm', 'net', 'wasm', 'forge']);
  assert.equal(manifest.cases.length, 24);
  assert.equal(new Set(manifest.cases.map(x => x.id)).size, manifest.cases.length);
  assert.ok(manifest.requires.includes('real_executed_steps'));
  assert.ok(manifest.requires.includes('compiled_guest_binary_identity'));
  for (const row of manifest.cases) {
    assert.match(row.id, /^[a-z][a-z0-9_]+$/);
    assert.ok(['source_candidate', 'reject_candidate', 'runtime_race'].includes(row.kind));
    assert.ok(row.expected && typeof row.expected === 'object');
    if (row.kind === 'runtime_race') {
      assert.ok(Array.isArray(row.events) && row.events.length >= 2, row.id);
    } else {
      assert.match(row.source, /\b(?:fnc|routine)\b|\bdefine\s+(?:actor|class)\b/,
        'not a source-language fixture: ' + row.id);
    }
  }
});

test('source async timer wait never needs an explicit nested Task', () => {
  for (const id of ['sleep_direct_async', 'after_direct_async', 'timeout_direct_async', 'sync_public_main_await']) {
    const row = manifest.cases.find(x => x.id === id);
    assert.ok(row, 'missing ' + id);
    assert.match(row.source, /await\s+time\./);
    assert.equal(row.expected.explicit_task_required, false);
    assert.doesNotMatch(row.source, /\btask\s*\{/);
  }
});

test('actor suspension authority is admitted only on mailbox turns', () => {
  const byId = Object.fromEntries(manifest.cases.map(c => [c.id, c]));
  for (const id of ['actor_receive_await', 'actor_fnc_mailbox_await']) {
    const c = byId[id];
    assert.ok(c, 'missing ' + id);
    assert.equal(c.expected.compiler, 'accept');
    assert.equal(c.expected.source_async_modifier_required, false);
    assert.equal(c.expected.explicit_task_required, false);
    assert.match(c.source, /await\s+/);
  }
  assert.equal(byId.actor_receive_await.expected.prints, 'resumed');
  assert.equal(byId.actor_receive_await.expected.physical_retirement_before_done, true);
  assert.match(byId.actor_receive_await.source, /await worker\.get_done\(\)/);
  assert.match(byId.actor_receive_await.source, /worker\.outputs\.next\(\)/);
  for (const id of ['actor_on_start_await_reject', 'plain_instance_method_await_reject']) {
    assert.equal(byId[id]?.expected.error, 'SuspensionEffectError');
  }
  assert.equal(byId.sync_await_reject?.expected.error, 'SuspensionEffectError');
  assert.match(byId.sync_public_main_await.source, /routine main/);
  assert.equal(byId.private_root_main_await?.expected.explicit_task_required, false);
  assert.equal(byId.private_module_main_await?.expected.explicit_task_required, false);
  assert.equal(byId.nonentry_main_overload_reject?.expected.error, 'SuspensionEffectError');
});

test('timer isolation, retirement and reentrant intervals are covered', () => {
  const names = new Set(manifest.cases.map(x => x.id));
  for (const id of [
    'already_terminal_beats_zero_deadline',
    'timeout_does_not_cancel_shared_producer',
    'observer_cancel_detaches',
    'source_failure_identity',
    'cancel_expiry_single_winner',
    'owner_close_fences_stale_callback',
    'interval_reentrant_second_tick',
    'interval_cancel_close_once',
    'actor_self_callback_await_reject',
    'callback_never_on_clock_thread'
  ]) assert.ok(names.has(id), 'missing ' + id);
  const timeout = manifest.cases.find(x => x.id === 'timeout_does_not_cancel_shared_producer');
  assert.equal(timeout.expected.producer, 'success(42)');
  assert.equal(timeout.expected.retained_waiters, 0);
  const interval = manifest.cases.find(x => x.id === 'interval_reentrant_second_tick');
  assert.deepEqual(interval.expected.ticks, [1, 2]);
  assert.equal(interval.expected.missed_tick_backlog, 0);
});

test('spec refuses synthetic executions and implicit cancellation authority', () => {
  for (const phrase of [
    'must NOT require an explicit',
    'observer cancellation never implicitly cancels a shared producer',
    'physical guest',
    'Timer/broker threads never invoke guest code',
    'guest AOT execution evidence',
    'a private destination alone is insufficient'
  ]) assert.ok(doc.includes(phrase), 'missing contract phrase: ' + phrase);
});
