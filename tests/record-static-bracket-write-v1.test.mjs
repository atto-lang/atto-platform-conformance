import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const c = JSON.parse(readFileSync(new URL('../contracts/record-static-bracket-write-v1.json', import.meta.url), 'utf8'));
const backends = ['rust_browser_wasm','java','llvm','net','forge','independent_wasm','cranelift','atto_native'];
test('20 exact Record cases with no fabricated guest execution evidence', () => {
  assert.equal(c.schema_version, 1);
  assert.equal(c.contract, 'atto-record-static-bracket-write-v1');
  assert.equal(c.status, 'not_executed');
  assert.equal(c.cases.length, 20);
  assert.equal(new Set(c.cases.map(x=>x.id)).size, 20);
  assert.equal(c.cases.filter(x=>x.expect==='accept').length, 8);
  assert.equal(c.cases.filter(x=>x.expect==='reject').length, 12);
  for (const item of c.cases) {
    assert.match(item.id, /^(record|struct)-[a-z0-9-]+$/);
    assert.equal(item.status, 'not_executed');
    assert.match(item.source, /pub fnc main\(\): int/);
    assert.ok(item.reason.length > 12);
    assert.deepEqual(Object.keys(item.evidence).sort(), [...backends].sort());
    for (const target of backends) assert.equal(item.evidence[target], 'not_executed');
    if (item.expect === 'accept') {
      assert.equal(item.group, 'guest');
      assert.ok(Number.isInteger(item.expected_exit));
      assert.equal(item.expected_error, undefined);
    } else {
      assert.equal(item.group, 'negative');
      assert.match(item.expected_error, /^E_[A-Z_]+$/);
      assert.equal(item.expected_exit, undefined);
    }
  }
});
test('bracket update respects existing known field, mutability and Struct exclusion', () => {
  const byId = new Map(c.cases.map(x=>[x.id,x]));
  for (const id of ['record-write-identifier','record-write-hyphen',
    'record-dot-bracket-same-field','record-write-empty-key','record-write-unicode',
    'record-write-val-mut','record-write-other-fields-preserved',
    'record-write-nfc-nfd-distinct','record-immutable-val','record-immutable-let',
    'record-missing-field','record-wrong-field-type','record-computed-index',
    'record-expression-index','record-numeric-index','struct-bracket-read',
    'struct-bracket-write','record-shadowed-scalar','record-after-take',
    'record-shared-loan-conflict']) assert.ok(byId.has(id), id);
  assert.equal(byId.get('record-write-identifier').expected_exit, 3);
  assert.equal(byId.get('record-missing-field').expected_error, 'E_NO_FIELD');
  assert.equal(byId.get('record-wrong-field-type').expected_error, 'E_TYPE');
  assert.equal(byId.get('record-immutable-let').expected_error, 'E_IMMUTABLE');
  assert.equal(byId.get('record-computed-index').expected_error, 'E_UNSUPPORTED');
  assert.equal(byId.get('struct-bracket-read').expected_error, 'E_UNSUPPORTED');
  assert.equal(byId.get('struct-bracket-write').expected_error, 'E_UNSUPPORTED');
});
