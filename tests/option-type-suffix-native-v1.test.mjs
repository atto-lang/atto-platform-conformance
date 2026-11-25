import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const manifest = JSON.parse(readFileSync(new URL('../contracts/option-type-suffix-native-v1.json', import.meta.url), 'utf8'));
const blobHash = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const requiredBackends = ['java-graalvm','llvm-cpp-native','llvm-rust-native','net','wasm','rs','forge','js','cranelift'];

test('T? corpus is versioned, scoped and not falsely certified', () => {
  assert.equal(manifest.schema, 'atto.option-type-suffix.native-scalar.v1');
  assert.equal(manifest.status, 'AUTHORED_ONLY_NOT_EXECUTED');
  assert.equal(manifest.cases.length, 10);
  assert.deepEqual(Object.keys(manifest.backend_results), requiredBackends);
  for (const result of Object.values(manifest.backend_results)) {
    assert.equal(result, 'NOT_EXECUTED');
  }
  assert.ok(manifest.required_evidence.some(text => text.includes('nonzero')));
  assert.ok(manifest.references.some(text => text.endsWith('/atto-source.llvm/pull/76')));
});

test('all ten exact .atto source Git blob identities match the manifest', () => {
  const names = new Set();
  const kinds = {positive:0, invalid_source:0, native_unsupported:0};
  for (const entry of manifest.cases) {
    assert.match(entry.id, /^(positive|reject)-[a-z]+(?:-[a-z]+)*$/);
    assert.ok(!names.has(entry.id), 'duplicate fixture ID: ' + entry.id);
    names.add(entry.id);
    assert.equal(entry.source, 'fixtures/option-type-suffix-v1/' + entry.id + '.atto');
    assert.match(entry.git_blob_sha1, /^[0-9a-f]{40}$/);
    const source = readFileSync(new URL('../' + entry.source, import.meta.url));
    assert.equal(blobHash(source), entry.git_blob_sha1, 'Git blob changed: ' + entry.id);
    const text = source.toString('utf8');
    assert.match(text, /\bfnc main\(/, 'fixture must be a standalone source program');
    assert.doesNotMatch(text, /\b(?:import java|import dotnet|unsafe host)\b/);
    assert.ok(source.length < 2048, 'fixture exceeds minimal native ABI bound');
    assert.ok(Object.hasOwn(kinds, entry.kind), entry.kind);
    kinds[entry.kind]++;
    assert.equal(entry.expected_native_compiler, entry.kind === 'positive' ? 'accept' : 'reject_no_ir');
    if (entry.kind === 'positive') {
      assert.equal(entry.expected_exit, 42);
      assert.equal(entry.expected_guest_stdout, '');
    } else {
      assert.equal(entry.expected_exit, null);
    }
  }
  assert.deepEqual(kinds, {positive:3, invalid_source:4, native_unsupported:3});
});

test('type suffix and omittable formal remain distinct', () => {
  const byId = Object.fromEntries(manifest.cases.map(x => [x.id,x]));
  const some = readFileSync(new URL('../' + byId['positive-some'].source, import.meta.url), 'utf8');
  const explicit = readFileSync(new URL('../' + byId['positive-explicit'].source, import.meta.url), 'utf8');
  const omitted = readFileSync(new URL('../' + byId['reject-omittable-formal'].source, import.meta.url), 'utf8');
  assert.match(some, /val int\? value = Some\(42\)/);
  assert.match(explicit, /val Option<int> value = Some\(42\)/);
  assert.match(omitted, /int value\?/);
  assert.doesNotMatch(omitted, /int\? value/);
  assert.equal(byId['reject-omittable-formal'].kind, 'invalid_source');
  assert.equal(byId['reject-nested'].kind, 'native_unsupported');
});
