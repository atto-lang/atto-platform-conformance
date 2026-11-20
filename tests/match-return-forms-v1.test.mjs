// Source-integrity and unexecuted-status gate only. NOT compiled guest evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'contracts/match-return-forms-v1.json'), 'utf8'));
const expectedBackends = [
  'atto-source.rs', 'atto-source.wasm', 'atto-source.java',
  'atto-source.llvm', 'atto-source.net', 'atto-source.forge',
  'atto-source.cranelift', 'atto-source.js', 'atto-source.atto',
  'atto-source.hdl', 'atto-source.realtime',
];

function blobSha(bytes) {
  return createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + '\0'))
    .update(bytes)
    .digest('hex');
}

test('match-return fixtures are immutable, complete and byte-pinned', () => {
  assert.equal(manifest.schema, 'attolang.match-return-forms.v1');
  assert.equal(manifest.status, 'CANDIDATE_NOT_CROSS_BACKEND_CERTIFIED');
  assert.deepEqual(manifest.cases.map(c => c.id), [
    'return-block', 'caret-block', 'nonexhaustive-guard', 'fallthrough-block'
  ]);
  assert.equal(new Set(manifest.cases.map(c => c.path)).size, manifest.cases.length);
  const sources = new Map();
  for (const item of manifest.cases) {
    assert.match(item.git_blob_sha1, /^[0-9a-f]{40}$/);
    assert.match(item.path, /^fixtures\/match-return-forms-v1\/(pass|fail)\/[a-z-]+\.atto$/);
    const abs = resolve(root, item.path);
    assert.ok(abs.startsWith(root + sep), 'source outside repository');
    const bytes = readFileSync(abs);
    assert.equal(blobSha(bytes), item.git_blob_sha1, item.id + ': source Git blob mismatch');
    const src = bytes.toString('utf8');
    sources.set(item.id, src);
    if (item.expect.kind === 'guest') {
      assert.equal(item.expect.exit, 0);
      assert.equal(item.expect.stdout, '2\n2\n');
      assert.match(src, /\/\/ expect-exit: 0/);
      assert.equal((src.match(/\/\/ expect-stdout: 2/g) || []).length, 2);
      assert.match(src, /on n when n > 1/);
      assert.match(src, /on _ ->/);
      assert.match(src, /on 0 ->/);
      assert.match(src, /on 1 ->/);
      assert.match(src, /stdio\.println\(classify\(7\)\)/);
      assert.match(src, /stdio\.println\(xyx\(7\)\)/);
    } else {
      assert.equal(item.expect.kind, 'diagnostic');
      assert.ok(item.expect.no_guest);
      assert.ok(src.includes('// expect-error: ' + item.expect.code));
    }
  }
  assert.match(sources.get('return-block'), /return match value over/);
  assert.match(sources.get('caret-block'), /\^ match value over/);
  for (const id of ['return-block', 'caret-block']) {
    const src = sources.get(id);
    assert.match(src, /on 0 -> \{ return 0; \}/);
    assert.match(src, /on n when n > 1 -> 2,/);
  }
  assert.match(sources.get('fallthrough-block'), /on 0 -> \{ val seen = 0; \}/);
});

test('unproven compiler parity is never marked passed by host fixture checks', () => {
  assert.deepEqual(Object.keys(manifest.backends), expectedBackends);
  assert.match(manifest.source.head_at_fixture_import, /^[a-f0-9]{40}$/);
  assert.equal(manifest.source.verification, 'NOT_EXECUTED_ON_THIS_HEAD');
  for (const [backend, result] of Object.entries(manifest.backends)) {
    assert.equal(result.status, 'NOT_EXECUTED', backend);
    assert.equal(result.source_sha, null, backend);
    assert.equal(result.guest_receipt, null, backend);
  }
  assert.match(manifest.backends['atto-source.wasm'].compiler_implementation, /^adapter/);
  assert.match(manifest.backends['atto-source.realtime'].compiler_implementation, /^runtime-only/);
});

test('executed Rust/Wasm LLVM-repository frontend evidence is segregated from native AOT', () => {
  const profile = manifest.source.candidate_llvm_frontend;
  assert.equal(profile.profile,
    'frontend Rust/Wasm compiler (NOT the native C++ LLVM AOT compiler)');
  assert.equal(profile.status, 'PASS_FRONTEND_SUBPROFILE');
  assert.match(profile.head, /^[0-9a-f]{40}$/);
  assert.match(profile.frontend_tree_sha, /^[0-9a-f]{40}$/);
  assert.equal(profile.mirrored_blobs_verified, 27);
  assert.equal(profile.carrier.conclusion, 'SUCCESS');
  assert.ok(profile.carrier.run_id > 0 && profile.carrier.linux_job_id > 0);
  assert.deepEqual(profile.portable_cases.map(c => c.id),
    manifest.cases.map(c => c.id));
  for (const [i, entry] of profile.portable_cases.entries()) {
    const oracle = manifest.cases[i].expect;
    if (oracle.kind === 'guest') {
      assert.equal(entry.status, 'PASS_EXECUTED_GUEST');
      assert.equal(entry.stdout, oracle.stdout);
      assert.equal(entry.exit, oracle.exit);
    } else {
      assert.equal(entry.status, 'PASS_REJECTED_NO_ARTIFACT');
      assert.equal(entry.diagnostic, oracle.code);
      assert.equal(entry.no_guest, true);
    }
  }
  assert.equal(profile.additional_adt_guards.passed, 4);
  assert.equal(profile.native_vs_wasm_compiler_guest_bytes, 'IDENTICAL');
  assert.equal(profile.native_cpp_llvm_aot, 'NOT_EXECUTED');
  // Compiler-family parity is NOT a frontend-only result.
  assert.equal(manifest.backends['atto-source.llvm'].status, 'NOT_EXECUTED');
});

test('scoped Rust compiler guest receipt cannot certify the full source repository', () => {
  const candidate = manifest.source.candidate_main_based;
  assert.equal(candidate.guest_verification,
    'PASS_SCOPED_COMPILER_SOURCE_GUEST_NOT_FULL_REPOSITORY_CI');
  const proof = candidate.scoped_carrier_ci;
  assert.equal(proof.conclusion, 'SUCCESS');
  assert.match(proof.source_head, /^[0-9a-f]{40}$/);
  assert.match(proof.compiler_src_tree, /^[0-9a-f]{40}$/);
  assert.equal(proof.rust_library_tests.passed, 50);
  assert.equal(proof.rust_library_tests.failed, 0);
  assert.equal(proof.compiled_guest_cases.passed, 8);
  assert.equal(proof.compiled_guest_cases.failed, 0);
  assert.equal(proof.compiled_guest_cases.expected_stdout, '2\n2\n');
  assert.equal(proof.compiled_guest_cases.expected_main_exit, 0);
  assert.deepEqual(proof.compiled_guest_cases.negative_codes, ['E_MATCH', 'E_RETURN']);
  assert.equal(proof.compiled_guest_cases.no_guest_on_failure, true);
  assert.equal(proof.native_vs_wasm_compiler_guest_bytes, 'IDENTICAL');
  assert.equal(proof.full_repository_ci, 'NOT_EXECUTED');
  assert.equal(manifest.backends['atto-source.rs'].status, 'NOT_EXECUTED');
});

test('direct-CIL real guest results remain scoped below full original-fixture parity', () => {
  const net = manifest.source.candidate_net_direct_cil;
  assert.equal(net.pr, 26);
  assert.equal(net.guest_scalar_variants.status,
    'PASS_COMPILED_CORECLR_AND_NATIVEAOT_EXACT_HEAD');
  assert.deepEqual(net.guest_scalar_variants.executed_guest_cases.map(c => c.id),
    ['scalar-return', 'scalar-caret']);
  for (const result of net.guest_scalar_variants.executed_guest_cases) {
    assert.equal(result.coreclr_exit, 4);
    assert.equal(result.nativeaot_exit, 4);
    assert.equal(result.verified, true);
  }
  assert.deepEqual(net.canonical_negative_cases.map(c => [c.diagnostic, c.status]),
    [['E_MATCH', 'PASS_REJECTED_NO_ARTIFACT'],
     ['E_RETURN', 'PASS_REJECTED_NO_ARTIFACT']]);
  assert.equal(net.additional_negative_cases.passed, 7);
  assert.equal(net.additional_negative_cases.failed, 0);
  assert.equal(net.additional_negative_cases.no_artifact, true);
  assert.equal(net.private_carrier.source_head, net.head);
  assert.match(net.private_carrier.source_tree_sha, /^[0-9a-f]{40}$/);
  assert.equal(net.private_carrier.source_blobs_verified, 38);
  assert.equal(net.private_carrier.full_tree_sha_verified, true);
  assert.equal(net.private_carrier.conclusion, 'SUCCESS');
  assert.equal(net.private_carrier.run_id, 44660814076);
  assert.ok(net.private_carrier.linux_job_id > 0);
  assert.match(net.private_carrier.artifact_sha256, /^[0-9a-f]{64}$/);
  assert.equal(net.exact_user_printing_programs.status, 'UNSUPPORTED');
  assert.equal(net.exact_user_printing_programs.observed_rejection.return_fixture, 'E_LEX');
  assert.equal(net.exact_user_printing_programs.observed_rejection.caret_fixture, 'E_LEX');
  // Scalar adaptations do not provide the required stdout 2\\n2\\n.
  assert.equal(manifest.backends['atto-source.net'].status, 'NOT_EXECUTED');
});
