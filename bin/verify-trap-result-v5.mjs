import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../fixtures/option-result-trap/v5/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
assert.equal(manifest.format, 'atto.trap-result.three-backend.v5');
assert.deepEqual(manifest.required_backend_proofs,
    ['java-native-image', 'llvm-native-aot', 'dotnet-native-aot']);
const expected = {
    'preserve-result.atto': { result: 7 },
    'catch-guest-error.atto': { result: 7 },
    'reject-retired-option-wrapper.atto': { diagnostic: 'result_option_type_mismatch' },
    'reject-unmarked-throw.atto': { diagnostic: 'throw_requires_throwable' },
    'panic-bypasses-trap.atto': { runtime_failure: 'uncaught_guest_panic' },
};
assert.deepEqual(manifest.cases.map(item => item.path), Object.keys(expected));
for (const item of manifest.cases) {
    assert.deepEqual(item.expected, expected[item.path], item.path);
    const bytes = await readFile(new URL(item.path, root));
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(blob, item.git_blob_sha1, `fixture drift in ${item.path}`);
}
console.log('RESULT_TRAP_V5_FIVE_FIXTURE_BLOBS_VERIFIED');
