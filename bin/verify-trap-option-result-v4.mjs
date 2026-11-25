// Integrity gate ONLY: matching fixtures never certify compiler guest behavior.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../fixtures/option-result-trap/v4/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
assert.equal(manifest.format, 'atto.trap-option-result.three-backend.v1');
assert.equal(manifest.status, 'candidate_not_certified');
assert.equal(manifest.fixture.expected_guest_main_result, 7);
assert.deepEqual(manifest.required_backend_proofs,
    ['java-graalvm', 'llvm-native-aot', 'dotnet-native-aot']);
assert.equal(manifest.required_evidence.positive_guest, 'actually_compiled_and_executed');
assert.equal(manifest.required_evidence.unknown_or_skipped, 'not_a_pass');
const cases = [manifest.fixture, ...manifest.additional_cases];
assert.deepEqual(cases.map(c => c.path), [
    'three-backend-boundary.atto',
    'reject-implicit-flattening.atto',
    'reject-missing-trap.atto',
    'panic-bypasses-trap.atto'
], 'manifest paths must match the reviewed static allowlist');
assert.deepEqual(manifest.additional_cases.map(c => c.required_proof), [
    'typed_mismatch_not_unsupported_syntax',
    'typed_mismatch_not_unsupported_syntax',
    'uncaught_language_panic_no_guest_result'
]);
for (const item of cases) {
    const bytes = await readFile(new URL(item.path, root));
    const blob = createHash('sha1')
        .update(Buffer.from('blob ' + bytes.length + String.fromCharCode(0)))
        .update(bytes).digest('hex');
    assert.equal(blob, item.git_blob_sha1, 'fixture drift: ' + item.path);
}
console.log('ORT_V4_FOUR_FIXTURE_GIT_BLOB_INTEGRITY_PASS (NOT backend parity)');
