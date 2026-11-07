import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectOwnershipReceipt, sourceDigest } from '../src/rt-ownership-admission-v1.mjs';

const contract = JSON.parse(readFileSync(new URL('../contracts/rt-ownership-admission-v1.json', import.meta.url), 'utf8'));
const sha = 'a'.repeat(40);
function specimen() {
  return {
    backend: 'java', sourceCommit: sha, sourceTree: 'b'.repeat(40), compilerCommit: 'c'.repeat(40),
    cases: contract.cases.map(c => ({
      id: c.id, sourceSha256: sourceDigest(c.source), compilerSteps: 2,
      parserAccepted: true,
      suiteSkipped: false, status: 'EXECUTED',
      ...(c.expect === 'reject'
        ? { stage: 'semantic', exitCode: 1, emittedArtifact: false, ownershipCheckerRan: true, diagnosticCode: c.reason }
        : { stage: 'guest', exitCode: 0, guestExitCode: 42, guestExecuted: true })
    }))
  };
}
const evaluate = receipt => inspectOwnershipReceipt(contract, receipt);

test('candidate corpus covers five backends and canonical ownership operators', () => {
  assert.equal(contract.status, 'candidate-unattested');
  assert.equal(contract.sourceExtension, '.atto');
  assert.deepEqual(contract.backendTargets, ['java', 'llvm', 'wasm', 'forge', 'net']);
  assert.equal(contract.cases.length, 16);
  assert.equal(new Set(contract.cases.map(c => c.id)).size, contract.cases.length);
  const whole = contract.cases.map(c => c.source).join('\n');
  for (const op of ['rt borrow', 'rt mut borrow', 'rt take', 'rt copy', 'rt share', 'rt mut share'])
    assert.ok(whole.includes(op), 'missing ' + op);
  assert.doesNotMatch(whole, /rt borrow mut|\brt (?:ref|deref|unref)\b|\basync\s+fnc\b/);
  for (const c of contract.cases) {
    assert.match(c.source, /pub (?:suspends )?fnc main\(\)/);
    assert.ok(c.source.length >= 80);
    if (c.expect === 'reject') assert.match(c.reason, /^[A-Z][A-Z0-9_]{3,63}$/);
    else assert.equal(c.expectedGuestExit, 42);
  }
  assert.ok(contract.outstandingCasesWithoutValidatedSource.length >= 5);
});

test('conditional transfer and suspension fixtures do not rely on parser-only rejection', () => {
  const selected = contract.cases.find(c => c.id === 'conditional-take-untracked');
  const suspension = contract.cases.find(c => c.id === 'borrow-across-await');
  assert.equal(selected?.reason, 'UNTRACKED_SELECTION');
  const computed = contract.cases.find(c => c.id === 'computed-take-untracked');
  assert.equal(computed?.reason, 'UNTRACKED_PLACE');
  const borrowed = contract.cases.find(c => c.id === 'share-borrowed-parameter');
  assert.equal(borrowed?.reason, 'BORROW_CANNOT_UPGRADE');
  assert.match(borrowed.source, /pub fnc wrongly_shared\(borrow int incoming\)/);
  assert.match(borrowed.source, /rt share incoming/);
  assert.match(computed.source, /rt take \(first \+ second\)/);
  assert.match(selected.source, /rt take \(true \? left : right\)/);
  assert.match(suspension.source, /pub suspends fnc main\(\)/);
  assert.doesNotMatch(suspension.source, /pub async fnc/);
});

test('reject receipts that did not prove parsing and ownership checker admission', () => {
  for (const mutate of [
    r => { r.parserAccepted = false; },
    r => { delete r.parserAccepted; },
    r => { r.ownershipCheckerRan = false; },
    r => { delete r.ownershipCheckerRan; }
  ]) {
    const receipt = specimen();
    mutate(receipt.cases.find(c => c.id === 'use-after-take'));
    assert.equal(evaluate(receipt).shapeMatched, false);
  }
  const positive = specimen();
  positive.cases.find(c => c.id === 'copy-scalar-keeps-owner').parserAccepted = false;
  assert.equal(evaluate(positive).shapeMatched, false);
});

test('synthetic shape match is never a verified pass even with claimed executed steps', () => {
  const r = evaluate(specimen());
  assert.equal(r.ok, false, 'shape matching must never authorize compiler parity');
  assert.equal(r.shapeMatched, true);
  assert.equal(r.status, 'STRUCTURALLY_MATCHED_UNATTESTED');
  assert.deepEqual(r.errors, []);
});

test('fail closed for missing, duplicate, unknown, swapped, or mutated cases', () => {
  const mutations = [
    r => { r.cases.pop(); },
    r => { r.cases.push({ ...r.cases[0] }); },
    r => { r.cases[0].id = 'unregistered'; },
    r => { r.cases[0].sourceSha256 = '0'.repeat(64); },
    r => { r.cases[0].compilerSteps = 0; },
    r => { r.cases[0].suiteSkipped = true; },
    r => { r.cases[0].status = 'NOT_EXECUTED'; },
    r => { r.cases[0].status = 'UNSUPPORTED'; },
    r => { delete r.cases[0].status; },
    r => { delete r.cases[0].suiteSkipped; },
    r => { r.cases[0].suiteSkipped = null; },
    r => { r.backend = 'js'; },
    r => { r.compilerCommit = 'unpinned'; },
    r => { r.sourceTree = null; }
  ];
  for (const mutate of mutations) {
    const r = specimen(); mutate(r);
    assert.equal(evaluate(r).shapeMatched, false);
  }
});

test('reject parser-only failure, missing semantic diagnostic and emitted artifact', () => {
  const mutations = [
    r => { r.stage = 'parser'; },
    r => { r.stage = 'unsupported'; },
    r => { r.exitCode = 0; },
    r => { r.emittedArtifact = true; },
    r => { r.diagnosticCode = 'SYNTAX_ERROR'; },
    r => { delete r.diagnosticCode; }
  ];
  for (const mutate of mutations) {
    const receipt = specimen(); mutate(receipt.cases.find(c => c.id === 'use-after-take'));
    assert.equal(evaluate(receipt).shapeMatched, false);
  }
});

test('reject false positives, compiler-only acceptance and wrong guest exit', () => {
  const mutations = [
    r => { r.stage = 'semantic'; },
    r => { r.guestExecuted = false; },
    r => { r.guestExitCode = 0; },
    r => { r.exitCode = 1; }
  ];
  for (const mutate of mutations) {
    const receipt = specimen(); mutate(receipt.cases.find(c => c.id === 'copy-scalar-keeps-owner'));
    assert.equal(evaluate(receipt).shapeMatched, false);
  }
});

test('promotion requires real compiler/guest proof independent of shape checking', () => {
  const p = contract.promotion;
  assert.equal(p.requireIndependentProvenance, true);
  assert.equal(p.requireExactCommitAndTree, true);
  assert.equal(p.requireStepfulCompilation, true);
  assert.equal(p.requireSemanticOwnershipDiagnostic, true);
  assert.equal(p.rejectParserOnlyEvidence, true);
  assert.equal(p.requirePositiveGuestExecution, true);
  assert.equal(p.allowZeroStepAsPassing, false);
  assert.equal(p.allowSourceFreeHostModelAsPassing, false);
});

test('invalid, reduced or relaxed contract cannot attest even the receipt shape', () => {
  const clone = () => structuredClone(contract);
  const mutations = [
    c => { c.schemaVersion = 2; },
    c => { c.sourceExtension = '.ores'; },
    c => { c.cases = []; },
    c => { c.cases.push({ ...c.cases[0] }); },
    c => { c.cases[0] = null; },
    c => { c.cases[0].source = null; },
    c => { c.cases[0].id = '__proto__'; },
    c => { c.cases[0].id = { toString: () => 'copy-scalar-keeps-owner' }; },
    c => { c.cases.find(x => x.expect === 'reject').reason = { toString: () => 'OWNER_MOVED' }; },
    c => { c.cases.find(x => x.expect === 'reject').reason = null; },
    c => { c.cases.find(x => x.expect === 'accept').expectedGuestExit = NaN; },
    c => { c.backendTargets.pop(); },
    c => { c.backendTargets = ['java', 'java', 'wasm', 'forge', 'net']; },
    c => { c.promotion.requireIndependentProvenance = false; },
    c => { c.promotion.requireBackendSpecificArtifacts = false; },
    c => { c.promotion.allowZeroStepAsPassing = true; }
  ];
  for (const mutate of mutations) {
    const candidate = clone();
    mutate(candidate);
    const result = inspectOwnershipReceipt(candidate, specimen());
    assert.equal(result.ok, false);
    assert.equal(result.shapeMatched, false);
    assert.equal(result.status, 'INVALID_CONTRACT');
    assert.ok(result.errors.length > 0);
  }
});

test('receipt contents never gain trust from user-supplied step counts or object values', () => {
  const claimed = specimen();
  claimed.cases.forEach(c => { c.compilerSteps = 9001; });
  const r = evaluate(claimed);
  assert.equal(r.shapeMatched, true);
  assert.equal(r.ok, false);
  assert.equal(r.status, 'STRUCTURALLY_MATCHED_UNATTESTED');

  for (const modify of [
    r => { r.compilerCommit = { toString: () => 'c'.repeat(40) }; },
    r => { r.sourceTree = { toString: () => 'b'.repeat(40) }; },
    r => { r.cases[0].sourceSha256 = { toString: () => sourceDigest(contract.cases[0].source) }; },
    r => { r.cases[0].compilerSteps = Number.MAX_SAFE_INTEGER + 1; }
  ]) {
    const specimenReceipt = specimen();
    modify(specimenReceipt);
    const observed = evaluate(specimenReceipt);
    assert.equal(observed.ok, false);
    assert.equal(observed.shapeMatched, false);
  }
});
