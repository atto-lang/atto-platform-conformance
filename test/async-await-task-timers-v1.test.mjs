import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Contract-only tests. THESE DO NOT execute .atto/.ores compiler guests.
const manifest = JSON.parse(readFileSync(
  new URL("../fixtures/async-await-task-timers-v1/cases.json", import.meta.url), "utf8"
));
const cases = new Map(manifest.cases.map((entry) => [entry.id, entry]));

test("async timer vector inventory is unique and never claims runtime verification", () => {
  assert.equal(manifest.contract, "async-await-task-timers-v1");
  assert.equal(manifest.status, "candidate-unverified");
  assert.deepEqual(manifest.backends, ["java","llvm","net","wasm","forge","rs","cranelift","js","hdl","atto","realtime"]);
  assert.deepEqual(manifest.backendScope.compiler_bootstrap_only, ["atto", "realtime"]);
  assert.deepEqual(manifest.backendScope.deterministic_hardware_only, ["hdl"]);
  assert.equal(manifest.backendScope.all_guest_std_time_verification, "NOT_EXECUTED");
  assert.equal(manifest.backendScope.allow_unsupported_to_count_as_pass, false);
  assert.ok(manifest.requires.includes("compiled_guest_execution"));
  assert.ok(manifest.requires.includes("nonzero_runner_steps"));
  assert.equal(cases.size, manifest.cases.length);
  assert.equal(cases.size, 14);
  for (const fixture of manifest.cases) {
    assert.ok(fixture.id && fixture.kind && fixture.expected);
    assert.ok(["source_candidate", "reject_candidate", "runtime_race", "qualification_negative"].includes(fixture.kind));
  }
});

test("direct async await and selected main reuse existing logical task", () => {
  const a = cases.get("async_main_await_sleep");
  assert.match(a.source, /async fnc main/);
  assert.match(a.source, /await time\.sleep/);
  assert.equal(a.expected.additional_tasks_spawned, 0);
  assert.equal(a.expected.blocks_carrier, false);
  assert.equal(cases.get("async_main_await_after_zero").expected.minimum_resume_turns, 1);
  assert.equal(cases.get("sync_main_implicit_task_await").expected.explicit_task_required, false);
  assert.equal(cases.get("suspends_helper_with_async_caller").expected.additional_tasks_spawned, 0);
  assert.equal(cases.get("plain_sync_helper_await_reject").expected.error, "SuspensionEffectError");
});

test("timeout observer must not cancel independently owned producer", () => {
  const timeout = cases.get("async_timeout_observes_shared_producer");
  assert.equal(timeout.expected.producer_cancel_requests, 0);
  assert.equal(timeout.expected.observer_waiters_after_timeout, 0);
  assert.equal(cases.get("async_source_settled_before_zero_timeout").expected.observer, "success(42)");
});

test("cancellation, migration and actor wake retain authority barriers", () => {
  const cancel = cases.get("async_cancel_pending_timer").expected;
  assert.equal(cancel.single_winner, true);
  assert.equal(cancel.timer_slot_releases, 1);
  assert.equal(cancel.late_resumes, 0);
  const migration = cases.get("async_timer_wake_migration_preserves_task_context").expected;
  assert.equal(migration.task_local_trace, "abc");
  assert.equal(migration.thread_local_migrated, false);
  const actor = cases.get("async_actor_timer_wake_preserves_turn").expected;
  assert.equal(actor.actor_A_max_guest_turns, 1);
  assert.equal(actor.actor_A_message_overtake, false);
  assert.equal(actor.clock_thread_guest_calls, 0);
});

test("scope completion must await actual resource release and physical retirement", () => {
  const a = cases.get("async_cancel_defer_release_before_scope_done").expected;
  assert.equal(a.resource_release_count, 1);
  assert.equal(a.scope_done_after_physical_retirement, true);
  assert.equal(a.logical_cancel_is_not_retirement, true);
  assert.equal(cases.get("async_parent_deadline_wins").expected.effective_deadline, 100);
});

test("unqualified hard RT is not silently downgraded", () => {
  const v = cases.get("async_rt_unqualified_reject");
  assert.equal(v.expected.error, "HARD_RT_NOT_QUALIFIED");
  assert.equal(v.expected.automatic_soft_downgrade, false);
});
