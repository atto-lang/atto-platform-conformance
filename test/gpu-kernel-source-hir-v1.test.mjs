import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = JSON.parse(readFileSync(path.join(root, 'contracts/atto-gpu-kernel-source-hir-v1.json'), 'utf8'));
const backends = ['java', 'llvm', 'net', 'wasm', 'forge', 'cranelift', 'js'];
const gitBlob = bytes => createHash('sha1')
  .update(Buffer.from(`blob ${bytes.length}\0`))
  .update(bytes).digest('hex');
const source = c => {
  assert.match(c.path, /^fixtures\/gpu-kernel-v1\/(?:positive|negative)-[a-z0-9-]+\.atto$/);
  const file = path.join(root, c.path);
  const st = lstatSync(file);
  assert.ok(st.isFile() && !st.isSymbolicLink() && st.nlink === 1);
  const bytes = readFileSync(file);
  assert.ok(bytes.length > 0 && bytes.length < 65536);
  assert.match(c.gitBlobSha, /^[a-f0-9]{40}$/);
  assert.equal(gitBlob(bytes), c.gitBlobSha, 'Git blob identity');
  return bytes.toString('utf8');
};

test('G1c source kernel manifest is explicitly non-executable', () => {
  assert.equal(m.schema, 'attolang.gpu-kernel-source-hir/1');
  assert.equal(m.state, 'SOURCE_TYPED_SUBSET_NOT_EXECUTABLE');
  assert.equal(m.source.grammar, 'pub gpu fnc');
  assert.equal(m.source.kernelAst, 'Ast.GpuKernelDecl');
  assert.equal(m.source.evidence, 'TYPED_SOURCE_ONLY_NOT_EXECUTABLE');
  for (const proof of ['hostFunctionRegistration', 'kernelDispatch', 'runtimeFallback',
      'typedDeviceIr', 'effectClosureProof', 'tailSafetyProof',
      'deviceBufferOwnershipProof', 'providerGenerationFenceProof'])
    assert.equal(m.source[proof], false, `${proof} must not be promoted`);
  assert.deepEqual(Object.keys(m.backendEvidence).sort(), backends.sort());
  for (const backend of backends)
    assert.deepEqual(m.backendEvidence[backend], {
      nativeCompiler: 'NOT_EXECUTED', guest: 'NOT_EXECUTED', physicalGpu: 'NOT_EXECUTED'
    });
});

test('all exact Git blobs are pinned and no unearned compiler evidence appears', () => {
  assert.equal(m.cases.length, 7);
  assert.equal(new Set(m.cases.map(c => c.id)).size, 7);
  assert.equal(new Set(m.cases.map(c => c.path)).size, 7);
  assert.equal(m.cases.filter(c => c.expectation === 'positive').length, 1);
  assert.equal(m.cases.filter(c => c.expectation === 'negative').length, 6);
  for (const c of m.cases) {
    assert.equal(c.observedResult, 'NOT_EXECUTED');
    assert.equal(c.expectedDiagnostic === null, c.expectation === 'positive');
    if (c.expectedDiagnostic !== null) assert.match(c.expectedDiagnostic, /^GPU-KERNEL-00[256]$/);
    source(c);
  }
});

test('source shape distinguishes typed kernel from CPU function and effectful negatives', () => {
  const cases = new Map(m.cases.map(c => [c.id, c]));
  const positive = source(cases.get('saxpy-typed'));
  assert.match(positive, /pub gpu fnc saxpy\(/);
  assert.match(positive, /GpuReadBuffer<f32> x/);
  assert.match(positive, /GpuWriteBuffer<f32> out/);
  assert.match(positive, /gpu\.global_id\(0\)/);
  assert.match(positive, /out\[i\] = alpha \* x\[i\] \+ y\[i\]/);
  assert.doesNotMatch(positive, /<<<|>>>/);
  for (const [id, diagnostic, regex] of [
    ['host-call', 'GPU-KERNEL-006', /hostCall\(\)/],
    ['readonly-store', 'GPU-KERNEL-005', /GpuReadBuffer<f32> out/],
    ['writeonly-load', 'GPU-KERNEL-005', /GpuWriteBuffer<f32> x/],
    ['scalar-mismatch', 'GPU-KERNEL-002', /int alpha/],
    ['invalid-global-axis', 'GPU-KERNEL-006', /gpu\.global_id\(3\)/],
    ['await-in-kernel', 'GPU-KERNEL-006', /await pending/]
  ]) {
    const c = cases.get(id);
    assert.equal(c.expectedDiagnostic, diagnostic);
    assert.match(source(c), regex);
  }
});

// These tests validate manifest/source identity only, NOT compiler or GPU execution.
