import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyFiveTargetEvidence} from '../verification/five-target-evidence-v1.mjs';

const path = new URL('../contracts/v1/five-target-actor-layout-evidence-20261021.json', import.meta.url);
const load = async () => JSON.parse(await readFile(path,'utf8'));

test('five uniquely identified backends are pinned and not certified by prototypes',async () => {
  const matrix = await load();
  assert.deepEqual(verifyFiveTargetEvidence(matrix),{targets:5,guestCertified:false});
  assert.equal(matrix.backends.length,5);
  assert.deepEqual([...new Set(matrix.backends.map(b => b.id))].sort(),
    ['dotnet','graalvm','javascript','llvm','wasm']);
  for (const backend of matrix.backends) {
    assert.equal(backend.evidence.generatedGuestExecuted,false);
    assert.equal(backend.evidence.stepfulCiObserved,false);
  }
});

test('identity, SHA, missing evidence and fake certification fail closed',async () => {
  const original = await load();
  const modify = fn => {const m = structuredClone(original); fn(m); return m;};
  assert.throws(() => verifyFiveTargetEvidence(
    modify(m => {m.backends[0].commit = 'main';})));
  assert.throws(() => verifyFiveTargetEvidence(
    modify(m => {m.backends[0].repository = m.backends[1].repository;})));
  assert.throws(() => verifyFiveTargetEvidence(
    modify(m => {m.backends[0].id = m.backends[1].id;})));
  assert.throws(() => verifyFiveTargetEvidence(
    modify(m => {delete m.backends[0].evidence.stepfulCiObserved;})));
  assert.throws(() => verifyFiveTargetEvidence(
    modify(m => {m.certification.fiveTargetSourceGuestParity = true;})));
  assert.throws(() => verifyFiveTargetEvidence(
    modify(m => {m.noPrivateExportWithoutApproval = false;})));
  assert.throws(() => verifyFiveTargetEvidence(
    modify(m => {m.backends[0].evidence.generatedGuestExecuted = true;})));
});
