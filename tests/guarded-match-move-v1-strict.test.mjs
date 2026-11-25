import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateGuardedMatchMoveRegistry } from '../src/guarded-match-move-v1.mjs';

const manifest = JSON.parse(readFileSync(new URL(
  '../contracts/v2/guarded-match-move-v1.json', import.meta.url), 'utf8'));

const clone = () => structuredClone(manifest);

test('guarded match registry is candidate-only and cannot certify guest execution', () => {
  assert.deepEqual(validateGuardedMatchMoveRegistry(manifest), {
    contract: 'guarded-match-move-v1',
    sourceCommit: '56a5ca3a67b13388e4b7e441f10743005e8340b2',
    caseCount: 3,
    executedBackends: 0,
  });
});

test('strict schema denies forged PASS fields, unknown keys and source drift', () => {
  const attacks = [
    ['root-level certification', d => { d.certified = true; }],
    ['root-level arbitrary source', d => { d.sourceText = 'private source'; }],
    ['unknown evidence receipt', d => { d.receipt = { result: 'PASS' }; }],
    ['backend extra PASS', d => { d.cases[0].backendEvidence.cuda = 'PASS'; }],
    ['backend fabricated PASS', d => { d.cases[0].backendEvidence.java = 'PASS'; }],
    ['case-level unreviewed PASS', d => { d.cases[0].verified = true; }],
    ['case-level hidden source', d => { d.cases[1].sourceText = 'secret'; }],
    ['remove identity key', d => { delete d.sourcePr; }],
    ['stale exact-source head', d => { d.sourceCommit = '0'.repeat(40); }],
    ['wrong fixture blob', d => { d.cases[2].gitBlob = '0'.repeat(40); }],
    ['promote parser-only', d => { d.cases[0].parserMustAccept = false; }],
    ['skip negative codegen boundary', d => { d.cases[0].rejectBeforeCodegen = false; }],
    ['host model promoted to backend', d => { d.mergeGate.hostModelCountsAsBackend = true; }],
    ['zero-step promoted to evidence', d => { d.mergeGate.zeroStepCountsAsEvidence = true; }],
    ['fake runner ID', d => { d.existingEvidence.java.runnerId = 19; }],
    ['fake runner log', d => { d.existingEvidence.java.executedSteps = 4; }],
    ['wrong expected guest output', d => { d.cases[2].expectedStdout = '42'; }],
    ['unknown semantic field', d => { d.semanticBoundary.fakeProof = 'PASS'; }],
    ['missing backend evidence', d => { delete d.existingEvidence.net; }],
    ['reordered source fixtures', d => { d.cases.reverse(); }],
    ['missing limitation', d => { d.limitations = []; }],
  ];
  for (const [name, change] of attacks) {
    const candidate = clone();
    change(candidate);
    assert.throws(() => validateGuardedMatchMoveRegistry(candidate),
      /GUARDED_MATCH_MOVE_V1_INVALID/, name);
  }
});
