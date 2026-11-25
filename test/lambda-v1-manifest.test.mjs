import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { validateLambdaManifest, defaultManifestPath } from '../bin/validate-lambda-v1.mjs';

function inCopiedFixtures(callback) {
  const dir = mkdtempSync(join(tmpdir(), 'atto-lambda-manifest-'));
  try {
    for (const file of readdirSync(dirname(defaultManifestPath))) {
      copyFileSync(join(dirname(defaultManifestPath), file), join(dir, file));
    }
    callback(join(dir, 'manifest.json'), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('lambda target manifest is intact, not guest evidence', () => {
  const result = validateLambdaManifest();
  assert.deepEqual([result.cases, result.positives, result.negatives], [10, 5, 5]);
  assert.equal(result.status, 'FIXTURE_INTEGRITY_ONLY_NOT_GUEST_EXECUTION');
});

test('fixture modification fails closed', () => {
  inCopiedFixtures((manifest, dir) => {
    writeFileSync(join(dir, 'typed_single.atto'), '// tampered\n');
    assert.throws(() => validateLambdaManifest(manifest), /SHA-256 mismatch/);
  });
});

test('duplicate case identifiers fail closed', () => {
  inCopiedFixtures((manifest) => {
    const data = JSON.parse(readFileSync(manifest, 'utf8'));
    data.cases[1].id = data.cases[0].id;
    writeFileSync(manifest, JSON.stringify(data));
    assert.throws(() => validateLambdaManifest(manifest), /duplicate/);
  });
});

test('fake PASS declarations fail closed', () => {
  inCopiedFixtures((manifest) => {
    const data = JSON.parse(readFileSync(manifest, 'utf8'));
    data.status = 'PASS';
    writeFileSync(manifest, JSON.stringify(data));
    assert.throws(() => validateLambdaManifest(manifest), /TARGET-NOT-EXECUTED/);
  });
});
