// HOST-ONLY golden-vector derivation; never interpreted as backend execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const contract = JSON.parse(readFileSync(
  new URL('../contracts/durable-typed-scalar-wire-v1.json', import.meta.url), 'utf8'));

test('durable scalar AOT wire vectors have stable nominal IDs and exact bytes', () => {
  assert.equal(contract.status, 'HOST_VECTOR_NOT_GUEST_PARITY');
  assert.equal(contract.sourceBlobSha.length, 40);
  assert.equal(contract.wire.totalBytes, 48);
  assert.equal(contract.wire.magicHex, '4154544f');
  assert.ok(Object.values(contract.backendStatus).every(x => x === 'NOT_EXECUTED'));
  assert.equal(contract.vectors.length, 2);
  for (const v of contract.vectors) {
    const canonical = ['atto-durable-scalar-descriptor-v1', v.schema_id,
      String(v.schema_version), String(v.field_id), v.field_name, v.field_type, ''].join('\n');
    const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
    assert.equal(digest, v.fingerprint_sha256, v.name);
    const bytes = Buffer.alloc(48);
    bytes.writeUInt32BE(0x4154544f, 0);
    bytes.writeUInt32BE(v.schema_version, 4);
    Buffer.from(digest, 'hex').copy(bytes, 8);
    bytes.writeBigInt64BE(BigInt(v.input_i64), 40);
    assert.equal(bytes.toString('hex'), v.wire_hex, v.name);
  }
  assert.equal(new Set(contract.vectors.map(x => x.schema_id)).size, 2);
});

test('wire mismatch and unsupported future version are never inferred as compatible', () => {
  const first = contract.vectors[0];
  const bytes = Buffer.from(first.wire_hex, 'hex');
  assert.equal(bytes.readUInt32BE(4), 1);
  bytes.writeUInt32BE(2, 4);
  assert.notEqual(bytes.toString('hex'), first.wire_hex);
  assert.notEqual(first.fingerprint_sha256, contract.vectors[1].fingerprint_sha256);
  assert.deepEqual(contract.negativeCases, ['unknown_version', 'wrong_fingerprint',
    'wrong_length', 'wrong_nominal_schema']);
});
