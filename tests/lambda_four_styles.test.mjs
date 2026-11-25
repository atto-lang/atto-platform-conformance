import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = 'fixtures/lambda-four-styles-v1';
const manifest = JSON.parse(readFileSync(resolve(root, base, 'manifest.json'), 'utf8'));
const targets = ['java','llvm','rs','wasm','net','forge','js','cranelift','atto','hdl','realtime'];

test('four requested lambda styles retain honest execution evidence and backend tracking', () => {
  assert.equal(manifest.cases.length, 8);
  assert.equal(new Set(manifest.cases.map(c => c.id)).size, 8);
  assert.deepEqual(Object.keys(manifest.backend_tracking).sort(), targets.slice().sort());
  for (const [backend, url] of Object.entries(manifest.backend_tracking)) {
    assert.ok(url.startsWith('https://github.com/atto-lang/atto-source.' + backend + '/'));
    assert.match(url, /\/(pull|issues)\/[0-9]+$/);
  }
  assert.ok(manifest.validation_requirements.includes('EXACT_HEAD_SOURCE_AND_RUNTIME_SHA'));
  for (const entry of manifest.cases) {
    assert.ok(entry.path.startsWith(base + '/'));
    assert.ok(entry.path.endsWith('.atto'));
    const src = readFileSync(resolve(root, entry.path), 'utf8');
    assert.match(src, /const v = \|/);
    assert.deepEqual(Object.keys(entry.backend_status).sort(), targets.slice().sort());
    for (const status of Object.values(entry.backend_status))
      assert.equal(status, 'NOT_EXECUTED');
  }
  const good = manifest.cases.filter(c => c.expectation === 'ACCEPT_AND_EXIT_42');
  assert.equal(good.length, 4);
  for (const c of good) {
    const src = readFileSync(resolve(root, c.path), 'utf8');
    assert.match(src, /return;/);
    assert.match(src, /return 42;/);
    assert.equal(c.expected_type_or_diagnostic, 'void');
  }
  const bodies = good.map(c => readFileSync(resolve(root, c.path), 'utf8'));
  assert.match(bodies[0], /\|int foo, string x\| -> \{/);
  assert.match(bodies[1], /\|foo: int, x: string\| -> \{/);
  assert.match(bodies[2], /\|foo: int, x: string\| -> void \{/);
  assert.match(bodies[3], /\|foo: int, x: string\| : void -> \{/);
  assert.equal(manifest.cases.filter(c => c.expectation === 'REJECT_WITHOUT_ARTIFACT').length, 4);
});
