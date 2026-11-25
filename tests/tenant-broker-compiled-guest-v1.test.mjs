// Contract-only checks. These do not compile actors or prove tenant containment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const load = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const contract = load('../contracts/tenant-broker-compiled-guest-v1.json');
const previous = load('../contracts/tenant-isolation-v2.json');

const five = [
  'tenant_aggregate_quota_survives_restart',
  'revoked_capability_denied_at_dispatch',
  'forged_cross_tenant_actorref_denied',
  'authorized_broker_delivery_exactly_once',
  'unrelated_tenant_survives_denial'
];
const stages = [
  'atto_source',
  'compiler',
  'guest_artifact',
  'isolated_tenant_runtime',
  'authenticated_broker',
  'verified_quota_revocation_delivery'
];
test('contract enumerates all five source backend families without equating host tests with guest proof', () => {
  assert.equal(contract.schema, 'atto.tenant-guest-conformance.v1');
  assert.deepEqual(contract.backends, ['java','llvm','wasm','forge','net']);
  assert.match(contract.purpose, /host-only tests are not evidence/i);
});
test('the compiler-to-broker enforcement chain has no omitted stages', () => {
  assert.deepEqual(contract.stages, stages);
  assert.equal(contract.assertions.default_on_missing_stage, 'NOT_VERIFIED');
  assert.equal(contract.assertions.compiler_produced_guest_required, true);
  assert.equal(contract.assertions.live_guest_broker_calls_required, true);
});
test('all five negative and positive guest cases have distinct identifiers', () => {
  assert.deepEqual(contract.cases.map(x => x.id), five);
  assert.equal(new Set(contract.cases.map(x => x.id)).size, 5);
});
test('restart cannot replenish tenant aggregate quota', () => {
  const q = contract.cases[0];
  assert.equal(q.expect, 'DENY_QUOTA');
  assert.ok(q.asserts.some(x=>/restart/i.test(x)));
  assert.ok(/restart/i.test(contract.actor_contract.quota));
});
test('revocation fences dispatch and settles credits', () => {
  const r = contract.cases[1];
  assert.equal(r.expect, 'DENY_REVOKED');
  assert.ok(r.asserts.some(x => /dispatch/i.test(x)));
  assert.ok(r.asserts.some(x => /credits.*once/i.test(x)));
  assert.ok(/atomic/i.test(contract.actor_contract.reservation));
});
test('ActorRef forgery and replay cannot identify foreign tenants', () => {
  const r = contract.cases[2];
  assert.equal(r.expect, 'DENY_FORGED_REF');
  assert.ok(r.asserts.some(x=>/replay/i.test(x)));
  assert.match(contract.actor_contract.tenant_identity, /host context/);
  assert.match(contract.actor_contract.actor_ref, /generation-fenced/);
});
test('broker positive path requires explicit authority and exactly one delivery', () => {
  const r = contract.cases[3];
  assert.equal(r.expect, 'DELIVERED_ONCE');
  assert.ok(r.asserts.some(x => /authorized/i.test(x)));
  assert.ok(r.asserts.some(x => /one receiver delivery/i.test(x)));
  assert.match(contract.actor_contract.cross_tenant_access, /default deny/);
});
test('neighbor liveness is independent of violating tenant', () => {
  const r = contract.cases[4];
  assert.equal(r.expect, 'NEIGHBOR_LIVE');
  assert.ok(r.asserts.some(x => /latency bounded/i.test(x)));
  assert.match(contract.actor_contract.isolation, /unrelated tenant/);
});
test('receipt authenticity and artifact hashes remain mandatory', () => {
  for (const key of ['independent_workflow_run_job_step_verification_required',
    'artifact_download_and_hash_required','source_carrier_sha_parity_required']) {
    assert.equal(contract.assertions[key], true, key);
  }
  assert.equal(contract.assertions.allow_synthetic_receipts_to_pass, false);
  assert.equal(contract.assertions.allow_host_only_reference_to_pass, false);
  assert.equal(contract.assertions.production_enforcement_requires_independent_security_review, true);
});
test('prior isolation contract remains source-free and makes no verified backend claim', () => {
  assert.equal(previous.schema, 'oreslang.tenant-isolation.v2');
  assert.equal(previous.status, 'SOURCE_FREE_REFERENCE_NOT_BACKEND_EXECUTION');
  for (const name of contract.backends) {
    assert.ok(['NOT_EXECUTED','NO_UNTRUSTED_PATH'].includes(previous.backendProfiles[name].status));
  }
});
