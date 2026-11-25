import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const registry = JSON.parse(readFileSync(new URL('../contracts/map-mutation-lookup-v1.json', import.meta.url), 'utf8'));
const backends = ['rust_browser_wasm', 'java', 'llvm', 'net', 'forge', 'independent_wasm', 'cranelift', 'atto_native'];

test('portable Map contract is complete and contains no fabricated execution evidence', () => {
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.contract, 'atto-map-mutation-lookup-v1');
  assert.equal(registry.status, 'not_executed');
  assert.equal(registry.cases.length, 29, 'any corpus change requires runner review');
  assert.equal(new Set(registry.cases.map(c => c.id)).size, registry.cases.length);
  for (const c of registry.cases.slice(0, 15)) {
    assert.match(c.id, /^map-[a-z0-9-]+$/);
    assert.ok(['accept', 'reject'].includes(c.expect));
    assert.ok(c.source.includes('pub fnc main(): int'));
    assert.ok(c.reason.length > 8);
    assert.equal(c.status, 'not_executed');
    assert.equal(c.evidence && Object.keys(c.evidence).length, backends.length);
    for (const name of backends) {
      assert.equal(c.evidence[name], 'not_executed', c.id + ': no executed receipt for ' + name);
    }
    if (c.expect === 'accept') {
      assert.ok(Number.isInteger(c.expected_exit), c.id);
      assert.equal(c.expected_error, undefined, c.id);
    } else {
      assert.match(c.expected_error, /^E_[A-Z_]+$/, c.id);
      assert.equal(c.expected_exit, undefined, c.id);
    }
  }
});

test('all requested forms and safety gates are represented by distinct cases', () => {
  const byId = new Map(registry.cases.map(c => [c.id, c]));
  for (const id of [
    'map-literal-set-index-add', 'map-try-add-duplicate-false', 'map-new-context',
    'map-new-explicit', 'map-get-missing-option', 'map-set-returns-old-option',
    'map-untyped-new-infer', 'map-untyped-empty', 'map-get-not-int',
    'map-set-readonly-let', 'map-index-readonly-val', 'map-static-duplicate',
    'map-wrong-key-type', 'map-computed-record-index-reject', 'map-unverified-read-brackets'
  ]) assert.ok(byId.has(id), 'missing target ' + id);
  const source = byId.get('map-literal-set-index-add').source;
  for (const fragment of ['let mut Map<string,int>', '"foo" => 5', 'm.set("foo", 6)',
                          'm["foo"] = 3', 'm.try_add("foo" => 7)', 'm.get("foo").unwrap_or(0)']) {
    assert.ok(source.includes(fragment), 'missing ' + fragment);
  }
  assert.equal(byId.get('map-literal-set-index-add').expected_exit, 3);
  assert.equal(byId.get('map-try-add-duplicate-false').expected_exit, 3);
  assert.equal(byId.get('map-get-not-int').expected_error, 'E_TYPE');
  assert.equal(byId.get('map-set-readonly-let').expected_error, 'E_IMMUTABLE');
  assert.equal(byId.get('map-index-readonly-val').expected_error, 'E_IMMUTABLE');
  assert.equal(byId.get('map-static-duplicate').expected_error, 'E_DUPLICATE');
  assert.equal(byId.get('map-untyped-new-infer').expected_error, 'E_INFER');
  assert.equal(byId.get('map-computed-record-index-reject').expected_error, 'E_UNSUPPORTED');
});
