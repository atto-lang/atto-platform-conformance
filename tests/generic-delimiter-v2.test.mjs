import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const matrix = JSON.parse(readFileSync(new URL('../contracts/generic-delimiter-v2.json', import.meta.url), 'utf8'));
const repos = ['java','llvm','net','rs','wasm','forge','cranelift','js','atto','hdl','realtime'].map(s => 'atto-source.' + s);
test('all 11 compiler repositories have explicit coverage targets', () => {
  assert.deepEqual(matrix.backends.map(b => b.repo).sort(), repos.sort());
  assert.ok(matrix.backends.every(b => Array.isArray(b.profiles) && b.profiles.length));
  assert.match(matrix.upstream.head, /^[0-9a-f]{40}$/);
  assert.match(matrix.upstream.blob, /^[0-9a-f]{40}$/);
});
test('27 unique cases and 297 explicitly unexecuted backend cells', () => {
  assert.equal(matrix.cases.length, 27);
  assert.equal(new Set(matrix.cases.map(c => c.id)).size, 27);
  for (const c of matrix.cases) {
    assert.equal(typeof c.source, 'string');
    assert.ok(c.source.trim().length);
    assert.deepEqual(Object.keys(c.statusByBackend).sort(), [...repos].sort());
    assert.ok(Object.values(c.statusByBackend).every(s => s === 'NOT_EXECUTED'));
    if (c.expectation === 'reject') assert.equal(c.proof, 'diagnostic_no_artifact');
    else if (c.expectation === 'gate') assert.equal(c.proof, 'capability_gate');
    else if (c.proof === 'compiled_guest') assert.equal(c.expected_exit, 42);
    else assert.equal(c.proof, 'signature_typecheck_only');
  }
  assert.equal(matrix.cases.filter(c => c.expectation === 'accept').length, 9);
  assert.equal(matrix.cases.filter(c => c.expectation === 'reject').length, 17);
  assert.equal(matrix.cases.filter(c => c.expectation === 'gate').length, 1);
});
test('signature-only examples cannot certify collection allocation or runtime behavior', () => {
  assert.equal(matrix.cases.filter(c => c.proof === 'signature_typecheck_only').length, 4);
  assert.equal(matrix.cases.filter(c => c.proof === 'compiled_guest').length, 5);
});
