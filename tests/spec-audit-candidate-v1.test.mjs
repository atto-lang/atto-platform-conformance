// Structural inventory self-tests only. Never emit a compiler-pass receipt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'fixtures/spec-audit-v1/manifest.json'), 'utf8'));
const backends = ['java', 'llvm', 'net', 'wasm', 'forge'];
const pending = new Set(['S-42','S-46','S-54','S-55','S-56']);

function gitBlobSha1(source) {
  const bytes = Buffer.from(source, 'utf8');
  return createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
}

const requiredCases = ["guard-scalar-positive","guard-missing-exit-negative","guard-else-negative","named-value-reorder-positive","named-value-duplicate-negative","actorref-sync-method-negative","typed-local-typefirst","typed-local-namecolon","statement-linebreak","operator-eq","operator-double-equals","infix-pipeline","nested-pipeline","pipeline-double-start","graph-drop-lifetime"];

function validate(data, sourceOverrides = {}) {
  assert.equal(data.schema, 'atto.spec-audit-candidates/1');
  const ids = new Set();
  for (const c of data.cases) {
    assert.ok(!ids.has(c.id), 'duplicate fixture ID: ' + c.id);
    ids.add(c.id);
    assert.match(c.source, /^fixtures\/[a-z0-9-]+\/[a-z0-9-]+\.atto$/);
    const source = Object.hasOwn(sourceOverrides, c.source)
      ? sourceOverrides[c.source] : readFileSync(resolve(root, c.source), 'utf8');
    assert.ok(source.trim().length > 25, 'empty candidate: ' + c.id);
    assert.match(c.source_git_blob_sha1, /^[a-f0-9]{40}$/);
    assert.equal(gitBlobSha1(source), c.source_git_blob_sha1, 'fixture blob drift: ' + c.id);
    assert.ok(['positive', 'negative', 'decision-candidate'].includes(c.kind));
    assert.ok(['TARGET', 'PROPOSED', 'UNRESOLVED'].includes(c.maturity));
    assert.deepEqual(Object.keys(c.backends).sort(), [...backends].sort());
    assert.ok(backends.every(b => c.backends[b] === 'NOT_EXECUTED'), 'false backend pass claim');
    if (c.kind === 'positive') {
      assert.match(c.expected_guest_i64, /^-?[0-9]+$/, 'missing typed guest oracle for ' + c.id);
    } else {
      assert.equal(c.expected_guest_i64 ?? null, null);
    }
    if (c.kind === 'negative') {
      assert.match(c.expected_diagnostic_class, /^[A-Z][A-Z0-9_]+$/);
      assert.match(c.control_source, /^fixtures\/[a-z0-9-]+\/[a-z0-9-]+\.atto$/);
      const control = Object.hasOwn(sourceOverrides, c.control_source)
        ? sourceOverrides[c.control_source] : readFileSync(resolve(root, c.control_source), 'utf8');
      assert.match(c.control_git_blob_sha1, /^[a-f0-9]{40}$/);
      assert.equal(gitBlobSha1(control), c.control_git_blob_sha1, 'control source drift: ' + c.id);
      assert.notEqual(c.source, c.control_source, 'negative must have separate control');
    } else {
      assert.equal(c.expected_diagnostic_class, null);
    }
    if (c.id === 'pipeline-double-start') {
      assert.equal(c.kind, 'decision-candidate', 'placeholder stage types are not a valid negative proof');
      assert.equal(c.target_diagnostic_class, 'MOVED_BUILDER_REUSED');
    }
    if (pending.has(c.decision)) {
      assert.equal(c.kind, 'decision-candidate', 'unratified language decision promoted: ' + c.id);
    }
  }
  assert.deepEqual([...ids].sort(), [...requiredCases].sort(), 'fixture coverage drift');
  for (const id of pending) {
    assert.ok(data.cases.some(c => c.decision === id), 'missing decision coverage: ' + id);
  }
}

test('spec-audit inventory is source-free and has five-backend NOT_EXECUTED states', () => {
  validate(manifest);
});
test('mutation: forged guest pass is rejected', () => {
  const copy = structuredClone(manifest);
  copy.cases[0].backends.java = 'GUEST_EXECUTED';
  assert.throws(() => validate(copy), /false backend pass claim/);
});
test('mutation: duplicate fixture ID is rejected', () => {
  const copy = structuredClone(manifest);
  copy.cases[1].id = copy.cases[0].id;
  assert.throws(() => validate(copy), /duplicate fixture ID/);
});
test('mutation: missing negative diagnostic class is rejected', () => {
  const copy = structuredClone(manifest);
  const target = copy.cases.find(c => c.kind === 'negative');
  target.expected_diagnostic_class = null;
  assert.throws(() => validate(copy));
});
test('mutation: UNRESOLVED proposal promoted to positive is rejected', () => {
  const copy = structuredClone(manifest);
  copy.cases.find(c => c.decision === 'S-42').kind = 'positive';
  assert.throws(() => validate(copy), /unratified language decision promoted/);
});

test('mutation: changed fixture bytes fail Git blob identity', () => {
  const c = manifest.cases[0];
  const original = readFileSync(resolve(root, c.source), 'utf8');
  assert.throws(() => validate(manifest, { [c.source]: original + '\n// tampered' }), /fixture blob drift/);
});
test('mutation: changed negative control bytes fail Git blob identity', () => {
  const c = manifest.cases.find(c => c.id === 'actorref-sync-method-negative');
  const original = readFileSync(resolve(root, c.control_source), 'utf8');
  assert.throws(() => validate(manifest, { [c.control_source]: original + '\n// tampered' }), /control source drift/);
});
test('mutation: required candidate removal fails coverage', () => {
  const clone = structuredClone(manifest);
  clone.cases.pop();
  assert.throws(() => validate(clone), /fixture coverage drift/);
});
test('mutation: negative without paired control is rejected', () => {
  const clone = structuredClone(manifest);
  clone.cases.find(c => c.kind === 'negative').control_source = null;
  assert.throws(() => validate(clone));
});
test('mutation: unresolved placeholder cannot become compiler negative', () => {
  const clone = structuredClone(manifest);
  const c = clone.cases.find(c => c.id === 'pipeline-double-start');
  c.kind = 'negative';
  c.expected_diagnostic_class = c.target_diagnostic_class;
  assert.throws(() => validate(clone), /placeholder stage types/);
});
