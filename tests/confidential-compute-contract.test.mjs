import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = JSON.parse(readFileSync(
  new URL('../contracts/confidential-compute-v1.json', import.meta.url), 'utf8'));

function equal_hex(left, right) {
  // Policy-only reference comparison; NEVER a vendor cryptographic verifier.
  return typeof left === 'string' && typeof right === 'string'
    && /^[a-f0-9]+$/i.test(left) && left.length === right.length
    && left.toLowerCase() === right.toLowerCase();
}
function inspect(c) {
  const f = contract.fixture;
  if (typeof c.quote_hex !== 'string' || c.quote_hex.length === 0
      || c.measurement_sha256.length !== 64 || c.nonce.length !== 64)
    return 'REJECTED_EVIDENCE';
  if (c.provider !== f.provider) return 'REJECTED_PROVIDER';
  if (!equal_hex(c.nonce, f.nonce)) return 'REJECTED_NONCE';
  if (!equal_hex(c.measurement_sha256, f.measurement_sha256))
    return 'REJECTED_MEASUREMENT';
  if (c.debug_enabled) return 'REJECTED_DEBUG';
  if (c.revoked) return 'REJECTED_REVOKED';
  if (c.tcb < f.min_tcb) return 'REJECTED_TCB';
  if (c.now_ms < f.challenge_issued_at_ms
      || c.now_ms - f.challenge_issued_at_ms > f.challenge_ttl_ms
      || c.issued_at_ms < f.challenge_issued_at_ms
      || c.issued_at_ms > c.now_ms
      || c.now_ms - c.issued_at_ms > f.max_evidence_age_ms)
    return 'REJECTED_FRESHNESS';
  return 'UNVERIFIED_CLAIMS_MATCH'; // explicitly NOT signed quote verification
}

test('confidential computing contract cannot claim TEE security from metadata', () => {
  assert.equal(contract.schema, 'atto.confidential-compute.v1');
  assert.equal(contract.preflight_may_authorize_execution, false);
  assert.equal(contract.preflight_may_release_secrets, false);
  assert.equal(contract.crypto_verifier_implemented, false);
  assert.ok(!contract.preflight_states.includes('HARDWARE_ATTESTED'));
  assert.ok(!contract.preflight_states.includes('VENDOR_VERIFIED'));
  assert.ok(contract.boundaries.tenant_vm.includes('independent'));
  assert.deepEqual(contract.providers, ['amd-sev-snp', 'intel-tdx']);
  for (const evidence of Object.values(contract.backend_evidence)) {
    assert.equal(evidence.preflight, 'HOST_ONLY');
    assert.equal(evidence.hardware, 'NOT_EXECUTED');
  }
});

test('versioned negative vector IDs are unique and have explicit results', () => {
  const ids = new Set();
  for (const vector of contract.preflight_vectors) {
    assert.ok(!ids.has(vector.id), `duplicate ${vector.id}`);
    ids.add(vector.id);
    const got = inspect({ ...contract.fixture, ...vector.patch });
    assert.equal(got, vector.expect, vector.id);
  }
  assert.ok(contract.preflight_vectors.length >= 10);
  assert.ok(contract.session_vectors.some(x => x.id.includes('replay')));
  assert.ok(contract.hardware_negative_cases.includes('tampered_signed_quote'));
  assert.ok(contract.hardware_negative_cases.includes('cross_tenant_socket'));
});
