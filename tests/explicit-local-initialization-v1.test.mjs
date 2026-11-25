import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const registry = JSON.parse(readFileSync(new URL('contracts/explicit-local-initialization-v1.json', root), 'utf8'));
const backends = ['rust_browser_wasm', 'java', 'llvm', 'net', 'forge', 'independent_wasm'];
const states = new Set(['passed', 'failed', 'unsupported', 'not_executed']);
const read = path => readFileSync(new URL(path, root), 'utf8');
const gitBlobSha = source => createHash('sha1')
  .update(Buffer.from('blob ' + Buffer.byteLength(source, 'utf8') + '\0' + source, 'utf8'))
  .digest('hex');

test('explicit local initialization registry is versioned and fail-closed', () => {
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.contract, 'atto-explicit-local-initialization-v1');
  assert.equal(registry.aggregate_status, 'not_executed');
  assert.equal(registry.allowed_verification_statuses.includes('not_executed'), true);
  assert.deepEqual(registry.required_backends, backends);
  assert.equal(registry.cases.length, 5);
  assert.ok(backends.every(name => registry.backend_status[name] === 'not_executed'));
});

test('every case is pinned to an exact source blob and has all backend evidence cells', () => {
  assert.equal(new Set(registry.cases.map(c => c.id)).size, registry.cases.length);
  for (const c of registry.cases) {
    assert.match(c.id, /^[a-z0-9-]+$/);
    assert.ok(['accept', 'reject'].includes(c.expect));
    assert.ok(c.reason.length > 10);
    assert.match(c.source_blob_sha, /^[a-f0-9]{40}$/);
    const source = read(c.path);
    assert.ok(source.endsWith('\n'));
    assert.equal(gitBlobSha(source), c.source_blob_sha, 'source blob mismatch: ' + c.id);
    assert.equal(c.status, 'not_executed');
    for (const backend of backends) {
      assert.ok(states.has(c.evidence[backend]), c.id + ' missing ' + backend);
      assert.equal(c.evidence[backend], 'not_executed');
    }
    if (c.expect === 'accept') {
      assert.equal(c.expected_exit, 42);
      assert.equal(c.expected_diagnostic_category, undefined);
    } else {
      assert.equal(c.expected_exit, undefined);
      assert.equal(c.expected_diagnostic_category, 'missing_initializer');
    }
  }
});

test('explicit values and runtime initialization remain valid target cases', () => {
  const scalar = registry.cases.find(c => c.id === 'explicit-scalar-values');
  const scalarSource = read(scalar.path);
  assert.match(scalarSource, /int zero = 0;/);
  assert.match(scalarSource, /bool disabled = false;/);
  assert.match(scalarSource, /string empty = "";/);
  const runtime = registry.cases.find(c => c.id === 'explicit-runtime-value');
  assert.match(read(runtime.path), /let int value = answer\(\);/);
});

test('uninitialized let, val and type-first locals reject even when assigned later', () => {
  for (const id of ['uninitialized-let', 'uninitialized-val', 'uninitialized-type-first']) {
    const c = registry.cases.find(item => item.id === id);
    assert.equal(c.expect, 'reject');
    assert.equal(c.expected_diagnostic_category, 'missing_initializer');
    assert.match(read(c.path), /value;|name;/);
  }
});

test('this registry does not duplicate existing class/aggregate initialization suites', () => {
  assert.ok(registry.related_contracts.some(url => url.includes('class-field-binding-defaults-v2.json')));
  assert.ok(registry.related_contracts.some(url => url.includes('constructor-definite-final-admission-v2.json')));
  assert.ok(registry.related_contracts.some(url => url.includes('tuple-destructuring-v1.json')));
  assert.match(registry.normative_spec, /atto-spec/);
});
