import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root,
  'contracts/atto-gpu-kernel-source-link-v1.json'), 'utf8'));
const read = item => {
  assert.match(item.path, /^fixtures\/gpu-kernel-link-v1\/(?:positive|negative)-[a-z0-9-]+\.atto$/);
  const file = path.join(root, item.path);
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  const bytes = readFileSync(file);
  assert.ok(bytes.length > 0 && bytes.length <= 65536);
  const header = Buffer.from('blob ' + bytes.length + '\0', 'utf8');
  assert.equal(createHash('sha1').update(header).update(bytes).digest('hex'),
    item.gitBlobSha);
  return bytes.toString('utf8');
};

test('kernel source link cannot be promoted to GPU execution', () => {
  assert.equal(manifest.schema, 'attolang.gpu-kernel-source-link/1');
  assert.equal(manifest.state, 'SOURCE_LINK_SHAPE_ONLY_NOT_EXECUTABLE');
  assert.equal(manifest.sourceEvidence, 'SOURCE_SIGNATURE_ONLY_NOT_EXECUTABLE');
  assert.equal(manifest.checkedKernelSignature, true);
  assert.equal(manifest.checkedLaunchArity, true);
  assert.equal(manifest.literalArgumentTypesOnly, true);
  assert.equal(manifest.lexicalKernelNamesModuleScoped, true);
  assert.equal(manifest.crossModuleKernelLinkEnabled, false);
  assert.equal(manifest.verifiedModuleImportProof, false);
  assert.equal(manifest.privateKernelExportEnabled, false);
  for (const key of ['lexicalBufferArgumentTypesResolved', 'physicalDeviceAllocationBound',
    'providerIssuedLoan', 'deviceFenceVerified', 'cpuFallback'])
    assert.equal(manifest[key], false);
  for (const entry of Object.values(manifest.backendEvidence))
    assert.deepEqual(entry, {
      compiler: 'NOT_EXECUTED', guest: 'NOT_EXECUTED', physicalGpu: 'NOT_EXECUTED'
    });
});

test('five distinct exact-blob fixtures are prospective only', () => {
  assert.equal(manifest.cases.length, 5);
  assert.equal(new Set(manifest.cases.map(c => c.id)).size, 5);
  assert.equal(new Set(manifest.cases.map(c => c.path)).size, 5);
  for (const c of manifest.cases) {
    assert.equal(c.observedResult, 'NOT_EXECUTED');
    assert.equal(c.expectedDiagnostic === null, c.expectation === 'positive');
    read(c);
  }
});

test('linkage corpus preserves exact kernel names and negative intent', () => {
  const cases = new Map(manifest.cases.map(c => [c.id, c]));
  assert.match(read(cases.get('saxpy-linked')), /pub gpu fnc saxpy\(/);
  for (const [id, diagnostic, regex] of [
    ['missing-argument', 'GPU-LAUNCH-002', /saxpy\(alpha, x, y, out\)/],
    ['host-argument', 'GPU-LAUNCH-006', /hostCall\(\)/],
    ['implicit-i64-f32', 'GPU-LAUNCH-002', /saxpy\(5, x, y, out, n\)/],
    ['unknown-kernel', 'GPU-LAUNCH-001', /launch unknown\(/]
  ]) {
    const c = cases.get(id);
    assert.equal(c.expectedDiagnostic, diagnostic);
    assert.match(read(c), regex);
  }
});

// These tests assert source/manifest integrity only, NOT AttoLang guest runs.
