// SOURCE-ONLY reference/evidence-structure checks. Not Atto compiler execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = JSON.parse(readFileSync(
  new URL('../contracts/std-metrics-json-zorde-nine-backend-v1.json', import.meta.url), 'utf8'
));
const expected = ['java','llvm','net','wasm','forge','rs','cranelift','js','hdl'];
const sha40 = /^[0-9a-f]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;

function encode_varuint31(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) return null;
  const out = [];
  do {
    const digit = value % 128;
    value = Math.floor(value / 128);
    out.push(digit + (value > 0 ? 128 : 0));
  } while (value > 0);
  return out;
}
function decode_varuint31(octets) {
  let value = 0, multiplier = 1;
  for (let i = 0; i < 5; i++) {
    if (i >= octets.length) return null;
    const byte = octets[i];
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null;
    const digit = byte % 128;
    if (i === 4 && (digit > 7 || byte >= 128)) return null;
    if (i > 0 && digit === 0 && byte < 128) return null;
    value += digit * multiplier;
    if (byte < 128) return { value, next: i + 1 };
    multiplier *= 128;
  }
  return null;
}
function decode_frame(wire) {
  if (wire.length < 8 || wire.length > 1048576) return null;
  if (wire.slice(0, 5).join(',') !== '90,79,82,68,1') return null;
  let cursor = 5;
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const item = decode_varuint31(wire.slice(cursor));
    if (!item) return null;
    parts.push(item.value);
    cursor += item.next;
  }
  const [schema_id, schema_version, length] = parts;
  if (schema_id < 1 || schema_version < 1 || length > 1048540 || length !== wire.length - cursor) return null;
  return { schema_id, schema_version, payload: wire.slice(cursor) };
}
function admit_receipt(backend, receipt) {
  if (!expected.includes(backend) || !receipt || receipt.status !== 'PASS') return false;
  if (receipt.backend !== backend || receipt.execution_kind !== 'REAL_COMPILED_ATTO_GUEST') return false;
  for (const key of ['source_commit_sha','source_root_tree_sha','compiler_commit_sha','compiler_root_tree_sha']) {
    if (!sha40.test(receipt[key] ?? '')) return false;
  }
  for (const key of ['test_plan_digest_sha256','test_artifact_sha256']) {
    if (!sha256.test(receipt[key] ?? '')) return false;
  }
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/[0-9]+$/.test(receipt.workflow_run_url ?? '')) return false;
  if (!Number.isSafeInteger(receipt.executed_non_setup_step_count) || receipt.executed_non_setup_step_count < 1) return false;
  if (!Number.isSafeInteger(receipt.guest_test_count) || receipt.guest_test_count < 1) return false;
  if (receipt.guest_pass_count !== receipt.guest_test_count ||
      receipt.guest_fail_count !== 0 || receipt.guest_skip_count !== 0) return false;
  if (!receipt.target_profile || !receipt.external_verification_required) return false;
  // This is only a receipt SHAPE check. An independent trusted integration
  // must verify run/job identity, signatures, Git trees and CI provenance.
  return true;
}

test('all nine independent compiler targets are declared, none falsely green', () => {
  assert.equal(contract.schema, 'atto.stdlib.metrics-json-zorde.parity-v1');
  assert.deepEqual(contract.compiler_targets.map(t => t.backend), expected);
  for (const t of contract.compiler_targets) {
    assert.equal(t.repo, 'atto-lang/atto-source.' + t.backend);
    assert.equal(t.guest_execution, 'NOT_EXECUTED');
    assert.notEqual(t.implementation, 'PASS');
    assert.equal(t.evidence, null);
  }
});

test('varuint31 canonical vectors reject overlong, overflow and truncation', () => {
  const v = contract.reference.zorde;
  for (const x of v.valid_varuint31) {
    assert.deepEqual(encode_varuint31(x.value), x.wire);
    assert.deepEqual(decode_varuint31(x.wire), { value: x.value, next: x.wire.length });
  }
  for (const x of v.invalid_varuint31) assert.equal(decode_varuint31(x.wire), null, JSON.stringify(x));
  assert.equal(encode_varuint31(2147483648), null);
  assert.equal(encode_varuint31(-1), null);
});

test('frame vectors have exact ZORD v1 bytes and reject ambiguous payloads', () => {
  const v = contract.reference.zorde;
  for (const x of v.frames) {
    const actual = [90,79,82,68,1, ...encode_varuint31(x.schema_id),
      ...encode_varuint31(x.schema_version), ...encode_varuint31(x.payload.length), ...x.payload];
    assert.deepEqual(actual, x.wire);
    assert.deepEqual(decode_frame(x.wire), {
      schema_id: x.schema_id, schema_version: x.schema_version, payload: x.payload
    });
    assert.equal(decode_frame([...x.wire, 0]), null, 'trailing payload must reject');
  }
  for (const x of v.invalid_frames) assert.equal(decode_frame(x.wire), null, x.reason);
});

test('ZigZag31 signed endpoints and canonical bytes', () => {
  const v = contract.reference.zorde;
  for (const { value, wire } of v.signed_zigzag31) {
    assert.ok(value >= -1073741824 && value <= 1073741823);
    const encoded = value < 0 ? (-value - 1) * 2 + 1 : value * 2;
    assert.deepEqual(encode_varuint31(encoded), wire);
    const n = decode_varuint31(wire).value;
    assert.equal(n % 2 ? -Math.floor(n / 2) - 1 : n / 2, value);
  }
});

test('signed i64 JSON scalar numbers are not rounded through Number', () => {
  const low = -(1n << 63n), high = (1n << 63n) - 1n;
  for (const { raw, admit } of contract.reference.json.signed_integer_scalars) {
    const lexical = /^-?(?:0|[1-9][0-9]*)$/.test(raw);
    const actual = lexical && BigInt(raw) >= low && BigInt(raw) <= high;
    assert.equal(actual, admit, JSON.stringify(raw));
  }
});

test('metrics bucket boundaries are inclusive and rejected samples not counted', () => {
  const h = contract.reference.metrics.histogram;
  const counts = new Array(h.inclusive_bounds.length + 1).fill(0);
  let count = 0, rejected = 0, sum = 0;
  for (const n of h.observations) {
    if (n < 0 || count === 2147483647 || n > 2147483647 - sum) {
      rejected++;
      continue;
    }
    const bucket = h.inclusive_bounds.findIndex(upper => n <= upper);
    counts[bucket < 0 ? counts.length - 1 : bucket]++;
    count++; sum += n;
  }
  assert.deepEqual({ count, rejected, sum, counts }, {
    count: h.accepted, rejected: h.rejected, sum: h.sum, counts: h.bucket_counts
  });
});

test('queued, fake, skipped, cross-target and zero-step PASS receipts fail closed', () => {
  const valid = {
    status:'PASS',backend:'llvm',execution_kind:'REAL_COMPILED_ATTO_GUEST',
    source_commit_sha:'a'.repeat(40),source_root_tree_sha:'b'.repeat(40),
    compiler_commit_sha:'c'.repeat(40),compiler_root_tree_sha:'d'.repeat(40),
    test_plan_digest_sha256:'a'.repeat(64),test_artifact_sha256:'b'.repeat(64),
    workflow_run_url:'https://github.com/atto-lang/atto-source.llvm/actions/runs/123',
    executed_non_setup_step_count:2,guest_test_count:5,guest_pass_count:5,
    guest_fail_count:0,guest_skip_count:0,target_profile:'native-aot',
    external_verification_required:true
  };
  assert.ok(admit_receipt('llvm',valid), 'shape-compatible candidate');
  for (const poison of [
    {status:'NOT_EXECUTED'},{status:'FAIL'},
    {backend:'java'},{execution_kind:'SOURCE_ONLY'},
    {executed_non_setup_step_count:0},{guest_test_count:0},
    {guest_pass_count:4},{guest_skip_count:1},{guest_fail_count:1},
    {source_commit_sha:'not-a-sha'},{source_root_tree_sha:''},
    {test_plan_digest_sha256:''},{test_artifact_sha256:''},
    {workflow_run_url:'https://example.org/fake'},
    {external_verification_required:false}
  ]) {
    assert.equal(admit_receipt('llvm',{...valid,...poison}),false,JSON.stringify(poison));
  }
});
