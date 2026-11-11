import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const contract = JSON.parse(readFileSync(new URL('../contracts/tenant-vm-api-parity-v1.json', import.meta.url), 'utf8'));
const expected = ['java','llvm','wasm','forge','net','cranelift','js','rs','hdl'];

test('canonical TenantVM belongs to one tenant generation and many actors', () => {
  assert.equal(contract.schema,'atto.tenant-vm-api-parity.v1');
  assert.equal(contract.parent,'oreslang.tenant-isolation.v2');
  assert.deepEqual([contract.naming.root,contract.naming.tenant,contract.naming.actor],['OresVM','TenantVM','Actor']);
  assert.match(contract.naming.scope,/one tenant incarnation/i);
  assert.match(contract.naming.scope,/many actors/i);
});

test('all nine independent compiler/toolchain repositories have explicit parity entries', () => {
  assert.deepEqual(Object.keys(contract.backends).sort(),expected.sort());
  const repos = Object.values(contract.backends).map(x=>x.repo);
  assert.equal(new Set(repos).size,expected.length);
  for (const backend of Object.values(contract.backends)) {
    assert.match(backend.repo,/^oreslang-source\./);
    assert.ok(backend.api && backend.source && backend.test);
    assert.ok(contract.statuses.includes(backend.status));
    assert.match(backend.api,/TenantVM|TenantVm|tenant.vm|tenant-vm|TENANT_VM/);
  }
});

test('untrusted execution cannot be inferred from trusted compatibility aliases', () => {
  assert.equal(contract.releaseGate.untrustedTenantParity,'NOT_VERIFIED');
  assert.match(contract.status,/NOT_GUEST_EXECUTION/);
  assert.match(contract.evidence,/NOT_EXECUTED/);
  for (const backend of Object.values(contract.backends)) {
    assert.notEqual(backend.status,'UNTRUSTED_IMPLEMENTED');
  }
  for (const key of ['java','llvm','forge','net','cranelift']) {
    assert.equal(contract.backends[key].status,'TRUSTED_HOST_ONLY');
  }
  assert.equal(contract.backends.wasm.status,'WASM_SCALAR_PROTOTYPE');
  assert.equal(contract.backends.js.status,'WORKER_TRUSTED_ONLY');
  assert.equal(contract.backends.rs.status,'UNSUPPORTED');
  assert.equal(contract.backends.hdl.status,'UNSUPPORTED');
});

test('tenant lifecycle, identity, ownership and denial scenarios remain mandatory', () => {
  for (const id of [
    'one-tenant-generation-per-tenant-vm',
    'distinct-actor-private-state-and-mailboxes',
    'reject-foreign-actor-and-tenant-tickets',
    'reject-reserved-dot-tenant-ids',
    'fence-stale-tenant-generation',
    'quiescence-stops-new-admission',
    'untrusted-must-have-enforced-isolation-or-deny',
    'source-free-or-zero-step-ci-is-not-runtime-proof'
  ]) assert.ok(contract.invariants.includes(id),id);
  assert.ok(contract.releaseGate.requires.some(x=>x.includes('neighbor-survival')));
  assert.ok(contract.releaseGate.requires.some(x=>x.includes('physical-retirement')));
});

test('Wasm multi-actor TenantVM prototype cannot silently become untrusted parity', () => {
  const candidate = contract.backends.wasm.experimentalMultiActorHost;
  assert.equal(candidate.draft, 'oreslang-source.wasm#478');
  assert.equal(candidate.kind, 'TRUSTED_NODE_WORKER_PER_TENANT');
  assert.equal(candidate.guestSource, 'tests/fixtures/tenant-vm-counter.atto');
  assert.equal(candidate.requiredGate, 'npm run test:real-tenant-vm');
  assert.equal(candidate.status, 'NOT_EXECUTED');
  assert.equal(candidate.runnerEvidence, 'NOT_EXECUTED_RUNNER_ID_ZERO');
  assert.match(candidate.limitations, /no untrusted isolation certificate/);
  assert.equal(contract.releaseGate.untrustedTenantParity, 'NOT_VERIFIED');
});
