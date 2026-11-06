import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const matrix = JSON.parse(readFileSync(path.join(root, 'contracts/atto-gpu-cuda-parity-map-v1.json'), 'utf8'));

test('CUDA-equivalent GPU capability plan stays evidence-fail-closed', () => {
  assert.equal(matrix.schema, 'attolang.gpu-cuda-parity-map/1');
  assert.equal(matrix.assertsProductionCudaParity, false);
  assert.equal(matrix.evidencePolicy.compilerGuestAndDeviceHardwareRequired, true);
  assert.equal(matrix.evidencePolicy.sourceBlobAndTreeIdentityRequired, true);
  assert.equal(matrix.evidencePolicy.nonzeroExecutedRunnerStepsRequired, true);
  assert.equal(matrix.evidencePolicy.hostOnlyResultsMayNotPromote, true);
  assert.equal(matrix.evidencePolicy.zeroStepEvidence, 'RUNNER_ADMISSION_FAILURE');
  assert.equal(matrix.evidencePolicy.backendFallback, 'FORBIDDEN');
  assert.equal(matrix.providers.length, 5);
});

test('40 independently named CUDA-like feature gaps have typed categories and zero false positives', () => {
  assert.equal(matrix.features.length, 40);
  const ids = matrix.features.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  const phases = new Set(['P0', 'P1', 'P2', 'P3']);
  const kinds = new Set(['portable', 'provider-conditional', 'vendor-conditional']);
  for (const c of matrix.features) {
    assert.match(c.id, /^(dispatch|memory|sync|compute|systems)\.[a-z0-9_]+$/);
    assert.ok(phases.has(c.phase), c.id);
    assert.ok(kinds.has(c.portability), c.id);
    assert.ok(typeof c.attoSurface === 'string' && c.attoSurface.length > 3);
    assert.ok(typeof c.cudaConcept === 'string' && c.cudaConcept.length > 3);
    assert.equal(c.sourceSupport, 'NOT_EXECUTED', c.id);
    assert.equal(c.physicalGpu, 'NOT_EXECUTED', c.id);
  }
  for (const family of ['dispatch.', 'memory.', 'sync.', 'compute.', 'systems.']) {
    assert.ok(ids.some(x => x.startsWith(family)), family);
  }
});

test('core GPU safety/feature milestones cannot be accidentally omitted', () => {
  const ids = new Set(matrix.features.map(x => x.id));
  for (const required of [
    'dispatch.explicit_launch', 'dispatch.grid_2d_3d',
    'memory.device_buffers', 'memory.explicit_copy', 'memory.shared_workgroup',
    'sync.group_barrier', 'sync.subgroup_ops', 'sync.scoped_atomics',
    'compute.fp32_fp64', 'compute.tensor_mma',
    'systems.multi_gpu', 'systems.debug_sanitize'
  ]) assert.ok(ids.has(required), required);
});
