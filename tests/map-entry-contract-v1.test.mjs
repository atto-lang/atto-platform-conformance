import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = new URL('../contracts/map-mutation-lookup-v1.json', import.meta.url);
const registry = JSON.parse(await readFile(file, 'utf8'));
const byId = new Map(registry.cases.map((entry) => [entry.id, entry]));
const expectedStatuses = ['passed', 'failed', 'unsupported', 'not_executed'];

test('Entry extension retains the original Map contract and unique bounded fixtures', () => {
  assert.equal(registry.contract, 'atto-map-mutation-lookup-v1');
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.cases.length, 29);
  assert.equal(byId.size, registry.cases.length, 'all case IDs must be unique');
  assert.deepEqual(registry.allowed_verification_statuses, expectedStatuses);
  for (const c of registry.cases) {
    assert.match(c.id, /^[a-z][a-z0-9-]+$/);
    assert.ok(['guest', 'negative'].includes(c.group));
    assert.ok(['accept', 'reject'].includes(c.expect));
    assert.ok(c.source && c.source.length < 16384, c.id);
    assert.equal(c.status, 'not_executed', c.id);
    assert.deepEqual(Object.keys(c.evidence).sort(), Object.keys(registry.verification.backend_evidence).sort());
    for (const [backend, status] of Object.entries(c.evidence)) {
      assert.equal(status, 'not_executed', c.id + ':' + backend);
    }
    if (c.expect === 'accept') {
      assert.equal(c.group, 'guest', c.id);
      assert.equal(typeof c.expected_exit, 'number', c.id);
      assert.equal(c.expected_error, undefined);
    } else {
      assert.equal(c.group, 'negative', c.id);
      assert.match(c.expected_error, /^E_[A-Z_]+$/, c.id);
      assert.equal(c.expected_exit, undefined);
    }
  }
  assert.ok(Object.values(registry.verification.backend_evidence).every((status) => status === 'not_executed'));
});

test('requested top-level dual spellings and non-overwriting add produce exit 3', () => {
  const c = byId.get('entry-global-dual-cast-duplicate-add');
  assert.ok(c);
  assert.equal(c.expected_exit, 3);
  assert.ok(c.source.includes('let entry1 = ("foo" => 5) as Entry<string, int>;'));
  assert.ok(c.source.includes('let entry2 = "foo" => 5 (as Entry<string, int>);'));
  for (const fragment of ['x.set("foo", 6)', 'x["foo"] = 3', 'x.add(entry1)', 'x.add(entry2)', 'x.get("foo").unwrap()']) {
    assert.ok(c.source.includes(fragment), fragment);
  }
  assert.equal(byId.get('map-literal-set-index-add').expected_exit, 3);
  assert.equal(byId.get('entry-duplicate-add-reusable').expected_exit, 3);
});

test('both Entry casts, generic negatives, ownership/static admission are covered', () => {
  const passes = ['entry-local-parenthesized-as', 'entry-local-trailing-as', 'entry-direct-as-expression',
                  'entry-inferred-add-argument', 'entry-inferred-standalone', 'entry-duplicate-add-reusable'];
  const fails = ['entry-key-type-mismatch', 'entry-value-type-mismatch', 'entry-generic-arity',
                 'entry-invalid-map-ascription', 'entry-suffix-missing-delimiter',
                 'entry-static-impure-init', 'entry-record-is-not-entry'];
  for (const id of passes) assert.equal(byId.get(id)?.expect, 'accept', id);
  for (const id of fails) assert.equal(byId.get(id)?.expect, 'reject', id);
  assert.ok(byId.get('entry-local-trailing-as').source.includes('(as Entry<string, int>)'));
  assert.ok(byId.get('entry-local-parenthesized-as').source.includes(') as Entry<string, int>'));
  assert.match(registry.verification.required, /Nonzero-step compiled guest/);
});
