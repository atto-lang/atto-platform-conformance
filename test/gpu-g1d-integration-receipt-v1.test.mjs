import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const receipt = JSON.parse(readFileSync(
  path.join(root, 'contracts/atto-gpu-g1d-integrated-source-v1.json'), 'utf8'));
const sha40 = /^[a-f0-9]{40}$/;

test('G1d merge-tree identity is recorded without pretending tests ran', () => {
  assert.equal(receipt.schema, 'attolang.gpu-g1d-integrated-source/1');
  assert.match(receipt.finalHeadSha, sha40);
  assert.match(receipt.finalTreeSha, sha40);
  assert.match(receipt.integrationMergeCommit, sha40);
  assert.equal(receipt.integrationMergeParents.length, 2);
  receipt.integrationMergeParents.forEach(sha => assert.match(sha, sha40));
  assert.notEqual(receipt.integrationMergeParents[0], receipt.integrationMergeParents[1]);
  assert.equal(receipt.sourceRepositoryPrivate, true);
  assert.equal(receipt.sourceKernelAndHostFootprintsOnSameHead, true);
  assert.equal(receipt.javaIntegratedJUnitStatus, 'NOT_EXECUTED');
  assert.equal(receipt.javaHostFootprintStatus, 'NOT_EXECUTED_ON_EXACT_INTEGRATION_HEAD');
  assert.equal(receipt.runnerEvidence.status, 'FAILED_RUNNER_ADMISSION');
  assert.equal(receipt.runnerEvidence.jobSteps, null);
  assert.equal(receipt.runnerEvidence.cpuCompilerExecution, false);
});

test('source-only provenance cannot be upgraded to a GPU permit', () => {
  assert.equal(receipt.nonpromoting, true);
  assert.equal(receipt.sourceExpectedAccessDerivedFromKernelSignature, true);
  assert.equal(receipt.joinedCapacityEvidence,
    'SOURCE_JOINED_CAPACITY_SHAPE_ONLY_NOT_EXECUTABLE');
  assert.equal(receipt.sourceTailGuardEvidence,
    'SOURCE_TAIL_GUARD_ONLY_NOT_EXECUTABLE');
  assert.equal(receipt.sourceLinkEvidence,
    'SOURCE_SIGNATURE_ONLY_NOT_EXECUTABLE');
  assert.equal(receipt.hostCapacityEvidence,
    'SNAPSHOT_CAPACITY_SHAPE_ONLY_NOT_EXECUTABLE');
  for (const feature of [
    'sourceBufferArgumentsStaticallyTyped', 'authenticatedProviderBufferViews',
    'deviceLoanBoundToSourceOwner', 'generationFenceVerified',
    'deviceCompletionVerified', 'physicalGpuDispatchEnabled', 'implicitCpuFallback'
  ]) assert.equal(receipt[feature], false, feature);
  assert.match(receipt.securityHold, /independent review/);
});

// Manifest/schema checks only: do not claim these execute AttoLang or a GPU.
