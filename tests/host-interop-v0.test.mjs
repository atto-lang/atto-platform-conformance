import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const manifest = JSON.parse(readFileSync(
  resolve(root, 'contracts/host-interop-v0/manifest.json'), 'utf8'));

test('host interop manifest is a non-promoting fourteen-case backend-owned contract', () => {
  assert.equal(manifest.schema, 'attolang.host-interop-v0');
  assert.equal(manifest.status, 'NOT_EXECUTED');
  assert.equal(manifest.cases.length, 14);
  assert.equal(Object.keys(manifest.fixtures).length, 10);
  const ids = new Set();
  for (const item of manifest.cases) {
    assert.match(item.id, /^(java|net)-[a-z-]+$/);
    assert.ok(!ids.has(item.id), 'duplicate case: ' + item.id);
    ids.add(item.id);
    assert.ok(['java', 'net'].includes(item.backend));
    assert.ok(['accept', 'reject'].includes(item.expected));
    assert.ok(['execute', 'source-check', 'runtime-admission'].includes(item.phase));
    assert.ok(Object.hasOwn(manifest.fixtures, item.file));
    assert.equal(item.status, 'NOT_EXECUTED');
    assert.equal(item.source_head, null);
    assert.equal(item.compiled_binary_sha256, null);
    assert.equal(item.executed_steps, 0);
    if (item.expected === 'accept') {
      assert.equal(item.phase, 'execute', 'source check cannot claim guest execution');
      assert.match(item.expected_output, /^(1|42)$/);
    } else {
      assert.equal(item.expected_output, null);
    }
  }
  assert.equal(manifest.cases.filter(x => x.expected === 'accept').length, 2);
  assert.equal(manifest.cases.filter(x => x.expected === 'reject').length, 12);
  assert.equal(manifest.cases.filter(x => x.id === 'net-missing-capability').length, 1);
  assert.equal(manifest.cases.filter(x => x.id === 'java-missing-capability').length, 1);
});

for (const [name, fixture] of Object.entries(manifest.fixtures)) {
  test('immutable host interop fixture Git blob: ' + name, () => {
    assert.match(name, /^[a-z-]+\.atto$/);
    assert.equal(fixture.path, 'contracts/host-interop-v0/' + name);
    const path = resolve(root, fixture.path);
    const stat = lstatSync(path);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.nlink, 1, 'fixture hardlinks cannot attest immutable source bytes');
    const bytes = readFileSync(path);
    assert.ok(bytes.length > 0 && bytes.length < 8192);
    const hash = createHash('sha1')
      .update(Buffer.from('blob ' + bytes.length + '\0'))
      .update(bytes).digest('hex');
    assert.equal(hash, fixture.git_blob_sha1, 'fixture has drifted from pinned Git blob');
  });
}

test('cross-backend host import claims remain explicitly negative', () => {
  const java = manifest.cases.find(x => x.id === 'java-reject-dotnet-host');
  const net = manifest.cases.find(x => x.id === 'net-reject-jvm-host');
  assert.equal(java.expected, 'reject');
  assert.equal(net.expected, 'reject');
  assert.equal(java.phase, 'source-check');
  assert.equal(net.phase, 'source-check');
});
