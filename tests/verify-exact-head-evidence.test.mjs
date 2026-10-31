import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateEvidence } from '../tools/verify-exact-head-evidence.mjs';

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
  const x = fixture(); x.run.conclusion = 'failure'; x.jobs.jobs[0].runner_id = 0; x.jobs.jobs[0].steps = [];
  assert.equal(grade(x), 'RUNNER_ADMISSION_FAILURE');
});
test('a foreign failed job cannot impersonate an admission failure', () => {
  const x = fixture(); x.run.conclusion = 'failure'; x.jobs.jobs[0].runner_id = 0;
  x.jobs.jobs[0].steps = []; x.jobs.jobs[0].run_id = 444;
  assert.equal(grade(x), 'UNVERIFIED');
});
test('no success can be inferred from zero steps', () => {
  const x = fixture(); x.jobs.jobs[0].steps = []; assert.equal(grade(x), 'RUNNER_ADMISSION_FAILURE');
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
test('unsupported workflow events and invalid selection do not pass', () => {
  const x = fixture(); x.run.event = 'push'; assert.equal(grade(x), 'UNVERIFIED');
  const y = fixture(); y.expected.required_steps = []; assert.equal(grade(y), 'UNVERIFIED');
  const z = fixture(); z.expected.job_name = 'other'; assert.equal(grade(z), 'UNVERIFIED');
});
