import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditActorCI } from '../scripts/audit-actor-ci-evidence.mjs';

const llvmHead = '0072200f2feba54e2732e56d4d692740c839248f';
const confHead = '1f0213301f6cfe265a477348305e954337f6e772';
const mk = (changes = {}) => ({
  repository: 'ores-truffle-oreslang/oreslang-source.llvm',
  expected_head_sha: llvmHead,
  run: { id: 42527583441, run_attempt: 1, head_sha: llvmHead },
  jobs: [], ...changes,
});
const job = (id, steps, extras = {}) => ({
  id, name: `job-${id}`, run_id: 42527583441, conclusion: 'failure', steps,
  ...extras,
});
const step = (number, name, conclusion = 'success') => ({ number, name, conclusion });

test('StateGraph no-jobs notification remains NO_JOBS_CREATED', () => {
  const v = auditActorCI(mk({run: {id:42528128261,run_attempt:1,head_sha:llvmHead}}));
  assert.equal(v.classification, 'NO_JOBS_CREATED');
  assert.equal(v.certified, false);
});

test('LLVM exact-head two missing-step jobs are runner-admission, never compile failure', () => {
  const v = auditActorCI(mk({jobs:[job(128874510315,null),job(128874510419,null)]}));
  assert.equal(v.classification, 'ZERO_STEP_RUNNER_ADMISSION');
  assert.equal(v.jobs.length, 2);
  assert.equal(v.guest, 'NOT_EXECUTED');
});

test('empty steps are equivalent to null steps', () => {
  const v = auditActorCI(mk({jobs:[job(1,[]),job(2,null)]}));
  assert.equal(v.classification, 'ZERO_STEP_RUNNER_ADMISSION');
});

test('mixed job step states never get promoted', () => {
  const v = auditActorCI(mk({jobs:[job(1,[step(1,'Set up job')],{conclusion:'success'}),job(2,null)]}));
  assert.equal(v.classification, 'PARTIAL_NOT_EXECUTED');
  assert.equal(v.certified, false);
});

test('real compiler error stays separate from runner-admission failures', () => {
  const v = auditActorCI(mk({jobs:[job(1,[step(1,'checkout'),step(2,'cmake','failure')])]}));
  assert.equal(v.classification, 'EXECUTED_FAILURE');
  assert.equal(v.jobs[0].executed_steps, 2);
});

test('successful claimed compiler, guest, and sanitizer steps still require receipts', () => {
  const v = auditActorCI(mk({jobs:[job(1,[step(1,'Compile Oreslang'),step(2,'Guest exit 42'),step(3,'ASan pass')],{conclusion:'success'})]}));
  assert.equal(v.classification, 'STEPS_EXECUTED_UNVERIFIED');
  assert.equal(v.compiler, 'NOT_VERIFIED');
  assert.equal(v.guest, 'NOT_EXECUTED');
  assert.equal(v.sanitizers, 'NOT_EXECUTED');
  assert.equal(v.parity, 'NOT_CERTIFIED');
});

test('a completed workflow with only skipped steps is unexecuted', () => {
  const v = auditActorCI(mk({jobs:[job(1,[step(1,'some test','skipped')],{conclusion:'success'})]}));
  assert.equal(v.jobs[0].classification, 'NO_EXECUTED_STEPS');
});

test('state graph branch SHA different from pinned actor head is rejected stale', () => {
  const v = auditActorCI(mk({run:{id:42528128261,run_attempt:1,head_sha:'a'.repeat(40)}}));
  assert.equal(v.classification, 'STALE_OR_FOREIGN_RUN');
});

test('foreign repository check cannot attest an actor commit', () => {
  const v = auditActorCI(mk({run:{id:1,run_attempt:1,head_sha:llvmHead,head_repository:{full_name:'evil/repo'}}}));
  assert.equal(v.classification, 'STALE_OR_FOREIGN_RUN');
});

test('a job attached to a different workflow run is rejected', () => {
  const v = auditActorCI(mk({jobs:[job(1,null,{run_id:2})]}));
  assert.equal(v.classification, 'INVALID_JOB_EVIDENCE');
});

test('duplicate job IDs and step numbers are rejected', () => {
  assert.equal(auditActorCI(mk({jobs:[job(1,null),job(1,null)]})).classification,'INVALID_JOB_IDENTITY');
  const v = auditActorCI(mk({jobs:[job(1,[step(1,'a'),step(1,'b')])]}));
  assert.equal(v.classification,'INVALID_JOB_EVIDENCE');
});

test('missing and invalid attempt IDs fail closed', () => {
  const v = auditActorCI(mk({run:{id:42528128261,run_attempt:0,head_sha:llvmHead}}));
  assert.equal(v.classification,'MISSING_RUN_IDENTITY');
});

test('missing job pagination must not be treated as zero jobs', () => {
  assert.equal(auditActorCI(mk({jobs:undefined})).classification,'MISSING_JOB_DATA');
});

test('conformance #643 exact-head zero-step run stays unverified', () => {
  const v = auditActorCI({
    repository:'ores-truffle-oreslang/oreslang-platform-conformance',
    expected_head_sha:confHead,
    run:{id:42840715193,run_attempt:1,head_sha:confHead},
    jobs:[{id:129914863299,name:'advisory-readiness-tests',run_id:42840715193,steps:null,conclusion:'failure'}],
    claimed_guest_pass:true,
  });
  assert.equal(v.classification,'ZERO_STEP_RUNNER_ADMISSION');
  assert.equal(v.certified,false);
});

test('bogus SHA and repository are rejected before evaluating evidence', () => {
  assert.throws(() => auditActorCI(mk({expected_head_sha:'main'})), /40-hex/);
  assert.throws(() => auditActorCI(mk({repository:'something wrong'})), /canonical/);
});
