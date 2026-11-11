// Source-free integrity/provenance gate. This module does NOT compile AttoLang.
// Require independent verification of GitHub Actions logs/artifacts before a receipt
// is treated as external evidence. Never treat a declaration as a guest pass.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const LANES = Object.freeze([
  'java-interpreter', 'java-native-image', 'llvm-native',
  'wasm32', 'forge-native', 'net-native-aot',
]);

export const BACKENDS = Object.freeze([
  'java', 'llvm', 'wasm', 'forge', 'net',
]);

const sha40 = /^[0-9a-f]{40}$/;
const sha64 = /^[0-9a-f]{64}$/;
const nonblank = (x) => typeof x === 'string' && x.trim().length > 0;

export function gitBlobSha(text) {
  assert.equal(typeof text, 'string', 'raw contract must be text');
  const bytes = Buffer.from(text, 'utf8');
  return createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + '\0'))
    .update(bytes).digest('hex');
}

export function sourceSha256(source) {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export function validateContract(contract, matrix, rawText) {
  assert.equal(contract?.schema, 'attolang.value-block-range.v0');
  assert.equal(contract?.status, 'PROPOSED_NOT_COMPILER_VERIFIED');
  assert.equal(matrix?.schema, 'attolang.value-block-range.parity.v0');
  assert.equal(matrix?.status, 'GAPS_AUDITED_NOT_PARITY_VERIFIED');
  assert.equal(matrix?.source_contract?.git_blob_sha, gitBlobSha(rawText),
    'contract bytes changed without updating pinned source blob SHA');
  assert.deepEqual(matrix?.required_guest_lanes, LANES);
  assert.equal(contract?.requires_compiled_guest_for_pass, true);
  assert.deepEqual(contract?.verification?.backend_matrix, [
    'java-interpreter', 'java-native-image', 'llvm', 'net-native-aot',
    'wasm', 'forge',
  ]);
  assert.ok(Array.isArray(contract?.cases) && contract.cases.length >= 17);
  const validKinds = new Set([
    'accept_execute', 'accept_typecheck', 'reject_typecheck',
    'reject_parse', 'accept_lex',
  ]);
  const seen = new Set();
  for (const testCase of contract.cases) {
    assert.ok(nonblank(testCase.id) && /^[a-z0-9_-]+$/.test(testCase.id));
    assert.ok(!seen.has(testCase.id), 'duplicate test case: ' + testCase.id);
    seen.add(testCase.id);
    assert.ok(validKinds.has(testCase.kind), 'unknown kind: ' + testCase.kind);
    assert.ok(nonblank(testCase.source), 'empty case source: ' + testCase.id);
    assert.ok(testCase.expect && typeof testCase.expect === 'object');
    if (testCase.kind === 'accept_execute') {
      assert.ok(Number.isSafeInteger(testCase.expect.exit_code) &&
        testCase.expect.exit_code >= 0 && testCase.expect.exit_code < 256,
        'guest exit must be an exit status 0..255');
    }
    if (testCase.kind.startsWith('reject_')) {
      assert.ok(nonblank(testCase.expect.diagnostic),
        'rejection requires expected diagnostic class');
    }
  }
  assert.equal(seen.size, contract.cases.length);
  const byId = new Map(contract.cases.map(x => [x.id, x]));
  for (const required of [
    'block_tail_returns_value', 'ternary_block_true',
    'ternary_block_false', 'nested_right_associative',
    'range_exclusive_count', 'range_inclusive_count',
    'inclusive_max_endpoint', 'block_semicolon_discards_tail',
    'non_bool_ternary', 'block_local_reference_escape',
  ]) assert.ok(byId.has(required), 'missing critical vector: ' + required);

  assert.ok(Array.isArray(matrix.backend_audit) &&
    matrix.backend_audit.length === BACKENDS.length);
  assert.deepEqual(matrix.backend_audit.map(x => x.backend), BACKENDS);
  for (const b of matrix.backend_audit) {
    assert.equal(b.repo, 'ores-truffle-oreslang/oreslang-source.' + b.backend);
    assert.match(b.main_sha, sha40);
    assert.ok(nonblank(b.observed));
    assert.ok(Array.isArray(b.gaps) && b.gaps.length > 0);
    assert.ok(!('verified_guest' in b) && !('pass' in b),
      'baseline inventory cannot assert guest execution');
  }
  assert.deepEqual(matrix.verified_guest_receipts, [],
    'do not insert unverifiable receipt references into source-free inventory');
  return {cases: seen.size, backends: BACKENDS.length, lanes: LANES.length,
    contractBlob: gitBlobSha(rawText), evidence_class: 'SOURCE_FREE_CONTRACT_ONLY'};
}

export function validateReceiptShape(receipt, contract, matrix) {
  // A well-formed receipt is still only a CLAIM until cross-checked against
  // immutable GitHub run/job metadata, linked actual artifact and exact blobs.
  assert.equal(receipt?.schema, 'attolang.value-block-range.guest-receipt.v0');
  assert.equal(receipt?.evidence_class, 'COMPILED_ATTO_GUEST');
  assert.equal(receipt?.contract_blob_sha, matrix.source_contract.git_blob_sha);
  assert.ok(LANES.includes(receipt.lane), 'unknown target lane');
  const backend = receipt.lane.startsWith('java') ? 'java'
    : receipt.lane.startsWith('llvm') ? 'llvm'
    : receipt.lane.startsWith('forge') ? 'forge'
    : receipt.lane.startsWith('net') ? 'net' : 'wasm';
  assert.equal(receipt.backend, backend, 'lane/backend mismatch');
  const audit = matrix.backend_audit.find(x => x.backend === backend);
  assert.match(receipt.compiler_head_sha, sha40);
  assert.match(receipt.compiler_tree_sha, sha40);
  assert.equal(receipt.compiler_head_sha, audit.main_sha,
    'receipt compiler SHA differs from audited SHA: refresh audit first');
  assert.ok(nonblank(receipt.runner_repository) &&
    nonblank(receipt.run_url) && Number.isSafeInteger(receipt.run_id) &&
    receipt.run_id > 0 && Number.isSafeInteger(receipt.job_id) &&
    receipt.job_id > 0);
  assert.ok(Array.isArray(receipt.completed_steps) &&
    receipt.completed_steps.includes('compiler') &&
    receipt.completed_steps.includes('artifact') &&
    receipt.completed_steps.includes('guest-execute'),
    'source-only or skipped job cannot be guest evidence');
  assert.match(receipt.compiler_binary_sha256, sha64);
  assert.ok(Array.isArray(receipt.cases) &&
    receipt.cases.length === contract.cases.length,
    'incomplete case matrix must not pass');
  const seen = new Set();
  const expected = new Map(contract.cases.map(x => [x.id, x]));
  for (const outcome of receipt.cases) {
    assert.ok(!seen.has(outcome.id), 'duplicate outcome');
    seen.add(outcome.id);
    const spec = expected.get(outcome.id);
    assert.ok(spec, 'unknown case');
    assert.equal(outcome.source_sha256, sourceSha256(spec.source),
      'case source differs from canonical fixture');
    assert.equal(outcome.status, 'pass',
      'blocked/skip/host-only/unverified cases are never passes');
    if (spec.kind === 'accept_execute') {
      assert.equal(outcome.phase, 'guest-execute');
      assert.equal(outcome.compile_exit, 0);
      assert.equal(outcome.guest_exit, spec.expect.exit_code);
      assert.match(outcome.artifact_sha256, sha64);
      assert.equal(outcome.executed_guest, true);
    } else if (spec.kind.startsWith('reject_')) {
      assert.equal(outcome.phase, 'compiler-reject');
      assert.ok(Number.isInteger(outcome.compile_exit) && outcome.compile_exit !== 0);
      assert.equal(outcome.diagnostic_class, spec.expect.diagnostic);
      assert.equal(outcome.artifact_published, false);
    } else if (spec.kind === 'accept_typecheck') {
      assert.equal(outcome.phase, 'typecheck');
      assert.equal(outcome.compile_exit, 0);
    } else if (spec.kind === 'accept_lex') {
      assert.equal(outcome.phase, 'lex');
      assert.equal(outcome.lex_pass, true);
    }
  }
  assert.equal(seen.size, expected.size);
  return {claim_status:'RECEIPT_SHAPE_VALID_EXTERNAL_VERIFICATION_REQUIRED',
    lane:receipt.lane,case_count:seen.size};
}
