import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {verifyCurrentHeadPreflight} from '../bin/verify-critical-current-head-preflight.mjs';

const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const contract = read('../contracts/v1/critical-suspension-v1.json');
const fixture = read('../fixtures/critical-suspension-v1/java-stage1/manifest.json');
const historical = read('../evidence/critical-suspends-backend-evidence-20261101.json');
const current = read('../evidence/critical-suspends-current-head-preflight-20261102.json');
const clone = () => structuredClone(current);

test('manifest object hash and fixture bytes are pinned independently of guest claims', () => {
  const base = new URL('../fixtures/critical-suspension-v1/java-stage1/',import.meta.url);
  const gitBlob = bytes => crypto.createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + '\\0')).update(bytes).digest('hex');
  const manifestBytes = fs.readFileSync(new URL('manifest.json',base));
  assert.equal(gitBlob(manifestBytes), current.fixture.manifest_blob_sha1);
  for (const f of fixture.fixtures) {
    assert.equal(gitBlob(fs.readFileSync(new URL(f.name,base))), f.git_blob_sha1);
    assert.equal(f.verified_guest, false);
  }
});

test('current five-backend HEAD identity is a pending snapshot, not native evidence', () => {
  assert.deepEqual(verifyCurrentHeadPreflight(current, contract, fixture, historical),
    {classification:'PREPARED_NOT_EXECUTED',backends:5,guest_receipts:0});
  assert.notEqual(current.entries.find(x => x.backend === 'java-graal').commit,
    historical.entries.find(x => x.backend === 'java-graal').commit);
  assert.ok(current.entries.every(x => x.phase === 'NOT_EXECUTED'));
});

test('old runner-admission history is immutable: newest head cannot retroactively own old jobs', () => {
  const badHistory = structuredClone(historical);
  badHistory.entries[0].execution = 'PASS';
  assert.throws(() => verifyCurrentHeadPreflight(current, contract, fixture, badHistory),
    /historical/);
  const wrong = clone();
  wrong.entries[0].commit = historical.entries[0].commit;
  assert.throws(() => verifyCurrentHeadPreflight(wrong, contract, fixture, historical),
    /fixture head/);
});

test('source/tree, repository, PR, and runner identities cannot be forged', () => {
  for (const [field, value] of [
    ['commit','short'], ['tree',null], ['repository','other/repo'],
    ['pr',999], ['run_id',0], ['job_id',0]
  ]) {
    const snap = clone();
    snap.entries[0][field] = value;
    assert.throws(() => verifyCurrentHeadPreflight(snap,contract,fixture,historical), field);
  }
  const dupe = clone();
  dupe.entries[0].backend = 'llvm';
  assert.throws(() => verifyCurrentHeadPreflight(dupe,contract,fixture,historical), /duplicate/);
});

test('zero-step source jobs cannot be relabelled as admitted compiler or guest passes', () => {
  for (const [field, value] of [
    ['phase','PASS'], ['executed_steps',1], ['executed_steps',null],
    ['compiler_invoked',true], ['guest_verified',true]
  ]) {
    const snap=clone();
    snap.entries[0][field]=value;
    assert.throws(() => verifyCurrentHeadPreflight(snap,contract,fixture,historical),
      /zero-step/);
  }
  for (const field of ['compiler_sha256','native_guest_executed','attested',
                       'cross_backend_parity','runner_admitted']) {
    const snap=clone();
    snap.entries[0][field] = true;
    assert.throws(() => verifyCurrentHeadPreflight(snap,contract,fixture,historical),
      /unexpected evidence field/);
  }
});

test('private-source mirror cannot be authorized by a runner-capacity canary', () => {
  for (const [field,value] of [
    ['private_source_mirroring','APPROVED'],
    ['source_main_protected',true],
    ['source_free_capacity_canary_is_authorization',true],
    ['required_open_incidents',[]]
  ]) {
    const snap=clone();
    snap.security[field]=value;
    assert.throws(() => verifyCurrentHeadPreflight(snap,contract,fixture,historical));
  }
});

test('fixture provenance remains source identity only: no guest promotion', () => {
  const forged=structuredClone(fixture);
  forged.target_verified.java_graal=true;
  assert.throws(() => verifyCurrentHeadPreflight(current,contract,forged,historical),
    /guest verification/);
  const bad=clone();
  bad.fixture.verified_current_java_head='f'.repeat(40);
  assert.throws(() => verifyCurrentHeadPreflight(bad,contract,fixture,historical),
    /fixture head/);
  const wrongOrigin=clone();
  wrongOrigin.fixture.origin_java_head='a'.repeat(40);
  assert.throws(() => verifyCurrentHeadPreflight(wrongOrigin,contract,fixture,historical),
    /provenance/);
});
