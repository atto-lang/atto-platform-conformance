import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = JSON.parse(readFileSync(
  path.join(root, 'contracts/atto-gpu-typed-hir-forgery-v1.json'), 'utf8'));
const sha40 = /^[0-9a-f]{40}$/;

test('forged typed-HIR proof records remain source-only and non-executable', () => {
  assert.equal(evidence.schema, 'attolang.gpu-typed-hir-forgery-source-v1');
  assert.equal(evidence.evidence, 'TYPED_SOURCE_STRUCTURAL_VALIDATION_NOT_EXECUTABLE');
  assert.equal(evidence.javaPullRequest, 2610);
  assert.match(evidence.javaHeadSha, sha40);
  assert.match(evidence.javaTreeSha, sha40);
  assert.equal(evidence.javaJUnit.status, 'NOT_EXECUTED');
  assert.equal(evidence.javaJUnit.executedSteps, null);
  assert.equal(evidence.javaJUnit.sourceTreeIndependentlyVerified, false);
  assert.equal(evidence.javaJUnit.sourceTestsAuthored, 21);
  assert.equal(evidence.javaJUnit.expectedDenied, 20);
  assert.equal(evidence.javaJUnit.expectedNonExecutableControl, 1);
  assert.match(evidence.mergePromotion, /^BLOCKED_/);
  for (const status of Object.values(evidence.backendStatus))
    assert.equal(status, 'NOT_EXECUTED');
  for (const capability of ['compilerIssuedTypeIdentity', 'authenticatedProviderAllocation',
    'generationFencedLoan', 'physicalDeviceExecution', 'implicitCpuFallback',
    'dispatchAuthorized'])
    assert.equal(evidence.safetyClaims[capability], false, capability);
});

test('each expected mutation has a distinct ID and exact source Git identity', () => {
  const files = Object.values(evidence.javaFiles);
  assert.equal(files.length, 4);
  assert.equal(evidence.javaJUnit.integratedSourceCapacityCasesAuthored, 22);
  assert.equal(evidence.javaJUnit.integratedSourceCapacityForgeryCasesAdded, 4);
  assert.equal(evidence.javaJUnit.latestHeadBuildStatus, 'NOT_EXECUTED');
  assert.equal(evidence.javaJUnit.latestHeadExecutedSteps, null);
  for (const f of files) {
    assert.match(f.blob, sha40);
    assert.match(f.path, /^src\/(?:main|test)\/java\/dev\/oreslang\//);
  }
  assert.equal(new Set(files.map(f => f.blob)).size, 4);
  assert.equal(evidence.cases.length, 21);
  assert.equal(new Set(evidence.cases.map(c => c.method)).size, 21);
  assert.equal(evidence.cases[0].expectation, 'NON_EXECUTABLE_SOURCE_CONTROL');
  assert.equal(evidence.cases.filter(c =>
    c.expectation === 'GPU-KERNEL-010_REJECTION').length, 20);
  for (const c of evidence.cases) {
    assert.match(c.method, /^[A-Za-z][A-Za-z0-9_]+$/);
    assert.equal(c.observed, 'NOT_EXECUTED');
  }
});

// This checks a documented manifest only. It cannot compile private Java
// sources, validate PR tree integrity independently or execute a GPU.
