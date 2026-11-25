import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(
  new URL('../fixtures/lambda-mandatory-pipes-v1/manifest.json', import.meta.url),
  'utf8'
));

test('mandatory-pipe fixture registry is complete and explicitly unexecuted', () => {
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.id, 'lambda-mandatory-pipes-v1');
  assert.equal(manifest.status, 'TARGET_NOT_EXECUTED');
  assert.equal(manifest.cases.length, 11);
  assert.ok(Object.keys(manifest.backend_status).length >= 7);
  assert.ok(Object.values(manifest.backend_status).every(v => v === 'NOT_EXECUTED'));
  assert.equal(new Set(manifest.cases.map(c => c.id)).size, manifest.cases.length);
  const pos = manifest.cases.filter(c => c.expect === 'PARSE_ACCEPT');
  const neg = manifest.cases.filter(c => c.expect === 'PARSE_REJECT');
  assert.equal(pos.length, 5);
  assert.equal(neg.length, 6);
  assert.ok(pos.some(c => c.source.includes('|_| : int -> 5')));
  assert.ok(pos.some(c => c.source.includes('|| : int -> 5')));
  assert.ok(neg.some(c => c.source.includes('= _ : int -> 5')));
  assert.ok(neg.some(c => c.source.includes('= _ -> 5')));
  for (const c of manifest.cases) {
    assert.ok(c.id && c.meaning && c.source.endsWith('\n'), c.id);
    assert.match(c.source, /(?:val mapper|const fnc mapper)\s*=/, c.id);
  }
});
