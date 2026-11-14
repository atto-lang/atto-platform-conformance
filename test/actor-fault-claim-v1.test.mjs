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
  assert.equal(r.valid, false, 'malformed claim must be denied');
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
test('exhaustive backend/fault/scope/mechanism/budget matrix never certifies', () => {
  const fatal = new Set(['native-segv', 'host-oom', 'os-process-kill', 'vm-corruption']);
  const scopes = ['actor', 'tenant', 'process'];
  const mechanisms = ['none', 'same-process-guards', 'bounded-guest-vm', 'dedicated-worker-process'];
  let cases = 0;
  for (const backend of BACKENDS)
    for (const failure_class of FAILURES)
      for (const claimed_scope of scopes)
        for (const isolation_mechanism of mechanisms)
          for (const one_actor_per_worker of [false, true])
            for (const supervisor_out_of_process of [false, true])
              for (const enforced_memory_limit of [false, true])
                for (const execution_status of ['not_executed', 'executed_claimed']) {
                  const claim = { ...base(), backend, failure_class, claimed_scope,
                    isolation_mechanism, one_actor_per_worker, supervisor_out_of_process,
                    enforced_memory_limit, execution_status };
                  const processScope = claimed_scope === 'process';
                  const external = isolation_mechanism === 'dedicated-worker-process';
                  const hostFatal = fatal.has(failure_class);
                  const valid = (processScope || isolation_mechanism !== 'none') &&
                    (!hostFatal || processScope || (external && supervisor_out_of_process &&
                      (claimed_scope !== 'actor' || one_actor_per_worker) &&
                      (failure_class !== 'host-oom' || enforced_memory_limit)));
                  const got = admit(claim);
                  assert.equal(got.valid, valid,
                    `${backend} ${failure_class} ${claimed_scope} ${isolation_mechanism} ` +
                    `${one_actor_per_worker} ${supervisor_out_of_process} ${enforced_memory_limit}`);
                  assert.equal(got.certified, false);
                  assert.equal(got.releaseReady, false);
                  assert.equal(got.evidenceClass, 'SELF_REPORTED_SHAPE_ONLY');
                  assert.equal(Object.isFrozen(got), true);
                  if (valid) assert.equal(got.reason,
                    execution_status === 'not_executed' ?
                      'NOT_EXECUTED' : 'SELF_REPORTED_NOT_AUTHENTICATED');
                  cases++;
                }
  assert.equal(cases, 7 * 8 * 3 * 4 * 2 * 2 * 2 * 2);
});
