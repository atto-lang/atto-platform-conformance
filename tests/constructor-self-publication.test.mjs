import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const registry = JSON.parse(readFileSync(new URL('contracts/constructor-self-publication-v1.json', root), 'utf8'));

test('constructor self-publication safety registry identifies independent backend claims', () => {
  assert.equal(registry.schema, 'atto.out-of-line-constructor-self-publication.v1');
  assert.equal(registry.status, 'TARGET_NOT_EXECUTED');
  assert.match(registry.source_merge_sha, /^[0-9a-f]{40}$/);
  assert.equal(registry.required_cases.length, 2);
  assert.equal(new Set(registry.required_cases.map(x => x.id)).size, 2);
  assert.ok(Object.values(registry.backend_status).every(x => x === 'NOT_EXECUTED'));
});
test('under-construction self cannot be published or method-dispatched in portable negative sources', () => {
  for (const c of registry.required_cases) {
    assert.equal(c.kind, 'fail');
    assert.equal(c.expected_error, 'E_OWNERSHIP');
    const s = readFileSync(new URL(c.path, root), 'utf8');
    assert.ok(s.startsWith('// expect-error: E_OWNERSHIP'));
    assert.ok(s.includes('constructor'));
    assert.ok(s.includes('pub fnc main()'));
    assert.ok(s.length < 10000);
  }
  const escaped = readFileSync(new URL(registry.required_cases[0].path, root), 'utf8');
  const called = readFileSync(new URL(registry.required_cases[1].path, root), 'utf8');
  assert.match(escaped, /publish\(self\)/);
  assert.match(called, /self\.get_value\(\)/);
  const valid = readFileSync(new URL(registry.existing_valid_initializer, root), 'utf8');
  assert.match(valid, /self\.value = initial/);
  assert.match(valid, /expect-exit: 42/);
});
