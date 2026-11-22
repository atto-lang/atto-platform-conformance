// HOST-ONLY integrity test for the target registry; NOT a compiler or guest run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const doc = JSON.parse(readFileSync(new URL('../contracts/constant-imports-v1.json', import.meta.url), 'utf8'));

test('typed constant import contract is explicit and not falsely certified', () => {
  assert.equal(doc.schema, 'atto.constant-imports.v1');
  assert.equal(doc.status, 'TARGET_NOT_EXECUTED');
  assert.ok(doc.spec_path.endsWith('constant-imports-v1.md'));
  assert.ok(doc.cases.length >= 14);
  assert.ok(Object.values(doc.backend_status).length >= 6);
  assert.ok(Object.values(doc.backend_status).every(status => status === 'NOT_EXECUTED'));
});

test('each case has real multiple-source text or isolated negative, and a unique expected outcome', () => {
  const names = new Set();
  let successes = 0;
  let negatives = 0;
  for (const c of doc.cases) {
    assert.match(c.id, /^[a-z][a-z0-9_]+$/);
    assert.ok(!names.has(c.id), 'duplicate case: ' + c.id);
    names.add(c.id);
    assert.equal(c.entry, 'app.atto');
    assert.ok(c.files[c.entry]?.includes('main'), c.id);
    for (const [p, src] of Object.entries(c.files)) {
      assert.ok(!p.startsWith('/') && !p.includes('..'), c.id + ': escaped source path');
      assert.ok(p.endsWith('.atto') && src.length > 0);
      assert.ok(src.length < 65536, 'fixture exceeds compiler size cap');
    }
    if (c.kind === 'pass') {
      successes++;
      assert.ok(Number.isInteger(c.expected_return), c.id);
      assert.equal(c.expected_error, undefined, c.id);
    } else {
      negatives++;
      assert.equal(c.kind, 'fail', c.id);
      assert.match(c.expected_error, /^E_[A-Z_]+$/, c.id);
      assert.equal(c.expected_return, undefined, c.id);
    }
  }
  assert.ok(successes >= 4);
  assert.ok(negatives >= 10);
});

test('selection, visibility, assignment and static-global rejection are represented', () => {
  for (const id of [
    'dotted_public', 'multiple_aliased', 'explicit_pkg', 'relative_file',
    'private_export', 'wrong_kind_function', 'unknown_export', 'duplicate_alias',
    'local_collision', 'reassignment', 'mutable_global', 'runtime_val_global',
    'const_import_star', 'const_cycle',
  ]) {
    assert.ok(doc.cases.some(c => c.id === id), 'missing ' + id);
  }
  const passes = doc.cases.filter(c => c.kind === 'pass');
  assert.ok(passes.some(c => c.files['app.atto'].includes('import const')));
});
