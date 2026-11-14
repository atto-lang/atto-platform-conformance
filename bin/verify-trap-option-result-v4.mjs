// Integrity gate ONLY: a hash match is not compiler, guest, or parity evidence.
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

// File name comes only from the reviewed and versioned fixed manifest.
assert.equal(manifest.fixture.path, 'three-backend-boundary.atto');
const bytes = await readFile(new URL(manifest.fixture.path, root));
const gitBlob = createHash('sha1')
  .update(Buffer.from('blob ' + bytes.length + String.fromCharCode(0)))
  .update(bytes).digest('hex');
assert.equal(gitBlob, manifest.fixture.git_blob_sha1,
  'canonical .atto guest bytes changed without manifest review');
assert.equal(gitBlob, '51b9c735af6b841921469698dd0da7aff37d2b79');
console.log('ORT_V4_FIXTURE_INTEGRITY_PASS: ' + gitBlob +
  ' (does NOT certify any compiler backend)');
