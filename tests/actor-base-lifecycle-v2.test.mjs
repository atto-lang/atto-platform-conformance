// Source-free AttoLang actor base lifecycle v2 reference checks.
// This is NOT a compiler run, guest execution, or backend certification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = JSON.parse(readFileSync(
  new URL('../contracts/actor-base-lifecycle-v2.json', import.meta.url), 'utf8'));

class Lifecycle {
  constructor(generation = 1, capacity = 2) {
    assert.ok(Number.isSafeInteger(generation) && generation > 0);
    this.generation = generation;
    this.capacity = capacity;
    this.phase = 'ALLOCATED';
    this.initCalls = 0;
    this.teardownCalls = 0;
    this.teardownFinished = false;
    this.queue = 0;
    this.active = false;
    this.loans = 0;
    this.ready = false;
    this.readyFailure = null;
    this.done = false;
    this.cause = null;
    this.stopKind = null;
    this.controlNotices = [];
  }
  startInit() {
    assert.equal(this.phase, 'ALLOCATED');
    this.phase = 'INITIALIZING';
    this.initCalls++;
  }
  succeedInit() {
    if (this.phase !== 'INITIALIZING') return false;
    this.phase = 'READY';
    this.ready = true;
    return true;
  }
  send(handleGeneration, bytes = 1) {
    // Pre-READY admission is allowed, but not delivery.
    if (handleGeneration !== this.generation ||
        !['ALLOCATED', 'INITIALIZING', 'READY', 'TURN_RUNNING'].includes(this.phase) ||
        this.queue >= this.capacity ||
        bytes <= 0) return false;
    this.queue++;
    return true;
  }
  beginTurn() {
    if (this.phase !== 'READY' || this.active || this.queue === 0) return false;
    this.phase = 'TURN_RUNNING';
    this.active = true;
    this.queue--;
    return true;
  }
  endTurn() {
    assert.ok(this.active);
    this.active = false;
    if (this.phase === 'TURN_RUNNING') this.phase = 'READY';
    // A stop can race the physical turn, but cannot finalize before it exits.
  }
  borrow() {
    if (!this.active) return false;
    this.loans++;
    return true;
  }
  releaseLoan() {
    assert.ok(this.loans > 0);
    this.loans--;
  }
  stop(kind = 'GRACEFUL_STOP', cause = null) {
    if (this.phase === 'TERMINATED') return false;
    if (this.phase === 'STOPPING' || this.phase === 'DRAINING' ||
        this.phase === 'TEARDOWN') return false;
    this.stopKind = kind;
    this.cause = cause;
    if (!this.ready) this.readyFailure = 'ActorTerminated';
    this.phase = 'STOPPING';
    // Always seal new DATA admission. For initialized graceful stop,
    // preserve previously accepted FIFO mail for bounded drain turns.
    if (kind !== 'GRACEFUL_STOP' || !this.ready) this.queue = 0;
    if (cause) this.controlNotices.push({
      kind: 'FAILURE_REPORTED', generation: this.generation, cause
    });
    return true;
  }
  beginDrainTurn() {
    if (this.phase !== 'STOPPING' || this.stopKind !== 'GRACEFUL_STOP' ||
        !this.ready || this.active || this.queue === 0) return false;
    this.active = true;
    this.queue--;
    return true;
  }
  drain() {
    if (this.phase !== 'STOPPING' || this.active || this.queue > 0) return false;
    this.phase = 'DRAINING';
    return true;
  }
  beginTeardown() {
    if (this.phase !== 'DRAINING' || !this.ready ||
        this.stopKind !== 'GRACEFUL_STOP') return false;
    this.phase = 'TEARDOWN';
    this.teardownCalls++;
    return true;
  }
  finishTeardown() {
    if (this.phase !== 'TEARDOWN' || this.teardownFinished) return false;
    this.teardownFinished = true;
    return true;
  }
  retire() {
    if (!['DRAINING', 'TEARDOWN'].includes(this.phase) ||
        this.active || this.loans > 0) return false;
    if (this.phase === 'TEARDOWN' && !this.teardownFinished) return false;
    // A successful cooperative stop must complete its unique teardown.
    if (this.ready && this.stopKind === 'GRACEFUL_STOP' &&
        this.teardownCalls !== 1) return false;
    this.phase = 'TERMINATED';
    this.done = true;
    this.controlNotices.push({ kind: 'PHYSICALLY_RETIRED', generation: this.generation });
    return true;
  }
  panic(error) {
    // No actor on_panic hook; CONTROL remains independent of DATA saturation.
    return this.stop('PANIC', error);
  }
  restart() {
    assert.ok(this.done && this.phase === 'TERMINATED' && this.loans === 0);
    return new Lifecycle(this.generation + 1, this.capacity);
  }
}

function requireImplementation({ traits = [], methods = {}, requiredState = {}, state = {} }) {
  for (const trait of traits) {
    if (trait === 'ActorLifecycle' || trait === 'Receives' || trait === 'Supervisor') {
      return 'ACTOR_RESERVED_AUTHORITY';
    }
  }
  for (const [name, type] of Object.entries(methods.required ?? {})) {
    if (methods.provided?.[name] !== type) return 'ACTOR_TRAIT_METHOD_UNSATISFIED';
  }
  for (const [name, type] of Object.entries(requiredState)) {
    if (state[name] !== type) return 'ACTOR_STATE_WITNESS_MISMATCH';
  }
  return null;
}

test('schema is fail-closed and does not attest guest execution', () => {
  assert.equal(contract.schema, 'atto.actor.base-lifecycle/2');
  assert.equal(contract.status, 'PROPOSED_SOURCE_FREE_NOT_GUEST_VERIFIED');
  assert.equal(contract.authority, 'COMPILER_RUNTIME_OWNED');
  assert.deepEqual(contract.evidence_policy.expected_targets,
    ['java','llvm','net','wasm','forge']);
  assert.equal(contract.base.cannot_be_user_defined, true);
  assert.equal(contract.state_contract.actor_trait_behavioral_only, true);
  assert.equal(contract.roles.on_panic.guest_implementable, false);
  for (const role of ['init', 'receive']) {
    assert.equal(contract.roles[role].direct_guest_call, false);
    assert.equal(contract.roles[role].entry, 'external');
  }
  assert.equal(contract.cases.length, 25);
  assert.equal(new Set(contract.cases.map(c => c.id)).size, 25);
  assert.equal(new Set(contract.events.map(e => e.name)).size, contract.events.length);
  assert.ok(contract.cases.every(c => c.verified_backends.length === 0
      && c.source_status === 'DESIGN_CASE_NOT_EXECUTED'));
});

test('state graph never allows re-entry from TERMINATED', () => {
  const graph = contract.lifecycle.allowed_transitions;
  assert.deepEqual(Object.keys(graph), contract.lifecycle.phases);
  for (const [phase, destinations] of Object.entries(graph)) {
    assert.ok(!destinations.includes('ALLOCATED'), phase);
    assert.equal(destinations.length, new Set(destinations).size);
    for (const dest of destinations) assert.ok(Object.hasOwn(graph, dest), phase);
  }
  assert.deepEqual(graph.TERMINATED, []);
});

test('pre-READY queue is bounded and receive cannot run before READY', () => {
  const a = new Lifecycle();
  assert.equal(a.send(1), true);
  assert.equal(a.send(1), true);
  assert.equal(a.send(1), false);
  assert.equal(a.beginTurn(), false);
  a.startInit();
  assert.equal(a.beginTurn(), false);
  assert.equal(a.succeedInit(), true);
  assert.equal(a.succeedInit(), false);
  assert.equal(a.initCalls, 1);
  assert.equal(a.beginTurn(), true);
  assert.equal(a.beginTurn(), false);
  a.endTurn();
  assert.equal(a.beginTurn(), true);
  a.endTurn();
  assert.equal(a.ready, true);
});

test('stop races with init, and cannot later publish READY', () => {
  const a = new Lifecycle();
  a.startInit();
  assert.equal(a.stop(), true);
  assert.equal(a.readyFailure, 'ActorTerminated');
  assert.equal(a.succeedInit(), false);
  assert.equal(a.send(1), false);
  assert.equal(a.beginTurn(), false);
  assert.equal(a.drain(), true);
  assert.equal(a.beginTeardown(), false);
  assert.equal(a.retire(), true);
  assert.equal(a.done, true);
});

test('active owner turn and borrowed state prevent physical retirement', () => {
  const a = new Lifecycle();
  a.startInit();
  a.succeedInit();
  a.send(1);
  a.beginTurn();
  assert.equal(a.borrow(), true);
  assert.equal(a.stop(), true);
  assert.equal(a.drain(), false);
  a.endTurn();
  assert.equal(a.drain(), true);
  assert.equal(a.beginTeardown(), true);
  assert.equal(a.beginTeardown(), false);
  assert.equal(a.finishTeardown(), true);
  assert.equal(a.retire(), false);
  a.releaseLoan();
  assert.equal(a.retire(), true);
  assert.equal(a.teardownCalls, 1);
});

test('graceful stop drains accepted FIFO before teardown and retirement', () => {
  const a = new Lifecycle();
  a.startInit();
  a.succeedInit();
  assert.equal(a.send(1), true);
  assert.equal(a.send(1), true);
  assert.equal(a.stop('GRACEFUL_STOP'), true);
  assert.equal(a.send(1), false);
  assert.equal(a.beginTurn(), false);
  assert.equal(a.drain(), false);
  assert.equal(a.beginDrainTurn(), true);
  assert.equal(a.beginDrainTurn(), false);
  a.endTurn();
  assert.equal(a.drain(), false);
  assert.equal(a.beginDrainTurn(), true);
  a.endTurn();
  assert.equal(a.drain(), true);
  assert.equal(a.retire(), false);
  assert.equal(a.beginTeardown(), true);
  assert.equal(a.retire(), false);
  assert.equal(a.finishTeardown(), true);
  assert.equal(a.retire(), true);
});

test('cancel does not invoke cooperative teardown', () => {
  const a = new Lifecycle();
  a.startInit();
  a.succeedInit();
  assert.equal(a.stop('CANCELLED'), true);
  assert.equal(a.stop('CANCELLED'), false);
  assert.equal(a.drain(), true);
  assert.equal(a.beginTeardown(), false);
  assert.equal(a.retire(), true);
  assert.equal(a.teardownCalls, 0);
});

test('panic cannot be consumed as DATA even when mailbox is full', () => {
  const a = new Lifecycle();
  a.startInit();
  a.succeedInit();
  a.send(1);
  a.send(1);
  assert.equal(a.send(1), false);
  assert.equal(a.panic('fatal actor error'), true);
  assert.equal(a.send(1), false);
  assert.equal(a.beginTurn(), false);
  assert.equal(a.controlNotices.filter(n => n.kind === 'FAILURE_REPORTED').length, 1);
  assert.equal(a.controlNotices[0].generation, 1);
  a.drain();
  assert.equal(a.beginTeardown(), false);
  assert.equal(a.retire(), true);
});

test('restart is new incarnation and stale generation is rejected', () => {
  const a = new Lifecycle(9);
  a.startInit();
  a.succeedInit();
  a.stop('CANCELLED');
  a.drain();
  assert.equal(a.retire(), true);
  const b = a.restart();
  assert.equal(b.generation, 10);
  assert.equal(b.send(9), false);
  assert.equal(b.send(10), true);
  assert.equal(b.beginTurn(), false);
  assert.throws(() => a.restart().restart());
});

test('typed trait behavior and state shape use different proofs', () => {
  const base = {
    traits: ['HasConfig'],
    methods: { required: { config: 'WorkerConfig' }, provided: { config: 'WorkerConfig' } },
    requiredState: { config: 'WorkerConfig', count: 'int' },
    state: { config: 'WorkerConfig', count: 'int' }
  };
  assert.equal(requireImplementation(base), null);
  assert.equal(requireImplementation({
    ...base, methods: { ...base.methods, provided: {} }
  }), 'ACTOR_TRAIT_METHOD_UNSATISFIED');
  assert.equal(requireImplementation({
    ...base, state: { config: 'WorkerConfig', count: 'string' }
  }), 'ACTOR_STATE_WITNESS_MISMATCH');
  assert.equal(requireImplementation({
    ...base, traits: ['ActorLifecycle']
  }), 'ACTOR_RESERVED_AUTHORITY');
});

test('source-free output is never a parity receipt', () => {
  assert.equal(contract.evidence_policy.no_synthetic_promotion, true);
  assert.ok(contract.evidence_policy.required.includes('real_guest_init_receive_stop'));
  assert.ok(contract.evidence_policy.required.includes('physical_retirement'));
  assert.ok(contract.evidence_policy.required.includes('stepful_runner_receipts'));
});
