import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const root = new URL('../fixtures/numeric-guest-v1/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const shaBlob = source => createHash('sha1')
  .update('blob ' + Buffer.byteLength(source, 'utf8') + '\0')
  .update(source)
  .digest('hex');

test('all checked division candidates pin exact Git blob IDs', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.status, 'CANDIDATE_SOURCE_NOT_EXECUTED');
  assert.equal(manifest.cases.length, 7);
  assert.equal(new Set(manifest.cases.map(x => x.id)).size, 4);
  for (const fixture of manifest.cases) {
    assert.match(fixture.path, /^[a-z0-9-]+\.atto$/);
    const content = readFileSync(new URL(fixture.path, root), 'utf8');
    assert.match(fixture.blob, /^[0-9a-f]{40}$/);
    assert.equal(shaBlob(content), fixture.blob, fixture.id);
    assert.match(content, /pub fnc main\(\): int/);
    assert.match(content, /return\s+/);
    assert.equal(fixture.status, 'not_executed');
  }
});

test('candidate source is never mistaken for authenticated compiler/AOT evidence', () => {
  for (const state of Object.values(manifest.backendResults)) {
    assert.equal(state, 'not_executed');
  }
  assert.deepEqual(
    manifest.cases.map(x => x.expected),
    [
      {kind:'value',value:'42'},
      {kind:'error',code:'division_by_zero'},
      {kind:'error',code:'integer_overflow'},
      {kind:'error',code:'division_by_zero'},
      {kind:'value',value:'42'},
      {kind:'value',value:'42'},
      {kind:'value',value:'42'},
    ]
  );
  const accepted = readFileSync(new URL('checked-i64-quotient.atto', root), 'utf8');
  assert.match(accepted, /return\s+lhs\s*\/\s*rhs/);
  assert.match(accepted, /return\s+lhs\s*%\s*rhs/);
  const zeroDivisor = readFileSync(new URL('reject-i64-zero-divisor.atto', root), 'utf8');
  assert.match(zeroDivisor, /7\s*\/\s*divisor/);
  const overflow = readFileSync(new URL('reject-i64-min-overflow.atto', root), 'utf8');
  assert.match(overflow, /-9223372036854775808/);
  for (const id of ['trap-division-by-zero', 'trap-integer-overflow', 'trap-result-no-doublewrap']) {
    const source = readFileSync(new URL(id + '.atto', root), 'utf8');
    assert.match(source, /\btrap\b/, id);
    assert.match(source, /\.is_(?:err|ok)\(\)/, id);
  }
  const nested = readFileSync(new URL('trap-result-no-doublewrap.atto', root), 'utf8');
  assert.match(nested, /trap Ok\(42\)/);
});
