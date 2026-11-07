// Structural inventory self-tests only. Never emit a compiler-pass receipt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'fixtures/spec-audit-v1/manifest.json'), 'utf8'));
const backends = ['java', 'llvm', 'net', 'wasm', 'forge'];
const pending = new Set(['S-42','S-46','S-54','S-55','S-56']);

function validate(data) {
  assert.equal(data.schema, 'atto.spec-audit-candidates/1');
  assert.ok(data.cases.length >= 15);
  const ids = new Set();
  for (const c of data.cases) {
    assert.ok(!ids.has(c.id), 'duplicate fixture ID: '+c.id);
    ids.add(c.id);
    assert.match(c.source, /^fixtures\/[a-z0-9-]+\/[a-z0-9-]+\.atto$/);
    const source = readFileSync(resolve(root, c.source), 'utf8');
    assert.ok(source.trim().length > 25, 'empty candidate: '+c.id);
    assert.ok(['positive', 'negative', 'decision-candidate'].includes(c.kind));
    assert.ok(['TARGET', 'PROPOSED', 'UNRESOLVED'].includes(c.maturity));
    assert.deepEqual(Object.keys(c.backends).sort(), [...backends].sort());
    assert.ok(backends.every(b => c.backends[b] === 'NOT_EXECUTED'), 'false backend pass claim');
    if (c.kind === 'negative') {
      assert.match(c.expected_diagnostic_class, /^[A-Z][A-Z0-9_]+$/);
    } else {
      assert.equal(c.expected_diagnostic_class, null);
    }
    if (pending.has(c.decision)) {
      assert.equal(c.kind, 'decision-candidate', 'unratified language decision promoted: '+c.id);
    }
  }
  for (const id of pending) {
    assert.ok(data.cases.some(c => c.decision === id), 'missing decision coverage: '+id);
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
