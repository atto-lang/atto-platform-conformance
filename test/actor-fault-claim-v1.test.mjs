import test from 'node:test';
import assert from 'node:assert/strict';
import { validateActorFaultClaim as admit, BACKENDS, FAILURES } from '../src/actor-fault-claim-v1.mjs';

const base = () => ({
  schema: 'atto.actor-fault-claim.v1',
  backend: 'oreslang-source.llvm',
  failure_class: 'guest-panic',
  claimed_scope: 'actor',
  isolation_mechanism: 'same-process-guards',
  one_actor_per_worker: false,
  supervisor_out_of_process: false,
  enforced_memory_limit: false,
  execution_status: 'not_executed'
});
const accepted = claim => {
  const r = admit(claim);
  assert.equal(r.valid, true, r.reason);
  assert.equal(r.certified, false);
  assert.equal(r.releaseReady, false);
  assert.equal(r.evidenceClass, 'SELF_REPORTED_SHAPE_ONLY');
};
const denied = claim => {
  const r = admit(claim);
  assert.equal(r.valid, false, JSON.stringify(claim));
  assert.equal(r.certified, false);
  assert.equal(r.releaseReady, false);
};

test('all seven independent backends remain pending, never certified', () => {
  for (const backend of BACKENDS) accepted({ ...base(), backend });
});
test('all failure classes allow honest process-scope bookkeeping', () => {
  for (const failure_class of FAILURES)
    accepted({ ...base(), failure_class, claimed_scope: 'process',
      isolation_mechanism: 'none' });
});
test('guest-scoped failure declaration never implies executed containment', () => {
  accepted({ ...base(), execution_status: 'executed_claimed' });
  assert.equal(admit({ ...base(), execution_status: 'executed_claimed' }).reason,
    'SELF_REPORTED_NOT_AUTHENTICATED');
});
test('every process-fatal fault denies in-process actor containment', () => {
  for (const failure_class of ['native-segv', 'host-oom', 'os-process-kill', 'vm-corruption']) {
    denied({ ...base(), failure_class });
    denied({ ...base(), failure_class, claimed_scope: 'tenant',
      isolation_mechanism: 'bounded-guest-vm' });
  }
});
test('external supervisor and dedicated worker are necessary, not proof', () => {
  for (const failure_class of ['native-segv', 'os-process-kill', 'vm-corruption']) {
    const claim = { ...base(), failure_class,
      isolation_mechanism: 'dedicated-worker-process',
      supervisor_out_of_process: true };
    denied(claim); // an actor shares this worker with other actors
    accepted({ ...claim, one_actor_per_worker: true });
    accepted({ ...claim, claimed_scope: 'tenant' });
  }
});
test('host OOM must be independently budgeted at OS boundary', () => {
  const claim = { ...base(), failure_class: 'host-oom',
    isolation_mechanism: 'dedicated-worker-process',
    supervisor_out_of_process: true, one_actor_per_worker: true };
  denied(claim);
  accepted({ ...claim, enforced_memory_limit: true });
});
test('missing, extra, accessor, inherited, symbol and proxy authority denied', () => {
  denied(null);
  denied([]);
  denied({ ...base(), extra: true });
  const missing = base();
  delete missing.backend;
  denied(missing);
  denied(Object.assign(Object.create({ inherited: true }), base()));
  const accessor = base();
  Object.defineProperty(accessor, 'backend', { enumerable: true,
    get() { throw Error('must not execute'); } });
  denied(accessor);
  denied({ ...base(), [Symbol('secret')]: true });
  denied(new Proxy(base(), {}));
  const revoked = Proxy.revocable(base(), {});
  revoked.revoke();
  denied(revoked.proxy);
});
test('invalid enum, schema and boolean authority denied', () => {
  for (const patch of [
    { schema: 'atto.actor-fault-claim.v2' },
    { backend: 'oreslang-source.fake' },
    { failure_class: 'guest-segfault' },
    { claimed_scope: 'everything' },
    { isolation_mechanism: 'signal-handler' },
    { execution_status: 'passed' },
    { one_actor_per_worker: 'true' },
    { supervisor_out_of_process: 1 },
    { enforced_memory_limit: null }
  ]) denied({ ...base(), ...patch });
});
