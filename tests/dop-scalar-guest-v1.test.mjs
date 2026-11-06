import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateDopGuestReceipt } from '../verification/dop-scalar-guest-v1.mjs';

const manifest = JSON.parse(readFileSync(new URL(
  '../contracts/dop-scalar-guest-v1/manifest.json', import.meta.url), 'utf8'));
const fixture = readFileSync(new URL('../fixtures/dop-scalar-guest-v1/soa-int-update.atto', import.meta.url));
const maxI64 = (1n << 63n) - 1n;
const minI64 = -(1n << 63n);
function checkedAdd(a, b) {
  const result = a + b;
  if (result > maxI64 || result < minI64) throw new RangeError('signed-i64-overflow');
  return result;
}

// Standalone host mathematical oracle: no .atto parsing, compilation or guest codegen.
function referenceRun(kind, rows, sweeps) {
  const aos = kind === 'aos' ? Array.from({length: rows}, (_, i) => ({p: BigInt(i), v: 2n})) : null;
  const soa = kind === 'soa' ? {
    p: Array.from({length: rows}, (_, i) => BigInt(i)),
    v: Array.from({length: rows}, () => 2n)
  } : null;
  const blocks = kind === 'aosoa-16' ? Array.from({length: Math.ceil(rows / 16)}, (_, block) => {
    const width = Math.min(16, rows - block * 16);
    return {p: Array.from({length: width}, (_, offset) => BigInt(block * 16 + offset)),
      v: Array.from({length: width}, () => 2n)};
  }) : null;
  if (!aos && !soa && !blocks) throw new Error('unknown-layout');
  const position = i => aos ? aos[i].p : soa ? soa.p[i] : blocks[Math.floor(i / 16)].p[i % 16];
  const velocity = i => aos ? aos[i].v : soa ? soa.v[i] : blocks[Math.floor(i / 16)].v[i % 16];
  const setPosition = (i, val) => {
    if (aos) aos[i].p = val;
    else if (soa) soa.p[i] = val;
    else blocks[Math.floor(i / 16)].p[i % 16] = val;
  };
  for (let step = 0; step < sweeps; step++) {
    for (let row = 0; row < rows; row++) {
      setPosition(row, checkedAdd(position(row), velocity(row)));
    }
  }
  let checksum = 0n;
  for (let row = 0; row < rows; row++) checksum = checkedAdd(checksum, position(row));
  return {checksum, first: rows ? position(0) : null,
    last: rows ? position(rows - 1) : null, lastVelocity: rows ? velocity(rows - 1) : null};
}

test('pinned .atto fixture is byte-identical to LLVM PR #1308, not a fabricated interpreter', () => {
  const blob = createHash('sha1').update('blob ' + fixture.length + '\0').update(fixture).digest('hex');
  assert.equal(manifest.fixture.gitBlobSha, 'aedc778e3e8dd2940600f047540c159b0129830a');
  assert.equal(blob, manifest.fixture.gitBlobSha);
  assert.match(fixture.toString('utf8'), /pub routine main\(\): int/);
  assert.match(fixture.toString('utf8'), /new Array<int>\(\)/);
  assert.equal(manifest.classification, 'NORMATIVE_TARGET_AND_HOST_ORACLE_NOT_GUEST_EXECUTION');
});

test('backend guest claims remain NOT_EXECUTED without independent exact-head receipts', () => {
  assert.deepEqual(Object.keys(manifest.backendGuestEvidence).sort(), ['java','llvm','wasm','forge','net'].sort());
  for (const state of Object.values(manifest.backendGuestEvidence)) assert.equal(state, 'NOT_EXECUTED');
  assert.equal(manifest.cases[0].stage, 'GUEST_EXECUTED_REQUIRED');
  assert.equal(manifest.cases[1].stage, 'HOST_REFERENCE_ONLY');
});

test('AoS/SoA/AoSoA-16 host oracle matches scalar sum at empty and chunk boundaries', () => {
  for (const rows of [0, 1, 15, 16, 17, 31, 32, 33, 257, 32768]) {
    for (const sweeps of [0, 1, 10]) {
      const expected = BigInt(rows) * BigInt(rows - 1) / 2n + BigInt(rows) * 2n * BigInt(sweeps);
      for (const layout of manifest.referenceLayouts) {
        const result = referenceRun(layout, rows, sweeps);
        assert.equal(result.checksum, expected, layout + '/' + rows + '/' + sweeps);
        if (rows) {
          assert.equal(result.first, BigInt(sweeps * 2));
          assert.equal(result.last, BigInt(rows - 1 + sweeps * 2));
          assert.equal(result.lastVelocity, 2n);
        } else {
          assert.equal(result.first, null);
          assert.equal(result.last, null);
        }
      }
    }
  }
  assert.equal(referenceRun('soa', manifest.workload.rows, manifest.workload.sweeps).checksum.toString(),
    manifest.workload.expectedChecksum);
});

test('host-only i64 checked arithmetic rejects overflow without wrapping', () => {
  assert.equal(checkedAdd(maxI64, 0n), maxI64);
  assert.equal(checkedAdd(minI64, 0n), minI64);
  assert.throws(() => checkedAdd(maxI64, 1n), /signed-i64-overflow/);
  assert.throws(() => checkedAdd(minI64, -1n), /signed-i64-overflow/);
});

const head = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const validJob = {runId: 11223, runnerId: 11, conclusion: 'success', steps: [
  {id: 'checkout-head', number: 1, conclusion: 'success', startedAt: '2026-11-06T10:00:00Z', completedAt: '2026-11-06T10:00:01Z'},
  {id: 'compile-guest', number: 2, conclusion: 'success', startedAt: '2026-11-06T10:00:01Z', completedAt: '2026-11-06T10:00:02Z'},
  {id: 'execute-guest', number: 3, conclusion: 'success', startedAt: '2026-11-06T10:00:02Z', completedAt: '2026-11-06T10:00:03Z'}
]};
const shapeOnlyPositiveControl = {
  contract: manifest.contract, backend: 'llvm', caseId: 'primitive-columns-atto-guest',
  status: 'PASSED', sourceHeadSha: head, checkoutHeadSha: head,
  sourceTreeSha: head, fixtureGitBlobSha: manifest.fixture.gitBlobSha,
  compilerSha256: digest, fixtureSha256: digest, guestArtifactSha256: digest,
  toolchain: 'Clang', command: 'actual-compiler-then-native-exec', discoveredTests: 1,
  executedTests: 1, guestExecuted: true, executionStage: 'native-guest', guestExitCode: 0,
  ciJob: validJob
};

test('synthetic shape-only control is accepted by the receipt schema, NOT attested as execution', () => {
  assert.deepEqual(validateDopGuestReceipt(shapeOnlyPositiveControl, manifest), []);
});

test('fail closed on zero-step CI, incorrect head, host-only, skipped tests, missing hashes', () => {
  const overrides = [
    {ciJob: {...validJob, runnerId: null, steps: null}},
    {ciJob: {...validJob, conclusion: 'failure'}},
    {checkoutHeadSha: 'c'.repeat(40)},
    {executionStage: 'host-model'},
    {discoveredTests: 0, executedTests: 0},
    {compilerSha256: null},
    {guestArtifactSha256: null},
    {fixtureGitBlobSha: 'f'.repeat(40)},
    {guestExecuted: false},
    {guestExitCode: 1},
    {ciJob: {...validJob, steps: validJob.steps.slice(0, 2)}},
    {ciJob: {...validJob, steps: [...validJob.steps, validJob.steps[1]]}}
  ];
  for (const mutation of overrides) {
    const bad = {...shapeOnlyPositiveControl, ...mutation};
    assert.notDeepEqual(validateDopGuestReceipt(bad, manifest), [], JSON.stringify(mutation));
  }
});

test('unsupported requires executed rejection, compiler diagnostic and zero executable artifacts', () => {
  const unsupported = {...shapeOnlyPositiveControl, status: 'UNSUPPORTED',
    guestExecuted: false, guestArtifactSha256: null,
    compilerDiagnostic: 'DOP_UNSUPPORTED',
    ciJob: {...validJob, steps: [...validJob.steps.slice(0, 2),
      {...validJob.steps[2], id: 'assert-rejection'}]}};
  assert.deepEqual(validateDopGuestReceipt(unsupported, manifest), []);
  assert.ok(validateDopGuestReceipt({...unsupported, guestArtifactSha256: digest}, manifest).length);
  assert.ok(validateDopGuestReceipt({...unsupported, compilerDiagnostic: ''}, manifest).length);
  assert.ok(validateDopGuestReceipt({...unsupported, ciJob: validJob}, manifest).length);
});

test('NOT_EXECUTED cannot assert guest execution or executable artifacts', () => {
  const notExecuted = {contract: manifest.contract, backend: 'wasm',
    caseId: 'primitive-columns-atto-guest', status: 'NOT_EXECUTED'};
  assert.deepEqual(validateDopGuestReceipt(notExecuted, manifest), []);
  assert.ok(validateDopGuestReceipt({...notExecuted, guestExecuted: true}, manifest).length);
  assert.ok(validateDopGuestReceipt({...notExecuted, guestArtifactSha256: digest}, manifest).length);
});

test('FAILED records require observed CI and can describe a genuinely failed compiler step', () => {
  const failed = {...shapeOnlyPositiveControl, status: 'FAILED', guestExecuted: false,
    guestArtifactSha256: null, failureReason: 'compiler rejected valid source',
    ciJob: {...validJob, conclusion: 'failure', steps: [validJob.steps[0],
      {...validJob.steps[1], conclusion: 'failure'}]}};
  assert.deepEqual(validateDopGuestReceipt(failed, manifest), []);
  assert.ok(validateDopGuestReceipt({...failed, failureReason: ''}, manifest).length);
  assert.ok(validateDopGuestReceipt({...failed, ciJob: {...failed.ciJob, steps: null}}, manifest).length);
});
