import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = resolve(root, 'contracts/tail-calls-v1.json');
const backends = ['java', 'llvm', 'net', 'wasm', 'forge'];

test('tail-call v1 fixture registry is closed, source-only and has no parity claims', async () => {
  const manifest = JSON.parse(await readFile(contractPath, 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, 'tail-calls-v1');
  assert.deepEqual(manifest.backends, backends);
  assert.equal(manifest.cases.length, 9);
  const names = new Set();
  let deepTailCases = 0;
  let rejectionCases = 0;
  for (const entry of manifest.cases) {
    assert.match(entry.id, /^[a-z0-9-]+$/);
    assert.ok(!names.has(entry.id), 'duplicate test: ' + entry.id);
    names.add(entry.id);
    assert.ok(entry.path.startsWith('fixtures/tail-calls-v1/'));
    assert.match(entry.path, /^fixtures\/tail-calls-v1\/[a-z0-9-]+\.ores$/);
    const pathname = resolve(root, entry.path);
    assert.ok(pathname.startsWith(root + sep), 'fixture escaped repository root');
    const canonical = await realpath(pathname);
    assert.equal(canonical, pathname, 'symlinks are not accepted as source fixtures');
    const source = await readFile(canonical, 'utf8');
    assert.ok(source.length > 40 && source.length < 20000);
    assert.match(source, /\b(?:fnc|routine)\b/);
    assert.deepEqual(entry.backends, Object.fromEntries(backends.map(b => [b, 'pending'])),
      'source-only tests must not assert backend passes');
    if (entry.compile === 'accept') {
      assert.equal(typeof entry.stdout, 'string');
      if (entry.tailDepth !== undefined) {
        assert.ok(Number.isSafeInteger(entry.tailDepth) && entry.tailDepth >= 50000);
        deepTailCases++;
      }
    } else {
      assert.equal(entry.compile, 'reject');
      assert.equal(entry.diagnosticClass, 'recursive-routine');
      rejectionCases++;
    }
  }
  assert.equal(deepTailCases, 6);
  assert.equal(rejectionCases, 2);
});
