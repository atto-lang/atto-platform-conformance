import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'contracts/atto-gpu-kernel-v1.json'), 'utf8'));
const backends = ['java', 'llvm', 'net', 'wasm', 'forge', 'cranelift', 'js'];
const sha40 = /^[a-f0-9]{40}$/;
const expected = new Set(['GPU-KERNEL-001', 'GPU-KERNEL-003', 'GPU-KERNEL-005', 'GPU-KERNEL-006', 'GPU-KERNEL-010']);
const blobSha = bytes => createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + '\0'))
    .update(bytes).digest('hex');

function fixture(entry) {
    assert.match(entry.path, /^fixtures\/gpu-kernel-v1\/[a-z0-9-]+\.atto$/);
    assert.match(entry.gitBlobSha, sha40);
    const file = path.join(root, entry.path);
    const stat = lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
    const bytes = readFileSync(file);
    assert.ok(bytes.length > 0 && bytes.length <= 65536);
    assert.equal(blobSha(bytes), entry.gitBlobSha);
    return bytes.toString('utf8');
}

test('GPU kernel source manifest is non-promoting and fail closed', () => {
    assert.equal(manifest.schema, 'attolang.gpu-kernel-source-corpus/1');
    assert.equal(manifest.state, 'SOURCE_PROPOSAL_ONLY');
    assert.equal(manifest.execution.sourceHir, 'TYPED_SOURCE_ONLY_NOT_EXECUTABLE');
    assert.equal(manifest.execution.tailGuardEvidence, 'SOURCE_TAIL_GUARD_ONLY_NOT_EXECUTABLE');
    assert.equal(manifest.execution.tailGuardRequiresCanonicalN, true);
    assert.equal(manifest.execution.unrelatedIntegerBoundProof, false);
    assert.equal(manifest.execution.constantBoundProof, false);
    assert.equal(manifest.execution.physicalGpuEnabled, false);
    assert.equal(manifest.execution.deviceAllocationCapacityProof, false);
    assert.equal(manifest.execution.compilerBackendProof, false);
    assert.equal(manifest.execution.implicitCpuFallback, false);
    assert.equal(manifest.execution.untrustedHostCallsAllowed, false);
    assert.deepEqual(Object.keys(manifest.backends).sort(), backends.sort());
    for (const backend of backends)
        assert.deepEqual(manifest.backends[backend],
            {compiler:'NOT_EXECUTED', guest:'NOT_EXECUTED', physicalGpu:'NOT_EXECUTED'});
    assert.ok(manifest.warnings.some(x => x.includes('steps=[]')));
});

test('kernel corpus has distinct checked source blobs and truthful case statuses', () => {
    assert.equal(manifest.cases.length, 18);
    assert.equal(new Set(manifest.cases.map(x => x.id)).size, 18);
    assert.equal(new Set(manifest.cases.map(x => x.path)).size, 18);
    assert.equal(manifest.cases.filter(x => x.expectation === 'positive').length, 1);
    assert.equal(manifest.cases.filter(x => x.expectation === 'negative').length, 17);
    for (const entry of manifest.cases) {
        const source = fixture(entry);
        assert.equal(entry.observedResult, 'NOT_EXECUTED');
        assert.match(source, /pub gpu fnc saxpy/);
        if (entry.expectation === 'negative')
            assert.ok(expected.has(entry.expectedDiagnostic));
        else assert.equal(entry.expectedDiagnostic, null);
    }
});

test('tail guard and host-effect mutation fixtures are present in exact blobs', () => {
    const byId = Object.fromEntries(manifest.cases.map(c => [c.id, c]));
    assert.match(fixture(byId['guarded-saxpy']), /if i >= n/);
    assert.doesNotMatch(fixture(byId['unguarded-store']), /if i >= n/);
    assert.match(fixture(byId['wrong-lane']), /gpu\.global_id\(1\)/);
    assert.match(fixture(byId['reversed-tail-guard']), /if i <= n/);
    assert.match(fixture(byId['unbound-host-call']), /hostCall\(\)/);
    assert.match(fixture(byId['await-in-kernel']), /\bawait\b/);
    assert.match(fixture(byId['readonly-store']), /GpuArray<f32> out/);
    assert.match(fixture(byId['unrelated-bound']), /if i >= m/);
    assert.match(fixture(byId['constant-bound']), /if i >= 1024/);
});

test('slim-arrow u64 GpuArray ABI is pinned and mutation diagnostics are distinct', () => {
  const by = Object.fromEntries(manifest.cases.map(c => [c.id, fixture(c)]));
  assert.match(by['guarded-saxpy'], /\) -> void \{/);
  assert.match(by['guarded-saxpy'], /GpuArray<f32> mut out/);
  assert.match(by['guarded-saxpy'], /const u64 i = gpu\.global_id\(0\)/);
  assert.match(by['guarded-saxpy'], /if i >= n \{ return; \}/);
  assert.doesNotMatch(by['guarded-saxpy'], /\bfi\b/);
  assert.match(by['fat-arrow'], /\) => void \{/);
  assert.match(by['colon-return'], /\): void \{/);
  assert.match(by['signed-bound'], /i64 n/);
  assert.match(by['nonlane-index'], /out\[n\]/);
  assert.match(by['literal-index'], /out\[0\]/);
  assert.match(by['mutable-scalar'], /f32 mut alpha/);
  assert.match(by['wrong-array-element'], /GpuArray<i64> x/);
  assert.equal(manifest.execution.canonicalReturnArrow, '->');
  assert.equal(manifest.execution.canonicalDeviceArray, 'GpuArray<f32>');
  assert.equal(manifest.execution.globalIdType, 'u64');
  assert.equal(manifest.execution.mutKeywordControlsReferentWrite, true);
  assert.equal(manifest.execution.physicalGpuEnabled, false);
});
