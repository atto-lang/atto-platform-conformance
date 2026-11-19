import assert from 'node:assert/strict';
import test from 'node:test';
import { contract, verify_receipt } from '../bin/verify-socket-broker-receipt.mjs';

const receipt = () => ({
  backend: 'forge', case_id: 'two-tenants-one-pid', status: 'passed',
  exact_head_sha: 'a'.repeat(40), source_tree_sha: 'b'.repeat(40),
  compiled_atto_guest_sha256: 'c'.repeat(64), sandbox_artifact_sha256: 'd'.repeat(64),
  guest_executed: true, executed_steps: 2, toolchain: 'clang-17',
  workflow_url: 'https://github.com/example/ci/actions/runs/1',
  observed_outcome: 'A trapped, B completed in the same PID',
  tenant_pids: [234, 234], distinct_tenant_ids: ['A', 'B'],
  sandbox_boundary: { verified: true, guest_direct_syscalls_denied: true,
    guest_raw_fd_access_denied: true },
});

test('registry is specific, unique, and explicitly unexecuted', () => {
  assert.equal(contract.schema, 'atto.tenant-socket-isolation.v1');
  assert.equal(contract.case_ids.length, 20);
  assert.equal(new Set(contract.case_ids).size, 20);
  assert.ok(contract.case_ids.includes('deny-cross-tenant-read'));
  assert.ok(contract.case_ids.includes('neighbor-survives-sandbox-trap'));
  assert.deepEqual(new Set(Object.values(contract.backends)), new Set(['not_executed']));
  assert.equal(contract.guest_admission, 'DENY_UNTIL_CONFINEMENT_VERIFIED');
});
test('explicit unsupported is not a test pass', () => {
  assert.equal(verify_receipt({backend:'forge', case_id:contract.case_ids[0],
    status:'unsupported',reason:'missing sandbox verifier'}), true);
});
test('valid-shaped receipt still needs independent authenticity checks', () => {
  assert.equal(verify_receipt(receipt()), true);
});
for (const [name, change, diagnostic] of [
  ['zero-step', r => { r.executed_steps=0; }, /NO_GUEST_EXECUTION/],
  ['host-only', r => { r.guest_executed=false; }, /NO_GUEST_EXECUTION/],
  ['distinct PIDs', r => { r.tenant_pids=[234,235]; }, /NOT_TWO_TENANTS_SAME_PID/],
  ['forged same tenant', r => { r.distinct_tenant_ids=['A','A']; }, /NOT_TWO_TENANTS_SAME_PID/],
  ['no syscall denial', r => { r.sandbox_boundary.guest_direct_syscalls_denied=false; }, /SANDBOX_NOT_PROVEN/],
  ['no FD denial', r => { r.sandbox_boundary.guest_raw_fd_access_denied=false; }, /SANDBOX_NOT_PROVEN/],
  ['missing guest SHA', r => { delete r.compiled_atto_guest_sha256; }, /ARTIFACT_SHA/],
  ['missing source SHA', r => { delete r.source_tree_sha; }, /SOURCE_SHA/],
  ['fictional backend', r => { r.backend='unknown'; }, /BACKEND/]
]) {
  test('reject ' + name + ' false-positive', () => {
    const r = receipt(); change(r);
    assert.throws(() => verify_receipt(r), diagnostic);
  });
}
