import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = new URL("../fixtures/task-timer-hard-rt-v1/cases.json", import.meta.url);
const manifest = JSON.parse(readFileSync(file, "utf8"));
const caseById = new Map(manifest.cases.map((c) => [c.id, c]));
const MAX_I64 = 9223372036854775807n;

function sumWithinI64(limit, ...terms) {
  const sum = terms.reduce((acc, v) => acc + BigInt(v), 0n);
  return sum <= BigInt(limit) && sum >= 0n && sum <= MAX_I64;
}

// These are source-free manifest/reference-oracle checks ONLY. They are not
// executed AttoLang guests, compiler lowering or hard-RT timing evidence.
test("task-timer vectors are unique candidate cases, never claimed as passes", () => {
  assert.equal(manifest.contract, "task-timers-hard-rt-v1");
  assert.equal(manifest.status, "candidate-unverified");
  assert.equal(manifest.hardRealTimeQualified, false);
  assert.deepEqual(manifest.backends, ["java", "llvm", "net", "wasm", "forge"]);
  assert.ok(manifest.requiredEvidence.includes("nonzero_executed_guest_steps"));
  assert.ok(manifest.requiredEvidence.includes("on_target_wcet_jitter_first_guest_instruction"));
  assert.equal(caseById.size, manifest.cases.length);
  assert.ok(manifest.cases.length >= 14);
  for (const entry of manifest.cases) {
    assert.equal(typeof entry.id, "string");
    assert.ok(entry.id.length > 0);
    assert.ok(entry.expected && Object.keys(entry.expected).length);
    assert.ok(["source_candidate", "runtime_race", "qualification_negative", "qualification_race"].includes(entry.kind));
  }
});

test("timer await retains Task ownership; cancellation drains physically", () => {
  assert.equal(caseById.get("task_sleep_reuses_own_continuation").expected.extra_implicit_tasks, 0);
  assert.equal(caseById.get("task_zero_sleep_queues_next_turn").expected.min_resume_turns, 1);
  assert.equal(caseById.get("task_cancel_expiry_single_winner").expected.timer_slot_releases, 1);
  assert.equal(caseById.get("task_cleanup_not_terminal_future").expected.scope_drained_before_physical_retirement, false);
  assert.equal(caseById.get("timeout_observer_does_not_cancel_shared_task").expected.producer_cancel_requests, 0);
  assert.equal(caseById.get("timer_clock_thread_no_guest").expected.clock_thread_guest_executions, 0);
  assert.equal(caseById.get("actor_incarnation_revoked").expected.old_guest_resume, 0);
});

test("hard-RT reference start claim uses real guest entry and rejects a late start", () => {
  const v = caseById.get("hard_rt_late_first_instruction_rejected");
  assert.ok(v.times_ns.clock_expiry < v.times_ns.deadline);
  assert.ok(v.times_ns.claim < v.times_ns.deadline);
  assert.ok(v.times_ns.first_guest_instruction > v.times_ns.deadline);
  assert.equal(v.expected.result, "DeadlineMissed");
  assert.equal(v.expected.guest_effects_started, 0);
});

test("hard-RT reference upper bounds reject signed overflow and over-budget cleanup", () => {
  const v = caseById.get("hard_rt_start_budget_overflow_rejected");
  assert.equal(sumWithinI64(v.timing_ns.start_deadline, v.timing_ns.release_jitter, v.timing_ns.wake_queue), false);
  assert.equal(v.expected.admitted, false);
  const c = caseById.get("cancel_cleanup_misses_budget");
  const { cancel_deadline, start_path, cleanup_wcet, interference } = c.timing_ns;
  assert.equal(sumWithinI64(cancel_deadline, start_path, cleanup_wcet, interference), false);
  assert.equal(c.expected.reason, "cleanup_deadline");
  assert.equal(sumWithinI64(400n, 100n, 200n, 50n), true);
});

test("periodic release is absolute phase, not repeated relative sleeps", () => {
  const v = caseById.get("hard_rt_periodic_phase_absolute");
  const { phase, period, period_index } = v.times_ns;
  const release = BigInt(phase) + BigInt(period) * BigInt(period_index);
  assert.equal(release, BigInt(v.expected.release_ns));
  assert.equal(v.expected.missed_period_demand_driven_backlog, false);
});

test("generic Java hard RT must be explicitly rejected, not silently downgraded", () => {
  const v = caseById.get("hard_mode_unqualified_rejected");
  assert.equal(v.expected.compile_or_admission_error, "HARD_RT_NOT_QUALIFIED");
  assert.equal(v.expected.silent_soft_fallback, false);
});
