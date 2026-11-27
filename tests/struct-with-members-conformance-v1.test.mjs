import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const r = JSON.parse(readFileSync(new URL('../contracts/struct-with-members-conformance-v1.json', import.meta.url), 'utf8'));
const byId = Object.fromEntries(r.cases.map(c => [c.id, c]));

test('struct attachment fixture registry does not claim compiler execution', () => {
  assert.equal(r.status, 'TARGET_NOT_EXECUTED');
  assert.equal(r.cases.length, 40);
  assert.equal(Object.keys(byId).length, 40);
  assert.equal(Object.keys(r.backend_status).length, 9);
  assert.ok(Object.values(r.backend_status).every(s => s === 'NOT_EXECUTED'));
  assert.deepEqual(r.required_gates, ['parse','semantic','link','emit','guest_execute']);
  for (const c of r.cases) {
    assert.equal(c.status, 'NOT_EXECUTED');
    assert.ok(c.source.includes('pub fnc main():'), c.id);
    if (c.expect === 'accept') {
      const expected = {
        'define-origin-true': '0\n0\ntrue\n',
        'distinct-nominal-owners': '30\n-10\n200\n',
        'distinct-mutable-owner-copies': '40\n4\n-10\n',
        'nested-nominal-value-copy': '12\n8\n12\n',
        'nested-three-level': '12\n8\n12\n',
        'nested-forward-owner': '12\n8\n12\n'
      };
      assert.equal(c.expected_stdout, expected[c.id] ?? '30\n200\nfalse\n');
      assert.equal(c.expected_exit, 0);
      assert.equal(c.no_artifact, undefined);
    } else {
      assert.equal(c.expect, 'reject');
      assert.equal(c.no_artifact, true);
      assert.ok(c.diagnostic_category);
    }
  }
});

test('corrected headers, chained forms and asterisk rejection are distinct', () => {
  const s = byId['grouped-exact'].source;
  for (const header of ['mtd int • sum()', 'mtd int <- product()', 'mtd is_origin() : bool']) {
    assert.ok(s.includes(header));
    assert.ok(byId['chained-equivalent'].source.includes(header));
  }
  assert.ok(s.includes('} with {'));
  assert.ok(byId['chained-equivalent'].source.includes('} with constructor('));
  assert.ok(byId['asterisk-rejected'].source.includes('mtd bool * is_origin()'));
  assert.equal(byId['asterisk-rejected'].expect, 'reject');
  for (const c of r.cases.filter(c => c.expect === 'accept')) {
    assert.ok(!c.source.includes('mtd bool *'));
  }
});

test('canonical define struct and postfix arrow preserve original fixtures', () => {
  for (const id of ['define-grouped-arrow','define-chained-arrow','define-all-right-arrow','define-origin-true','define-duplicate-arrow']) {
    assert.ok(byId[id].source.startsWith('define struct Point {'), id);
    assert.ok(byId[id].source.includes('mtd is_origin() -> bool'), id);
  }
  assert.equal(byId['define-duplicate-arrow'].expect, 'reject');
  assert.ok(byId['define-duplicate-arrow'].source.includes('mtd sum() -> int'));
  assert.ok(byId['grouped-exact'].source.startsWith('type Point = struct {'));
  assert.ok(byId['all-colon'].source.includes('mtd is_origin() : bool'));
});

test('nominal owners never become structurally interchangeable', () => {
  for (const id of ['distinct-nominal-owners','distinct-mutable-owner-copies','wrong-second-owner-annotation','wrong-second-owner-copy','owner-method-not-structural']) {
    assert.ok(byId[id].source.includes('define struct Point {'), id);
    assert.ok(byId[id].source.includes('define struct Offset {'), id);
  }
  assert.equal(byId['distinct-mutable-owner-copies'].expect, 'accept');
  assert.ok(byId['distinct-mutable-owner-copies'].source.includes('q.swap(3, 7)'));
  assert.equal(byId['wrong-second-owner-copy'].expect, 'reject');
  assert.ok(byId['wrong-second-owner-copy'].source.includes('let Point r = copy! q;'));
  assert.equal(byId['duplicate-nominal-owner'].expect, 'reject');
  assert.equal(byId['owner-method-not-structural'].expect, 'reject');
  assert.ok(byId['owner-method-not-structural'].source.includes('mtd int • other()'));
});

test('nested layout targets preserve exact identities and bounded diagnostic codes', () => {
  assert.equal(r.cases.filter(c => c.expected_code).length, 9);
  for (const c of r.cases.filter(c => c.expected_code)) {
    assert.equal(c.expect, 'reject');
    assert.match(c.expected_code, /^E_[A-Z_]+$/);
  }
  assert.ok(byId['nested-three-level'].source.includes('Rectangle inner;'));
  assert.equal(byId['nested-cycle'].expected_code, 'E_STRUCT_LAYOUT_CYCLE');
  assert.equal(byId['nested-mutual-cycle'].expected_code, 'E_STRUCT_LAYOUT_CYCLE');
  assert.equal(byId['nested-slot-budget'].expected_code, 'E_SOURCE_LIMIT');
});
