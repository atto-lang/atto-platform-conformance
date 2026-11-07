import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const ledger = JSON.parse(readFileSync(resolve(root, 'contracts/atto-gpu-g1-typed-frontend-v1.json'), 'utf8'));
const cases = ledger.cases;

function source(caseInfo) {
  assert.match(caseInfo.path, /^fixtures\/gpu-g1-typed-frontend\/[a-z0-9-]+\.atto$/);
  return readFileSync(resolve(root, caseInfo.path));
}
function gitBlob(buffer) {
  return createHash('sha1')
    .update(Buffer.from('blob ' + buffer.length + '\0'))
    .update(buffer)
    .digest('hex');
}

test('G1 kernel-only source corpus does not claim general launch or physical GPU execution', () => {
  assert.equal(ledger.schema, 'attolang.gpu-g1-typed-kernel-frontend/1');
  assert.equal(ledger.scope, 'restricted_kernel_only_not_general_gpu_launch');
  assert.equal(ledger.allowsAlphaRenaming, true);
  assert.equal(ledger.allowsHostLaunch, false);
  assert.equal(ledger.allowsHostCapture, false);
  assert.equal(ledger.allowsImplicitCpuFallback, false);
  assert.equal(ledger.requiresExactHeadTreeAndNonzeroExecutedSteps, true);
  assert.equal(ledger.hostedRunnerAdmission, 'RUNNER_ADMISSION_FAILURE');
  for (const evidenceKey of ['sourceExecutionEvidence', 'mainCompilerEvidence',
      'nvptxToolchainEvidence', 'physicalGpuEvidence'])
    assert.equal(ledger[evidenceKey], 'NOT_EXECUTED');
});

test('G1 fixture ledger is unique, immutable-blob-bound and unpromoted', () => {
  assert.equal(cases.length, 5);
  const seen = new Set();
  for (const entry of cases) {
    assert.equal(seen.has(entry.id), false);
    seen.add(entry.id);
    assert.equal(entry.observedResult, 'NOT_EXECUTED');
    assert.equal(entry.gitBlobSha.length, 40);
    assert.equal(gitBlob(source(entry)), entry.gitBlobSha);
  }
  assert.equal(cases.filter(c => c.expectation === 'positive').length, 1);
  assert.equal(cases.filter(c => c.expectation === 'negative').length, 4);
});

test('G1 positive fixture is alpha-renamed and kernel-only, never a host launch', () => {
  const src = source(cases.find(c => c.id === 'alpha-rename')).toString('utf8');
  assert.match(src, /pub gpu fnc saxpy\(f32 alpha,/);
  assert.match(src, /GpuArray<f32> mut destination/);
  assert.match(src, /const u64 lane = gpu\.global_id\(0\);/);
  assert.match(src, /if lane >= count \{ return; \}/);
  assert.match(src, /destination\[lane\] = alpha \* first\[lane\] \+ second\[lane\];/);
  assert.doesNotMatch(src, /\blaunch\s+saxpy\b|\bawait\s+\w+|\bsuspends\s+fnc\b/);
});

test('G1 negative fixtures target four independent compiler rejection boundaries', () => {
  const expected = {
    'bounds-guard': [/if i > n/, 'GPU-G1-SOURCE-003'],
    'host-call': [/host_log\(i\)/, 'GPU-G1-SOURCE-003'],
    'alias-output': [/GpuArray<f32> mut x/, 'GPU-G1-SOURCE-004'],
    'host-launch': [/suspends fnc run\(\)/, 'GPU-G1-SOURCE-002'],
  };
  for (const entry of cases.filter(c => c.expectation === 'negative')) {
    assert.match(source(entry).toString('utf8'), expected[entry.id][0]);
    assert.equal(entry.expectedDiagnostic, expected[entry.id][1]);
  }
});

test('No backend receives compiler/guest/device promotion from source-only fixtures', () => {
  assert.deepEqual(Object.keys(ledger.backendEvidence).sort(),
    ['cranelift', 'forge', 'java', 'js', 'llvm', 'net', 'wasm']);
  for (const backend of Object.values(ledger.backendEvidence)) {
    assert.equal(backend.sourceCompiler, 'NOT_EXECUTED');
    assert.equal(backend.guest, 'NOT_EXECUTED');
    assert.equal(backend.physicalGpu, 'NOT_EXECUTED');
  }
});
