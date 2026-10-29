import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRunnerAdmission, CANARY_WORKFLOW, CANARY_STEP } from '../scripts/verify-runner-admission.mjs';

const expected = {
  repository: 'ores-truffle-oreslang/oreslang-platform-conformance',
  sha: '719cf58796de5d59753aeba67d1787e850d228e5',
  branch: 'ci/source-local-runner-admission-20261028',
  runId: 42,
  attempt: 1,
};
function fixture() {
  const run = { id: 42, repository: { full_name: expected.repository }, head_sha: expected.sha, head_branch: expected.branch, path: CANARY_WORKFLOW, event: 'push', run_attempt: 1, status: 'completed', conclusion: 'success' };
  const jobs = { total_count: 1, jobs: [{ id: 123, name: 'runner-admission', run_id: 42, run_attempt: 1, head_sha: expected.sha, runner_id: 10002, runner_name: 'GitHub Actions 10002', status: 'completed', conclusion: 'success', steps: [
    { name: 'Set up job', status: 'completed', conclusion: 'success' },
    { name: CANARY_STEP, status: 'completed', conclusion: 'success' },
    { name: 'Complete job', status: 'completed', conclusion: 'success' },
  ] }] };
  return { run, jobs };
}
function assess(modify) { const f = fixture(); modify?.(f); return verifyRunnerAdmission(f.run, f.jobs, expected); }

const bad = [
  ['run id', f => { f.run.id = 41; }],
  ['wrong run id expectation', f => { f.run.id = 41; f.jobs.jobs[0].run_id = 41; }],
  ['wrong expected attempt', f => { f.run.run_attempt = 2; f.jobs.jobs[0].run_attempt = 2; }],
  ['run failed with successful job', f => { f.run.conclusion = 'failure'; }],
  ['invalid job id', f => { f.jobs.jobs[0].id = 0; }],
  ['invalid workflow path type', f => { f.run.path = 47; }],
  ['null job item', f => { f.jobs.jobs[0] = null; }],
  ['wrong repository', f => { f.run.repository.full_name = 'untrusted/x'; }],
  ['wrong sha', f => { f.run.head_sha = '0'.repeat(40); }],
  ['wrong branch', f => { f.run.head_branch = 'main'; }],
  ['wrong workflow', f => { f.run.path = '.github/workflows/other.yml'; }],
  ['unexpected event', f => { f.run.event = 'pull_request_target'; }],
  ['run not completed', f => { f.run.status = 'queued'; }],
  ['wrong attempt', f => { f.jobs.jobs[0].run_attempt = 2; }],
  ['wrong job sha', f => { f.jobs.jobs[0].head_sha = '0'.repeat(40); }],
  ['missing job', f => { f.jobs.jobs = []; f.jobs.total_count = 0; }],
  ['truncated response', f => { f.jobs.total_count = 2; }],
  ['duplicate job', f => { f.jobs.jobs.push({ ...f.jobs.jobs[0] }); f.jobs.total_count = 2; }],
  ['runner zero', f => { f.jobs.jobs[0].runner_id = 0; }],
  ['runner empty', f => { f.jobs.jobs[0].runner_name = ''; }],
  ['steps null', f => { f.jobs.jobs[0].steps = null; }],
  ['steps empty', f => { f.jobs.jobs[0].steps = []; }],
  ['housekeeping only', f => { f.jobs.jobs[0].steps.splice(1, 1); }],
  ['post step only', f => { f.jobs.jobs[0].steps[1].name = 'Post actions/cache'; }],
  ['canary step skipped', f => { f.jobs.jobs[0].steps[1].conclusion = 'skipped'; }],
  ['canary step running', f => { f.jobs.jobs[0].steps[1].status = 'in_progress'; }],
  ['canary step failed', f => { f.jobs.jobs[0].steps[1].conclusion = 'failure'; f.jobs.jobs[0].conclusion = 'failure'; }],
];

test('valid exact-run, exact-attempt, runner-backed successful canary passes', () => {
  const result = assess();
  assert.equal(result.admitted, true);
  assert.equal(result.meaningfulStepExecuted, true);
  assert.equal(result.backendGuestExecution, false);
});
for (const [label, mutate] of bad) {
  test(`fail closed: ${label}`, () => assert.equal(assess(mutate).admitted, false));
}
test('failed meaningful step is observed but not accepted as success', () => {
  const result = assess(f => { f.jobs.jobs[0].steps[1].conclusion = 'failure'; f.jobs.jobs[0].conclusion = 'failure'; });
  assert.equal(result.runnerAllocated, true);
  assert.equal(result.meaningfulStepExecuted, true);
  assert.equal(result.admitted, false);
});

test('fail closed: expected metadata missing', () => { const f = fixture(); assert.equal(verifyRunnerAdmission(f.run, f.jobs, undefined).admitted, false); });
test('fail closed: malformed expected SHA', () => { const f = fixture(); assert.equal(verifyRunnerAdmission(f.run, f.jobs, { ...expected, sha: '' }).admitted, false); });
