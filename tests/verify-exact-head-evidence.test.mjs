import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { evaluateEvidence, readEvidenceBundle } from '../tools/verify-exact-head-evidence.mjs';

const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
function fixture(event = 'pull_request') {
  return {
    expected: { repository: 'ores-truffle-oreslang/oreslang-source.llvm', head_sha: a,
      tree_sha: b, run_id: 111, attempt: 2, job_name: 'compiler',
      required_steps: ['Compile Oreslang guest', 'Execute compiled guest'] },
    commit: { sha: a, commit: { tree: { sha: b } } },
    run: { id: 111, run_attempt: 2, repository: { full_name: 'ores-truffle-oreslang/oreslang-source.llvm' },
      event, head_sha: event === 'workflow_dispatch' ? c : a, status: 'completed', conclusion: 'success' },
    jobs: { total_count: 1, jobs: [{ id: 555, run_id: 111, run_attempt: 2,
      runner_id: 99, head_sha: event === 'workflow_dispatch' ? c : a,
      name: 'compiler', status: 'completed', conclusion: 'success',
      steps: [{ number: 1, name: 'Compile Oreslang guest', status: 'completed', conclusion: 'success' },
        { number: 2, name: 'Execute compiled guest', status: 'completed', conclusion: 'success' }] }] },
    checkout: { repository: 'ores-truffle-oreslang/oreslang-source.llvm', head_sha: a,
      tree_sha: b, run_id: 111, attempt: 2, job_id: 555, step_number: 1 },
  };
}
const grade = x => evaluateEvidence(x).classification;
test('passing PR metadata is a candidate, never parity certification', () => {
  const r = evaluateEvidence(fixture());
  assert.equal(r.classification, 'EXECUTION_STEPS_RECORDED');
  assert.equal(r.semantic_parity_certified, false);
  assert.equal(r.source_transfer_authorized, false);
});
test('runner admission failure is distinguished from guest failure', () => {
  const x = fixture(); x.run.conclusion = 'failure'; x.jobs.jobs[0].conclusion = 'failure';
  x.jobs.jobs[0].runner_id = 0; x.jobs.jobs[0].steps = [];
  assert.equal(grade(x), 'RUNNER_ADMISSION_FAILURE');
});
test('recorded failing steps cannot be relabeled as runner admission', () => {
  const x = fixture();
  x.run.conclusion = 'failure';
  x.jobs.jobs[0].conclusion = 'failure';
  x.jobs.jobs[0].runner_id = 0; // Incomplete runner metadata is not zero-step proof.
  x.jobs.jobs[0].steps[1].conclusion = 'failure';
  assert.equal(grade(x), 'UNVERIFIED');

  const y = fixture();
  y.run.conclusion = 'failure';
  y.jobs.jobs[0].runner_id = 0;
  delete y.jobs.jobs[0].steps; // Omitted metadata is not an empty list.
  assert.equal(grade(y), 'UNVERIFIED');
});

test('successful workflow does not convert missing metadata into admission evidence', () => {
  const x = fixture();
  delete x.jobs.jobs[0].steps;
  assert.equal(grade(x), 'UNVERIFIED');
  const y = fixture();
  y.jobs.jobs[0].runner_id = 0; // Two recorded steps; no reliable runner identity.
  assert.equal(grade(y), 'UNVERIFIED');
  const z = fixture();
  z.jobs.jobs[0].steps = []; // Success with zero steps is contradictory metadata.
  assert.equal(grade(z), 'UNVERIFIED');
});

test('malformed JSON job arrays and step entries fail closed without throwing', () => {
  for (const edit of [
    x => x.jobs.jobs[0] = null,
    x => x.jobs.jobs[0] = [],
    x => x.jobs.jobs[0] = 'not-a-job',
    x => x.jobs.jobs[0].steps = [null],
    x => x.jobs.jobs[0].steps = [true],
    x => x.jobs.jobs[0].steps = [[]],
  ]) {
    const x = fixture();
    edit(x);
    assert.doesNotThrow(() => grade(x));
    assert.equal(grade(x), 'UNVERIFIED');
  }
  // Failed runs must also reject malformed jobs without a dereference error.
  for (const malformed of [null, [], 'not-a-job']) {
    const x = fixture();
    x.run.conclusion = 'failure';
    x.jobs.jobs[0] = malformed;
    assert.doesNotThrow(() => grade(x));
    assert.equal(grade(x), 'UNVERIFIED');
  }
});

test('runner admission classification requires failed zero-runner job with explicit zero steps', () => {
  const baseline = fixture();
  baseline.run.conclusion = 'failure';
  baseline.jobs.jobs[0].conclusion = 'failure';
  baseline.jobs.jobs[0].runner_id = 0;
  baseline.jobs.jobs[0].steps = [];
  assert.equal(grade(baseline), 'RUNNER_ADMISSION_FAILURE');
  for (const mutate of [
    x => x.jobs.jobs[0].runner_id = 10, // Runner really allocated.
    x => delete x.jobs.jobs[0].runner_id, // Missing metadata is not zero.
    x => x.jobs.jobs[0].runner_id = null,
    x => x.jobs.jobs[0].conclusion = 'success',
    x => x.jobs.jobs[0].conclusion = null,
    x => x.jobs.jobs[0].status = 'queued',
    x => x.run.conclusion = 'success',
    x => x.jobs.jobs[0].steps = null, // Missing step details.
    x => x.jobs.jobs[0].steps = [{name: 'Compile'}], // Recorded execution.
  ]) {
    const x = structuredClone(baseline);
    mutate(x);
    assert.equal(grade(x), 'UNVERIFIED');
  }
});
test('cancelled, timed-out, skipped and neutral workflow outcomes cannot masquerade as admission failure', () => {
  const baseline = fixture();
  baseline.jobs.jobs[0].conclusion = 'failure';
  baseline.jobs.jobs[0].runner_id = 0;
  baseline.jobs.jobs[0].steps = [];
  for (const conclusion of [undefined, null, 'cancelled', 'timed_out',
    'neutral', 'skipped', 'action_required', 'stale']) {
    const x = structuredClone(baseline);
    x.run.conclusion = conclusion;
    assert.equal(grade(x), 'UNVERIFIED', `unexpected classification: ${conclusion}`);
  }
  baseline.run.conclusion = 'failure';
  assert.equal(grade(baseline), 'RUNNER_ADMISSION_FAILURE');
});
test('a foreign failed job cannot impersonate an admission failure', () => {
  const x = fixture(); x.run.conclusion = 'failure'; x.jobs.jobs[0].conclusion = 'failure';
  x.jobs.jobs[0].runner_id = 0; x.jobs.jobs[0].steps = []; x.jobs.jobs[0].run_id = 444;
  assert.equal(grade(x), 'UNVERIFIED');
});
test('no success can be inferred from zero steps', () => {
  const x = fixture(); x.jobs.jobs[0].steps = []; assert.equal(grade(x), 'UNVERIFIED');
});
test('wrong tree, head and workflow identity reject', () => {
  for (const edit of [x => x.commit.commit.tree.sha = c, x => x.commit.sha = c,
    x => x.run.head_sha = c, x => x.run.repository.full_name = 'wrong/repo',
    x => x.run.run_attempt = 1]) {
    const x = fixture(); edit(x); assert.equal(grade(x), 'UNVERIFIED');
  }
});
test('wrong run/job attempt and incomplete pages reject', () => {
  for (const edit of [x => x.jobs.jobs[0].run_id = 999,
    x => x.jobs.jobs[0].run_attempt = 1, x => x.jobs.jobs[0].head_sha = c,
    x => x.jobs.total_count = 2,
    x => x.jobs.jobs.push(structuredClone(x.jobs.jobs[0]))]) {
    const x = fixture(); edit(x); assert.equal(grade(x), 'UNVERIFIED');
  }
});
test('missing, failed or duplicate required steps reject', () => {
  for (const edit of [x => x.jobs.jobs[0].steps.pop(),
    x => x.jobs.jobs[0].steps[1].conclusion = 'failure',
    x => x.jobs.jobs[0].steps[1].status = 'queued',
    x => x.jobs.jobs[0].steps[1].number = 1,
    x => x.jobs.jobs[0].steps.push(structuredClone(x.jobs.jobs[0].steps[1]))]) {
    const x = fixture(); edit(x); assert.equal(grade(x), 'UNVERIFIED');
  }
});
test('manual dispatch requires job-bound source/tree checkout receipt', () => {
  const x = fixture('workflow_dispatch'); assert.equal(grade(x), 'EXECUTION_STEPS_RECORDED');
  for (const edit of [x => delete x.checkout, x => x.checkout.job_id = 556,
    x => x.checkout.tree_sha = c, x => x.checkout.step_number = 3]) {
    const y = fixture('workflow_dispatch'); edit(y); assert.equal(grade(y), 'UNVERIFIED');
  }
});
test('manual dispatch rejects missing or malformed workflow and job head identities', () => {
  // A manual run uses the workflow-branch SHA rather than the guest SHA.
  // Even with a plausible source/tree checkout receipt, a missing run head
  // must never become valid merely because the job head is equally absent.
  for (const mutate of [
    x => { delete x.run.head_sha; delete x.jobs.jobs[0].head_sha; },
    x => { x.run.head_sha = null; x.jobs.jobs[0].head_sha = null; },
    x => { x.run.head_sha = 'malformed'; x.jobs.jobs[0].head_sha = 'malformed'; },
    x => { x.run.head_sha = 'A'.repeat(40); x.jobs.jobs[0].head_sha = 'A'.repeat(40); },
    x => { x.jobs.jobs[0].head_sha = null; },
  ]) {
    const x = fixture('workflow_dispatch');
    mutate(x);
    assert.equal(grade(x), 'UNVERIFIED');
  }
  const failed = fixture('workflow_dispatch');
  failed.run.conclusion = 'failure';
  failed.jobs.jobs[0].conclusion = 'failure';
  failed.jobs.jobs[0].runner_id = 0;
  failed.jobs.jobs[0].steps = [];
  delete failed.run.head_sha;
  delete failed.jobs.jobs[0].head_sha;
  assert.equal(grade(failed), 'UNVERIFIED');
  assert.equal(grade(fixture('workflow_dispatch')), 'EXECUTION_STEPS_RECORDED');
});

test('unsupported workflow events and invalid selection do not pass', () => {
  const x = fixture(); x.run.event = 'push'; assert.equal(grade(x), 'UNVERIFIED');
  const y = fixture(); y.expected.required_steps = []; assert.equal(grade(y), 'UNVERIFIED');
  const z = fixture(); z.expected.job_name = 'other'; assert.equal(grade(z), 'UNVERIFIED');
});

test('bounded evidence bundle loader rejects FIFO, symlink, oversized and empty files', {skip: process.platform === 'win32'}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'ores-actions-evidence-'));
  try {
    const valid = join(directory, 'valid.json');
    const empty = join(directory, 'empty.json');
    const tooLarge = join(directory, 'oversize.json');
    const link = join(directory, 'link.json');
    const fifo = join(directory, 'fifo.json');
    writeFileSync(valid, JSON.stringify(fixture()));
    writeFileSync(empty, '');
    writeFileSync(tooLarge, 'X'.repeat(256 * 1024 + 1));
    symlinkSync(valid, link);
    execFileSync('mkfifo', [fifo]);
    assert.equal(grade(readEvidenceBundle(valid)), 'EXECUTION_STEPS_RECORDED');
    assert.throws(() => readEvidenceBundle(empty));
    assert.throws(() => readEvidenceBundle(tooLarge));
    assert.throws(() => readEvidenceBundle(link));
    // O_NONBLOCK prevents an untrusted FIFO from waiting for a writer.
    assert.throws(() => readEvidenceBundle(fifo));
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('untrusted evidence path cannot be omitted', () => {
  assert.throws(() => readEvidenceBundle(''));
  assert.throws(() => readEvidenceBundle(null));
});
