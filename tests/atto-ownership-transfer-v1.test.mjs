import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const contract = JSON.parse(readFileSync(
  new URL('../contracts/atto-ownership-transfer-v1.json', import.meta.url), 'utf8'));
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const targets = ['java','llvm','wasm','forge','net'];

test('canonical rt take and rt mut borrow; no move keyword', () => {
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.status, 'candidate-unattested');
  assert.deepEqual(contract.backendTargets, targets);
  assert.equal(contract.syntax.take, 'rt take x');
  assert.equal(contract.syntax.mutableBorrow, 'rt mut borrow x');
  assert.equal(contract.syntax.standaloneMoveKeyword, false);
  assert.deepEqual(Object.keys(contract.evidence), targets);
  for (const backend of targets) assert.equal(contract.evidence[backend], 'unattested');
});
test('exact 16-case portable .atto corpus has semantic positive controls', () => {
  assert.equal(contract.cases.length, 16);
  assert.equal(new Set(contract.cases.map(c => c.id)).size, 16);
  assert.deepEqual([...new Set(contract.cases.map(c => c.expectation))].sort(), ['accept','reject']);
  for (const c of contract.cases) {
    assert.match(c.id, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
    assert.equal(c.fixture, 'fixtures/atto-ownership-transfer-v1/' + c.id + '.atto');
    assert.equal(c.attestation, 'unattested');
    assert.equal(c.requiredEvidence, c.expectation === 'reject'
      ? 'semantic-ownership-or-mutability-diagnostic'
      : c.phase === 'compiler-runtime' ? 'real-compiler-and-guest-execution'
      : 'real-compiler-typecheck');
    const source = read(c.fixture);
    assert.ok(source.length >= 80, c.id);
    assert.match(source, /\bfnc\s+(?:main|check|consume|inspect)\s*\(/, c.id);
    assert.doesNotMatch(source, /\brt\s+borrow\s+mut\b/, c.id);
    assert.doesNotMatch(source, /\bmove\s*\|/, c.id);
  }
  const ids = new Set(contract.cases.map(c => c.id));
  for (const id of ['take-local-ok','take-use-after-reject','take-twice-reject',
      'val-fixed-mutable-ok','val-rebind-reject','let-readonly-mutation-reject',
      'let-mut-rebind-ok','mut-borrow-canonical-ok','borrow-task-capture-reject',
      'task-owner-moved-at-submit-reject','task-copy-scalar-ok',
      'callback-owned-capture-reject','callback-copy-scalar-ok',
      'channel-double-take-reject','actor-self-task-capture-reject',
      'borrow-across-await-reject']) assert.ok(ids.has(id), id);
  assert.match(read('fixtures/atto-ownership-transfer-v1/take-local-ok.atto'), /rt take original/);
  assert.match(read('fixtures/atto-ownership-transfer-v1/mut-borrow-canonical-ok.atto'), /rt mut borrow n/);
  assert.match(read('fixtures/atto-ownership-transfer-v1/callback-owned-capture-reject.atto'), /nb cb writech/);
});
test('only genuine semantic compiler and guest receipts promote parity', () => {
  for (const k of ['identicalFixtureIdsAcrossFiveBackends','realCompilerTypecheckRequired',
    'semanticDiagnosticRequiredForRejections','actualGuestRequiredForRuntimeCases',
    'exactSourceHeadTreeAndBlobRequired','nonzeroExecutedStepsRequired',
    'javaAndNetAotRequired','llvmAndForgeSanitizersRequired','wasmWorkerRequired',
    'privateSourceMirrorRequiresSecurityApproval'])
    assert.equal(contract.promotion[k], true, k);
  for (const k of ['parserOnlyRejectionCounts','hostOracleCountsAsGuest'])
    assert.equal(contract.promotion[k], false, k);
  const doc = read('docs/ATTO_OWNERSHIP_TRANSFER_V1.md');
  for (const s of ['at **submission**','linearizable','semantic ownership','unattested'])
    assert.ok(doc.toLowerCase().includes(s.toLowerCase()), s);
});

test('failed channel send guest ownership recovery remains an explicit release blocker', () => {
  const gap = contract.knownGuestRecoveryGap;
  assert.equal(gap.status, 'BLOCKED_UNPROVEN');
  assert.match(gap.issue, /\/issues\/2920$/);
  assert.equal(gap.sourceFreeModelIsNotGuestEvidence, true);
  assert.deepEqual(gap.requiredCases, [
    'full', 'closed', 'pending-cancel', 'pending-timeout',
    'cancel-vs-commit', 'close-vs-commit', 'rendezvous'
  ]);
  assert.match(gap.requiredProof, /COMMITTED or RETURNED/);
  const doc = read('docs/ATTO_OWNERSHIP_TRANSFER_V1.md');
  assert.match(doc, /issues\/2920/);
  assert.match(doc, /not yet proven/i);
});

test('host-only immediate receipt cannot clear the async guest ownership blocker', () => {
  const candidate = contract.hostImmediateOwnedSendCandidate;
  assert.deepEqual(candidate.outcomes, ['COMMITTED', 'BACKPRESSURE', 'CLOSED']);
  assert.match(candidate.api, /tryWriteOwned/);
  assert.equal(candidate.implementationStatus, 'JAVA_HOST_CANDIDATE_NOT_EXECUTED');
  assert.equal(candidate.guestTypecheckerLowering, 'NOT_IMPLEMENTED');
  assert.equal(candidate.pendingAsyncEscrow, 'NOT_IMPLEMENTED');
  assert.equal(contract.knownGuestRecoveryGap.status, 'BLOCKED_UNPROVEN');
  assert.match(read('docs/ATTO_OWNERSHIP_TRANSFER_V1.md'),
    /host-only, non-parking immediate/);
});
