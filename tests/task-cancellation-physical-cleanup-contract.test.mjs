import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = path.join(root, 'fixtures/task-blocks/v1');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

test('physical cleanup parity contract is explicit and never masquerades as runtime evidence', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.status, 'draft-contract-only');
  assert.equal(manifest.sourceExecutionVerified, false);
  assert.deepEqual(Object.keys(manifest.backends).sort(), ['java-graalvm', 'llvm']);
  for (const backend of Object.values(manifest.backends)) {
    assert.equal(backend.verified, false);
    assert.match(backend.required, /execution/);
  }
  assert.equal(manifest.cases.length, 4);
  assert.equal(new Set(manifest.cases.map(x => x.id)).size, manifest.cases.length);
  for (const c of manifest.cases) {
    assert.equal(c.verified, false);
    assert.ok(c.mustHold.length >= 3);
    assert.ok(c.terminal.length > 3);
    if (c.source !== null) {
      assert.equal(c.proposedSyntax, true);
      assert.ok(/^[a-z0-9-]+\.ores$/.test(c.source), c.source);
      const source = fs.readFileSync(path.join(dir, c.source), 'utf8');
      assert.match(source, /PROPOSED SOURCE FIXTURE/);
      assert.match(source, /nb task/);
    }
  }
  assert.match(manifest.releaseGate, /independent executed receipts/);
});
