import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const registry = JSON.parse(readFileSync(
  new URL('../contracts/actor-execution-classes-v1.json', import.meta.url), 'utf8'));

const requiredCases = [
  'aex-default-shared', 'aex-explicit-shared', 'aex-isolated', 'aex-untrusted',
  'aex-pub-isolated-durable', 'aex-serial-untrusted',
  'aex-two-domains', 'aex-duplicate-shared', 'aex-storage-conflict',
  'aex-out-of-order', 'aex-duplicate-transport',
  'aex-marker-implements', 'aex-marker-extends', 'aex-state-direct-access',
  'aex-trusted-shared-pool', 'aex-private-lazy-pool', 'aex-guest-shared-floor',
  'aex-host-mints-tenant', 'aex-untrusted-deny-no-sandbox',
  'aex-hostile-siblings-separate', 'aex-cross-tenant-pointer',
  'aex-cross-tenant-serialization', 'aex-socket-no-grant',
  'aex-tenant-stale-resume', 'aex-private-cap-exhaustion',
  'aex-panic-priority', 'aex-kill-neighbor-survives',
  'aex-tenant-local-isolated',
];

test('actor class registry pins all disjoint syntax and security targets', () => {
  assert.equal(registry.schema, 'atto.actor-execution-classes.v1');
  assert.equal(registry.status, 'TARGET_NOT_GUEST_EXECUTED');
  assert.equal(registry.cases.length, 28);
  assert.deepEqual(new Set(registry.cases.map(c => c.id)), new Set(requiredCases));
  assert.equal(registry.rules.default_domain, 'shared');
  assert.deepEqual(registry.rules.exclusive_domain_modifiers, ['shared', 'isolated', 'untrusted']);
  assert.equal(registry.rules.storage_mutually_exclusive, true);
  assert.equal(registry.rules.domain_marker_implementation, 'compiler_only_sealed');
  assert.equal(registry.rules.guest_security_floor, 'host_authenticated_non_downgradable');
  assert.equal(registry.rules.sandbox_unavailable, 'DENIED_OR_UNSUPPORTED_NOT_TRUSTED_FALLBACK');
});

test('proposed .atto parse and type fixtures cannot be reported as executed', () => {
  const kinds = new Set(['parse_accept', 'parse_reject', 'type_reject', 'runtime']);
  for (const c of registry.cases) {
    assert.match(c.id, /^aex-[a-z0-9-]+$/);
    assert.ok(kinds.has(c.expect), c.id);
    assert.ok(c.reason.length >= 12, c.id);
    assert.equal(c.status, 'not_executed', c.id);
    assert.deepEqual(Object.keys(c.evidence), registry.backend_targets, c.id);
    for (const backend of registry.backend_targets) {
      assert.equal(c.evidence[backend], 'not_executed', c.id + ':' + backend);
    }
    if (c.expect === 'runtime') {
      assert.equal(c.source, undefined, c.id + ': runtime case requires external harness');
    } else {
      assert.equal(typeof c.source, 'string', c.id);
      assert.ok(c.source.includes('define '), c.id);
      assert.ok(c.source.includes('pub fnc main(): int'), c.id);
      assert.ok(c.source.length < 4096, c.id);
    }
  }
  assert.ok(registry.cases.some(c => c.expect === 'parse_accept'));
  assert.ok(registry.cases.some(c => c.expect === 'parse_reject'));
  assert.ok(registry.cases.some(c => c.expect === 'type_reject'));
  assert.ok(registry.cases.some(c => c.expect === 'runtime'));
});

test('contract rejects false positives for runtime execution and confinement', () => {
  assert.equal(registry.rules.cross_tenant_transfer, 'BOUNDED_BROKER_COPY');
  assert.equal(registry.rules.hostile_principals, 'SEPARATE_TENANT_VM');
  assert.equal(registry.rules.untrusted_io, 'DEFAULT_DENY_BROKER_ONLY');
  assert.equal(registry.rules.actor_mutable_state, 'sealed');
  assert.equal(registry.rules.no_guest_parity_claim, true);
  assert.equal(registry.receipts.no_source_only_pass, true);
  assert.equal(registry.receipts.not_executed_without_verified_real_guest, true);
  for (const required of ['backend_head_sha', 'tree_sha', 'compiler_sha256',
    'artifact_sha256', 'executed_steps', 'actual_guest_result', 'sandbox_boundary_evidence']) {
    assert.ok(registry.receipts.pass_requires.includes(required), required);
  }
});

test('positive domain spelling is not confused with security authorization', () => {
  const byId = new Map(registry.cases.map(c => [c.id, c]));
  assert.match(byId.get('aex-default-shared').source, /define actor DefaultShared/);
  assert.match(byId.get('aex-explicit-shared').source, /define shared actor ExplicitShared/);
  assert.match(byId.get('aex-isolated').source, /define isolated actor PrivateWorker/);
  assert.match(byId.get('aex-untrusted').source, /define untrusted actor SandboxWorker/);
  assert.match(byId.get('aex-pub-isolated-durable').source, /define pub isolated durable actor/);
  assert.match(byId.get('aex-serial-untrusted').source, /define untrusted serial http actor/);
  for (const id of ['aex-guest-shared-floor', 'aex-host-mints-tenant',
    'aex-untrusted-deny-no-sandbox', 'aex-hostile-siblings-separate']) {
    assert.equal(byId.get(id).expect, 'runtime');
  }
});
