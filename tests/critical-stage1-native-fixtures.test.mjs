import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const base = new URL('../fixtures/critical-suspension-v1/java-stage1/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', base), 'utf8'));
test('critical stage-1 fixture identities and parity claims are fail closed', () => {
  assert.equal(manifest.source_commit.length, 40);
  assert.deepEqual(Object.values(manifest.target_verified), Array(5).fill(false));
  assert.equal(manifest.fixtures.length, 4);
  const names = new Set();
  for (const fixture of manifest.fixtures) {
    assert.match(fixture.name, /^[a-z0-9][a-z0-9-]*\.ores$/);
    assert.equal(names.has(fixture.name), false);
    names.add(fixture.name);
    assert.equal(fixture.verified_guest, false);
    const bytes = fs.readFileSync(new URL(fixture.name, base));
    const sha = crypto.createHash('sha1')
      .update(Buffer.from('blob ' + bytes.length + '\0'))
      .update(bytes).digest('hex');
    assert.equal(sha, fixture.git_blob_sha1, fixture.name + ' source changed');
    assert.match(bytes.toString('utf8'), /critical/);
  }
  assert.equal(manifest.fixtures.filter(x => x.classification === 'java-positive').length, 1);
  assert.equal(manifest.fixtures.filter(x => x.classification === 'java-rejected').length, 3);
  assert.equal(manifest.fixtures.find(x => x.classification === 'java-positive').expected, '31');
});
