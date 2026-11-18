// Source-free structural contract checks. These DO NOT compile AttoLang or exercise a VM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const contract = JSON.parse(readFileSync(new URL('../contracts/tenant-memory-access-v1.json', import.meta.url), 'utf8'));

const requiredFields = [
  'tenantReferences', 'scope', 'actorMemory', 'borrow', 'copy', 'take', 'share',
  'hostApi', 'carriers', 'lifetime', 'scrubbing', 'admission'
];
const mandatoryScenarios = [
  'nested-deep-copy-no-alias', 'cyclic-or-shared-subgraph-copy-or-reject',
  'mutable-backing-store-cross-tenant-denied', 'borrow-escape-cross-tenant-rejected',
  'invalid-take-cross-tenant-rejected', 'forged-and-replayed-handle-rejected',
  'tenant-generation-reuse-rejected', 'actor-sibling-out-of-bounds-rejected',
  'tenant-cage-out-of-bounds-rejected', 'effective-address-overflow-rejected',
  'host-call-offset-length-overflow-rejected', 'host-send-cross-actor-source-offset-rejected',
  'carrier-tls-and-heap-base-handoff',
  'carrier-exception-and-cancellation-handoff',
  'root-host-api-callback-lifetime-and-concurrency', 'retirement-race-does-not-release-live-memory',
  'allocator-and-buffer-reuse-no-old-data', 'guest-native-ffi-and-import-admission-denied',
  'neighbor-survives-failed-tenant', 'compiled-real-guest-cross-tenant-denial'
];

test('memory-access contract extends existing shared-process isolation v2, not process-per-tenant', () => {
  assert.equal(contract.schema, 'oreslang.tenant-memory-access.v1');
  assert.equal(contract.version, 1);
  assert.equal(contract.parent, 'oreslang.tenant-isolation.v2');
  assert.equal(contract.status, 'SOURCE_FREE_CONTRACT_NOT_BACKEND_EXECUTION');
});

test('memory ownership, compiler confinement, handoff and lifetime requirements stay explicit', () => {
  assert.deepEqual(Object.keys(contract.requirements).sort(), requiredFields.sort());
  for (const [id, rule] of Object.entries(contract.requirements)) {
    assert.equal(typeof rule, 'string', id);
    assert.ok(rule.length >= 40, `${id}: missing substantive rule`);
  }
  assert.match(contract.requirements.tenantReferences, /raw native pointer/);
  assert.match(contract.requirements.hostApi, /overflow/);
  assert.match(contract.requirements.hostApi, /sending actor/);
  assert.match(contract.requirements.carriers, /tenant switch/);
  assert.match(contract.requirements.carriers, /Module-global guest callback/);
  assert.match(contract.requirements.borrow, /compilation error/);
  assert.match(contract.requirements.scrubbing, /different tenant/);
});

test('all negative tests are specified once, including compiled guest and reuse tests', () => {
  assert.deepEqual([...contract.mandatoryScenarios].sort(), [...mandatoryScenarios].sort());
  assert.equal(new Set(contract.mandatoryScenarios).size, contract.mandatoryScenarios.length);
  assert.ok(contract.mandatoryScenarios.some(s => s.startsWith('compiled-real-guest')));
});

test('source-free evidence cannot promote any backend or waive provenance', () => {
  assert.equal(contract.promotion.backendEvidence, 'NOT_EXECUTED');
  assert.deepEqual(contract.promotion.requiredKinds,
    ['BACKEND_NATIVE_EXECUTED', 'REAL_ORESLANG_GUEST_EXECUTED']);
  assert.ok(contract.promotion.mustPin.includes('nonzero_executed_steps'));
  assert.ok(contract.promotion.mustPin.includes('source_tree_sha'));
  assert.match(contract.promotion.rule, /no backend may report/);
});

test('the stated threat model excludes malicious native execution, not accidental runtime paths', () => {
  assert.ok(contract.threatModel.inScope.includes('worker handoff'));
  assert.ok(contract.threatModel.inScope.includes('allocator reuse'));
  assert.ok(contract.threatModel.excluded.includes('malicious native/FFI guest code'));
  assert.ok(contract.threatModel.excluded.includes('microarchitectural side channels'));
  assert.match(contract.requirements.admission, /no fallback/);
});
