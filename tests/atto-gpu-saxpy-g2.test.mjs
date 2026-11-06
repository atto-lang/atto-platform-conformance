import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const manifest = JSON.parse(readFileSync(new URL('../contracts/atto-gpu-saxpy-g2.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../fixtures/gpu-saxpy-g2/saxpy.atto', import.meta.url));
const artifact = readFileSync(new URL('../fixtures/gpu-saxpy-g2/saxpy.cl', import.meta.url));
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('machine-readable G2 manifest only claims restricted unmerged device-source lowering', () => {
  assert.equal(manifest.schema, 'attolang.gpu-saxpy-device-source-g2/1');
  assert.equal(manifest.status, 'RESTRICTED_COMPILER_PROTOTYPE_UNMERGED');
  assert.equal(manifest.localValidation.hostRegressionCount, 28);
  assert.equal(manifest.localValidation.observed, 'LOCAL_ONLY');
  assert.equal(manifest.llvmTool.gitBlobSha, 'd699f3c30eb0ffab4ebd18f8e280f2addc12dcc7');
  assert.deepEqual(manifest.invariants, {
    noCpuFallback:true, noHostLaunchClaim:true, noProviderAuthorityFromSource:true,
    noPhysicalGpuClaimFromSpir64Ir:true, noArtifactOnRejectedKernel:true, f32ContractedFma:false,
  });
});

test('canonical .atto source and OpenCL C have pinned Git object identity', () => {
  assert.equal(gitBlob(source), manifest.fixture.gitBlobSha);
  assert.equal(gitBlob(artifact), manifest.openclGolden.gitBlobSha);
  assert.equal(sha256(artifact), manifest.openclGolden.sha256);
});

test('G2 kernel is an f32 checked-bound device function, not host launch', () => {
  const atto = source.toString('utf8');
  assert.match(atto, /pub gpu fnc saxpy/);
  assert.match(atto, /gpu\.global_id\(0\)/);
  assert.match(atto, /if i >= n \{ return; \}/);
  assert.match(atto, /GpuArray<f32> mut out/);
  assert.doesNotMatch(atto, /launch |gpu task|<<<|>>>/);
});

test('OpenCL golden retains a bounded SIMT kernel and non-FMA policy', () => {
  const cl = artifact.toString('utf8');
  assert.match(cl, /#pragma OPENCL FP_CONTRACT OFF/);
  assert.match(cl, /__kernel void attolang_saxpy_v1/);
  assert.match(cl, /const ulong i = get_global_id\(0\)/);
  assert.match(cl, /if \(i >= n\) return;/);
  assert.match(cl, /out\[i\] = scale \* x\[i\] \+ y\[i\]/);
  assert.doesNotMatch(cl, /printf|barrier|atomic|memcpy|clEnqueue|<<<|>>>/);
});

test('compiler/guest/hardware evidence stays unexecuted until receipts are produced', () => {
  for (const [category,state] of Object.entries(manifest.evidence)) {
    assert.equal(state, 'NOT_EXECUTED', `${category} cannot be promoted by host-only evidence`);
  }
  assert.equal(manifest.localValidation.spir64Target, 'spir64-unknown-unknown');
});
