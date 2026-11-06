import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'contracts/atto-gpu-explicit-launch-v1.json'), 'utf8'));
const hex40 = /^[a-f0-9]{40}$/;
const allowedBackends = ['java', 'llvm', 'net', 'wasm', 'forge', 'cranelift', 'js'];
const diagnostics = new Set(['GPU-LAUNCH-002', 'GPU-LAUNCH-003', 'GPU-LAUNCH-005', 'GPU-LAUNCH-006', 'GPU-LAUNCH-009', 'GPU-LAUNCH-010']);
function blobSha(bytes) {
  const header = Buffer.from('blob ' + bytes.length + '\0', 'utf8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}
function fixture(c) {
  assert.match(c.path, /^fixtures\/gpu-launch-v1\/[a-z0-9-]+\.atto$/, 'no arbitrary fixture path');
  const filename = path.join(root, c.path);
  const stat = lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'fixture must be a regular non-symlink file');
  assert.equal(stat.nlink, 1, 'fixture must not be hardlinked');
  const bytes = readFileSync(filename);
  assert.ok(bytes.length > 0 && bytes.length <= 64 * 1024, 'bounded source fixture');
  assert.match(c.gitBlobSha, hex40);
  assert.equal(blobSha(bytes), c.gitBlobSha, 'fixture Git blob identity mismatch');
  return bytes.toString('utf8');
}

test('GPU launch corpus has a pinned proposal-only schema', () => {
  assert.equal(manifest.schema, 'attolang.gpu-explicit-launch-corpus/1');
  assert.equal(manifest.state, 'SOURCE_PROPOSAL_ONLY');
  assert.equal(manifest.contract, 'oreslang-common-source/docs/GPU_EXPLICIT_LAUNCH_V1.md');
  assert.equal(manifest.execution.launchResult, 'Future<void>');
  assert.equal(manifest.execution.implicitHostTransfer, false);
  assert.equal(manifest.execution.implicitCpuFallback, false);
  assert.equal(manifest.execution.legacyCudaTripleChevron, false);
  assert.equal(manifest.execution.groupDimensionCount, 3);
  assert.equal(manifest.execution.physicalGridAxesPositive, true);
  assert.equal(manifest.execution.emptyLogicalExtentNoPhysicalDispatch, true);
  assert.equal(manifest.execution.dispatchedLaneCountSeparateFromLogicalCount, true);
  assert.equal(manifest.execution.sourceHirStatus, 'SOURCE_SHAPE_ONLY_NOT_EXECUTABLE');
  assert.equal(manifest.execution.requiresBoundIntegerTypeProof, true);
  assert.equal(manifest.execution.arbitraryHostCallsInGeometry, false);
  assert.equal(manifest.execution.deviceEvidenceRequired, true);
});

test('all seven backends remain explicitly not executed, not falsely passed', () => {
  assert.deepEqual(Object.keys(manifest.backendEvidence).sort(), allowedBackends.sort());
  for (const backend of allowedBackends) {
    assert.deepEqual(manifest.backendEvidence[backend], {
      compiler: 'NOT_EXECUTED', guest: 'NOT_EXECUTED', physicalGpu: 'NOT_EXECUTED'
    });
  }
  assert.ok(manifest.warnings.some(x => x.includes('Zero-step')));
});

test('source cases have distinct IDs, exact git blobs and no false execution claims', () => {
  assert.equal(manifest.cases.length, 14);
  assert.equal(new Set(manifest.cases.map(c => c.id)).size, manifest.cases.length);
  assert.equal(new Set(manifest.cases.map(c => c.path)).size, manifest.cases.length);
  const positives = manifest.cases.filter(c => c.expectation === 'positive');
  const negatives = manifest.cases.filter(c => c.expectation === 'negative');
  assert.equal(positives.length, 3);
  assert.equal(negatives.length, 11);
  for (const c of manifest.cases) {
    assert.equal(c.observedResult, 'NOT_EXECUTED');
    assert.equal(c.expectation === 'negative', c.expectedDiagnostic !== null);
    if (c.expectedDiagnostic !== null) assert.ok(diagnostics.has(c.expectedDiagnostic));
    fixture(c);
  }
});

test('positive fixture reuses existing AttoLang GPU vocabulary with explicit launch', () => {
  const source = fixture(manifest.cases.find(c => c.id === 'saxpy'));
  assert.match(source, /pub gpu fnc saxpy\(/);
  assert.match(source, /gpu\.global_id\(0\)/);
  assert.match(source, /launch saxpy\(/);
  assert.match(source, /on gpu\(device\)/);
  for (const field of ['grid:', 'block:', 'queue:', 'shared_bytes:']) assert.ok(source.includes(field));
  assert.match(source, /await completion/);
  assert.doesNotMatch(source, /<<<|>>>/);
});

test('negative fixtures independently exercise strict launch admission', () => {
  const cases = new Map(manifest.cases.map(c => [c.id, c]));
  const expected = {
    'host-buffer': ['GPU-LAUNCH-002', /HostBuffer<f32>/],
    'zero-block': ['GPU-LAUNCH-003', /block: \[0, 1, 1\]/],
    'zero-physical-grid': ['GPU-LAUNCH-003', /grid: \[0, 1, 1\]/],
    'host-geometry-call': ['GPU-LAUNCH-003', /grid: \[hostCall\(\), 1, 1\]/],
    'bool-geometry': ['GPU-LAUNCH-003', /grid: \[flag, 1, 1\]/],
    'await-in-kernel': ['GPU-LAUNCH-006', /await sleep\(1\)/],
    'aliased-write': ['GPU-LAUNCH-005', /write_twice\(data, data\)/],
    'chevron': ['GPU-LAUNCH-009', /fill<<<1, 64>>>/],
    'mixed-geometry': ['GPU-LAUNCH-003', /over: \[100\], block:/],
    'zero-group': ['GPU-LAUNCH-003', /group: \[0\]/],
    'divergent-barrier-tail': ['GPU-LAUNCH-010', /gpu\.group_barrier\(\)/]
  };
  for (const [id, [diagnostic, pattern]] of Object.entries(expected)) {
    const c = cases.get(id);
    assert.equal(c.expectedDiagnostic, diagnostic);
    assert.match(fixture(c), pattern);
  }
});

test('logical over/group is a distinct shape and cannot be silently promoted', () => {
  assert.deepEqual(manifest.execution.geometryModes, ['grid/block', 'over/group']);
  assert.equal(manifest.execution.logicalExtentRetainedInIR, true);
  assert.equal(manifest.execution.paddedTailProofRequired, true);
  const simple = fixture(manifest.cases.find(c => c.id === 'saxpy-logical'));
  const matrix = fixture(manifest.cases.find(c => c.id === 'logical-2d'));
  assert.match(simple, /over: \[n\], group: \[256\], queue: queue/);
  assert.match(matrix, /over: \[width, height\], group: \[16, 16\]/);
  for (const source of [simple, matrix]) {
    assert.match(source, /launch [a-z0-9_]+\(/);
    assert.match(source, /on gpu\(device\)/);
    assert.doesNotMatch(source, /<<<|>>>/);
  }
});

// Intentionally no compiler invocation or GPU test here. Syntax-shape and
// blob-pinning tests MUST NOT be reported as executable AttoLang parity.
