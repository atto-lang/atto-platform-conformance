// Integrity only: NO Atto compiler or guest execution occurs here.
// Run: node --test tests/unsafe-blocks-v1.test.mjs
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const registry = JSON.parse(readFileSync(new URL('../contracts/unsafe-blocks-v1.json', import.meta.url), 'utf8'));

test('unsafe v1 registry is a target and cannot certify a guest', () => {
  assert.equal(registry.contract, 'atto-unsafe-blocks-v1');
  assert.equal(registry.status, 'TARGET_ONLY_NOT_EXECUTED');
  assert.match(registry.execution_note, /No compiler or runtime has run/);
  assert.equal(registry.normative_spec.includes('/atto-spec/'), true);
  assert.deepEqual(registry.allowed_verification_statuses, ['passed','failed','unsupported','not_executed']);
});

test('all cases have complete and explicitly unexecuted per-target results', () => {
  assert.ok(registry.cases.length >= 20);
  assert.ok(registry.targets.length >= 6);
  const ids = new Set();
  for (const c of registry.cases) {
    assert.match(c.id, /^[a-z][a-z0-9-]+$/);
    assert.equal(ids.has(c.id), false, 'duplicate id: ' + c.id);
    ids.add(c.id);
    assert.ok(['accept','reject'].includes(c.expect), c.id);
    assert.ok(Object.hasOwn(registry.profiles, c.profile), c.id);
    assert.ok(typeof c.source === 'string' && c.source.includes('fnc main'), c.id);
    assert.ok(typeof c.reason === 'string' && c.reason.length >= 12, c.id);
    assert.equal(c.diagnostic === null, c.expect === 'accept', c.id);
    assert.deepEqual(Object.keys(c.verification).sort(), [...registry.targets].sort(), c.id);
    for (const target of registry.targets) {
      assert.equal(c.verification[target], 'not_executed', c.id + ' ' + target);
    }
  }
});

test('security boundaries have independent negative cases', () => {
  const byId = new Map(registry.cases.map(c => [c.id,c]));
  for (const id of ['unsafe-call-no-block','unsafe-region-ends','unsafe-fnc-body-not-implicit','tenantvm-empty-block','tenantvm-unsafe-import','forged-pointer','ffi-no-capability','tenantvm-transport-native-grant','unsafe-await-live-native-loan']) {
    assert.equal(byId.get(id)?.expect, 'reject', id);
  }
  for (const id of ['empty-trusted','safe-inside-trusted','nested-trusted','string-not-keyword','symbol-not-keyword','identifier-near-miss']) {
    assert.equal(byId.get(id)?.expect, 'accept', id);
  }
});

test('unsafe token cannot accidentally be interpreted in string/comment/Symbol examples', () => {
  const source = Object.fromEntries(registry.cases.map(c=>[c.id,c.source]));
  assert.ok(source['string-not-keyword'].includes('"unsafe { }"'));
  assert.ok(source['comment-not-keyword'].includes('/* unsafe { } */'));
  assert.ok(source['symbol-not-keyword'].includes('#unsafe'));
  assert.ok(source['identifier-near-miss'].includes('unsafe_tools'));
});
