import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const c = JSON.parse(readFileSync(new URL('contracts/class-constructor-self-publication-v2.json', root), 'utf8'));

test('inline constructor portable contract remains explicitly source scoped', () => {
  assert.equal(c.schema, 'atto.class-constructor-self-publication.v2');
  assert.equal(c.status, 'TARGET_NOT_EXECUTED');
  assert.match(c.compiler_source_merge_sha, /^[0-9a-f]{40}$/);
  assert.deepEqual(c.cases.map(x => x.id),
    ['inline_self_escape','inline_method_before_publication','inline_initialized_counter']);
  assert.ok(Object.values(c.backend_status).every(x => x === 'NOT_EXECUTED'));
});
test('inline class constructor positives and negative fixture contents are well formed', () => {
  for (const item of c.cases) {
    const s = readFileSync(new URL(item.path, root), 'utf8');
    assert.ok(s.includes('constructor(int initial)'));
    assert.ok(s.includes('pub fnc main()'));
    if (item.kind === 'reject') {
      assert.ok(s.startsWith('// expect-error: E_OWNERSHIP'));
      assert.equal(item.code, 'E_OWNERSHIP');
      assert.equal(item.artifact, 'NONE');
    } else {
      assert.ok(s.startsWith('// expect-exit: 42'));
      assert.equal(item.expected_exit, 42);
    }
  }
  assert.match(readFileSync(new URL(c.cases[0].path, root), 'utf8'), /publish\(self\)/);
  assert.match(readFileSync(new URL(c.cases[1].path, root), 'utf8'), /self\.peek\(\)/);
  assert.match(readFileSync(new URL(c.cases[2].path, root), 'utf8'), /self\.value = initial/);
});
