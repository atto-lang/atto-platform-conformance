// Source-only manifest checks, not an Atto compiler or JSON security oracle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync(new URL('../contracts/alloc-json-guest-candidate-v1.json', import.meta.url), 'utf8'));
test('candidate has nine distinct targets and no fabricated execution proof', () => {
  assert.equal(manifest.scope, 'CANDIDATE_NOT_EXECUTED');
  assert.equal(new Set(manifest.targets.map(t => t.backend)).size, 9);
  for (const t of manifest.targets) {
    assert.equal(t.guest_execution, 'NOT_EXECUTED');
    assert.equal(t.native_aot, 'NOT_EXECUTED');
    assert.equal(t.evidence, null);
  }
});
test('lookup vectors distinguish absent keys, null, and dynamic data', () => {
  for (const v of manifest.vectors) {
    const root = JSON.parse(v.input);
    if (v.expected_option === 'None') assert.equal(Object.hasOwn(root, v.key), false);
    else if (v.id === 'exact-number') assert.ok(v.input.includes(v.expected));
    else assert.equal(JSON.stringify(root[v.key]), v.expected);
  }
  assert.equal(new Set(manifest.reject_parse.map(v => v.id)).size, 7);
});
test('positive and compiler-negative fixtures are present and unexecuted', () => {
  for (const f of [manifest.guest_fixture, manifest.negative_fixture]) {
    assert.equal(f.status, 'NOT_EXECUTED');
    assert.ok(readFileSync(new URL('../' + f.path, import.meta.url), 'utf8').includes('from "alloc/json"'));
  }
  assert.equal(manifest.negative_fixture.expected, 'COMPILE_REJECT_OPAQUE_CONSTRUCTION');
});
