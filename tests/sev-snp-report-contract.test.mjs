import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const contract = JSON.parse(readFileSync(
  new URL('../contracts/sev-snp-report-v1.json', import.meta.url), 'utf8'));

function bound_data(nonce, identity, spki) {
  return createHash('sha512')
    .update(contract.transcript.domain, 'ascii')
    .update(nonce)
    .update(identity)
    .update(Buffer.from([0, 0, 0, spki.length]))
    .update(spki)
    .digest();
}

function policy_match(report, digest, measurement) {
  if (report.length !== contract.report_size_bytes) return 'size';
  if (report.readUInt32LE(0) < 2 || report.readUInt32LE(0) > 5) return 'version';
  if (report.readUInt32LE(0x34) !== 1) return 'algorithm';
  if (report.readUInt32LE(0x30) !== 0) return 'vmpl';
  if (report.readUInt32LE(0x48) & 3) return 'signer';
  if (report[0x0a] & 8) return 'debug';
  if (!report.subarray(0x50, 0x90).equals(digest)) return 'report_data';
  if (!report.subarray(0x90, 0xc0).equals(measurement)) return 'measurement';
  if ([0x180, 0x181, 0x186, 0x187].some(offset => report[offset] < 1)) return 'tcb';
  return 'UNVERIFIED_POLICY_MATCH';
}

test('AMD SNP ABI shape is 1184-byte report with signed 672-byte prefix', () => {
  assert.equal(contract.schema, 'atto.sev-snp-raw-report.v1');
  assert.equal(contract.report_size_bytes, 1184);
  assert.equal(contract.signed_prefix_bytes, 672);
  const f = contract.fields;
  assert.deepEqual([f.report_data.offset, f.report_data.length], [80, 64]);
  assert.deepEqual([f.measurement_sha384.offset, f.measurement_sha384.length], [144, 48]);
  assert.deepEqual([f.signature_r.offset, f.signature_s.offset], [672, 744]);
  assert.equal(contract.hardware_verified, false);
  assert.equal(contract.release_secrets, false);
  assert.ok(contract.required_vendor_endorsement_gates.length >= 9);
});

test('Java/LLVM common nonce, image and ephemeral-key transcript agrees exactly', () => {
  const v = contract.transcript;
  const n = Buffer.from(v.nonce_hex, 'hex');
  const id = Buffer.from(v.image_identity_hex, 'hex');
  const spki = Buffer.from(v.synthetic_spki_hex, 'hex');
  assert.equal(bound_data(n, id, spki).toString('hex'), v.expected_report_data_hex);
  const flip = Buffer.from(n);
  flip[0] ^= 1;
  assert.notDeepEqual(bound_data(flip, id, spki), bound_data(n, id, spki));
  const identity = Buffer.from(id);
  identity[0] ^= 1;
  assert.notDeepEqual(bound_data(n, identity, spki), bound_data(n, id, spki));
  const otherSpki = Buffer.from(spki);
  otherSpki[0] ^= 1;
  assert.notDeepEqual(bound_data(n, id, otherSpki), bound_data(n, id, spki));
});

test('metadata-only report inspection refuses common SNP negative mutations', () => {
  const v = contract.transcript;
  const digest = Buffer.from(v.expected_report_data_hex, 'hex');
  const measurement = Buffer.alloc(48, 7);
  const report = Buffer.alloc(1184);
  report.writeUInt32LE(3, 0);
  report.writeUInt32LE(1, 0x34);
  digest.copy(report, 0x50);
  measurement.copy(report, 0x90);
  for (const offset of [0x180, 0x181, 0x186, 0x187]) report[offset] = 1;
  assert.equal(policy_match(report, digest, measurement), 'UNVERIFIED_POLICY_MATCH');

  for (const [offset, mask, expected] of [
    [0x0a, 8, 'debug'], [0x30, 1, 'vmpl'], [0x34, 1, 'algorithm'],
    [0x48, 1, 'signer'], [0x50, 1, 'report_data'],
    [0x90, 1, 'measurement'], [0x187, 1, 'tcb']
  ]) {
    const broken = Buffer.from(report);
    if (offset === 0x34) broken[offset] = 2;
    else if (offset === 0x187) broken[offset] = 0;
    else broken[offset] ^= mask;
    assert.equal(policy_match(broken, digest, measurement), expected,
      'offset ' + offset.toString(16));
  }
  assert.equal(policy_match(report.subarray(0, 1000), digest, measurement), 'size');
});
