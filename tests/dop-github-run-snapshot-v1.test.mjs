import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDopGithubSnapshot, validateDopGithubCommit } from '../verification/dop-github-run-snapshot-v1.mjs';

const manifest = JSON.parse(readFileSync(new URL(
  '../contracts/dop-scalar-guest-v1/manifest.json', import.meta.url), 'utf8'));
const repo = 'ores-truffle-oreslang/oreslang-source.llvm';
const head = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const steps = ['checkout-head', 'compile-guest', 'execute-guest', 'execute-poisoned-guest'].map((id, i) => ({
  id, number: i + 1, conclusion: 'success',
  startedAt: `2026-11-06T10:00:0${i}Z`,
  completedAt: `2026-11-06T10:00:0${i + 1}Z`
}));
const receipt = {
  contract: manifest.contract, backend: 'llvm', caseId: 'primitive-columns-atto-guest',
  status: 'PASSED', sourceHeadSha: head, checkoutHeadSha: head, sourceTreeSha: head,
  fixtureGitBlobSha: manifest.fixture.gitBlobSha, compilerSha256: digest,
  fixtureSha256: digest, guestArtifactSha256: digest, toolchain: 'Clang',
  command: 'real-compiler-then-execute', discoveredTests: 1, executedTests: 1,
  guestExecuted: true, executionStage: 'native-guest', guestExitCode: 0,
  ciJob: {runId: 1422, jobId: 4411, runnerId: 55, conclusion: 'success', steps}
};
const run = {id: 1422, run_attempt: 1, head_sha: head, status: 'completed',
  workflow_id: 404132837, path: '.github/workflows/dop-atto-soa-native.yml',
  name: 'Native AttoLang DOP SoA guest AOT smoke', event: 'pull_request',
  conclusion: 'success', repository: {full_name: repo},
  head_repository: {full_name: repo}};
const job = {id: 4411, run_id: 1422, run_attempt: 1, head_sha: head,
  workflow_name: 'Native AttoLang DOP SoA guest AOT smoke', name: 'native-guest',
  runner_id: 55, status: 'completed',
  conclusion: 'success', steps: steps.map(step => ({
    number: step.number, name: step.id, conclusion: step.conclusion,
    started_at: step.startedAt, completed_at: step.completedAt
  }))};
const page = {total_count: 1, jobs: [job]};
const verify = (r = receipt, ru = run, jp = page, ex = repo) =>
  validateDopGithubSnapshot(r, manifest, ru, jp, ex);

test('synthetic fully matched API snapshot passes only shape and correlation', () => {
  assert.deepEqual(verify(), []);
});
test('exact GitHub head and repo identity are mandatory', () => {
  assert.ok(verify(receipt, {...run, head_sha: 'c'.repeat(40)}).includes('run-exact-head'));
  assert.ok(verify(receipt, {...run, repository: {full_name: 'other/repo'}}).includes('run-repository'));
});
test('zero-step and unallocated runner cannot be attested', () => {
  assert.ok(verify(receipt, run, {total_count: 1, jobs: [{...job, runner_id: null, steps: null}]})
    .includes('admitted-runner-match'));
});
test('job cannot be borrowed from another run or a different runner', () => {
  assert.ok(verify(receipt, run, {total_count: 1, jobs: [{...job, run_id: 1444}]})
    .includes('job-run-id-match'));
  assert.ok(verify(receipt, run, {total_count: 1, jobs: [{...job, runner_id: 22}]})
    .includes('admitted-runner-match'));
});
test('step labels, conclusions and timestamps must match actual GitHub records', () => {
  const s = job.steps.map(x => ({...x}));
  s[1].name = 'Setup job';
  assert.ok(verify(receipt, run, {total_count: 1, jobs: [{...job, steps: s}]})
    .includes('observed-step-name-match'));
  s[1].name = 'compile-guest'; s[1].completed_at = '2026-11-06T09:00:02Z';
  assert.ok(verify(receipt, run, {total_count: 1, jobs: [{...job, steps: s}]})
    .includes('observed-step-end-match'));
});
test('partial job pagination fails closed', () => {
  assert.ok(verify(receipt, run, {...page, total_count: 2}).includes('complete-bounded-job-page'));
  assert.ok(verify(receipt, run, {...page, total_count: 101}).includes('complete-bounded-job-page'));
});
test('unexpected, missing or duplicated job identity fails closed', () => {
  assert.ok(verify(receipt, run, {total_count: 1, jobs: [{...job, id: 22}]})
    .includes('unique-job-id-match'));
  assert.ok(verify(receipt, run, {total_count: 2, jobs: [job, {...job}]})
    .includes('unique-job-id-match'));
});
test('NOT_EXECUTED never becomes verified just because an API run exists', () => {
  const absent = {contract: manifest.contract, backend: 'wasm',
    caseId: 'primitive-columns-atto-guest', status: 'NOT_EXECUTED'};
  assert.deepEqual(verify(absent), ['not-executed-cannot-attest-run']);
});
test('noncompleted or failed workflow cannot attest a PASSED guest', () => {
  assert.ok(verify(receipt, {...run, status: 'in_progress'}).includes('run-completed'));
  assert.ok(verify(receipt, {...run, conclusion: 'failure'}).includes('run-conclusion'));
});
test('duplicate GitHub API step names and numbers fail closed', () => {
  const both = [...job.steps, {...job.steps[1], number: 4}];
  assert.ok(verify(receipt, run, {total_count: 1, jobs: [{...job, steps: both}]})
    .includes('duplicate-api-step-name'));
  // Mutate the newly appended synthetic record, not shared job.steps[3].
  both[4].name = 'extra'; both[4].number = 3;
  assert.ok(verify(receipt, run, {total_count: 1, jobs: [{...job, steps: both}]})
    .includes('duplicate-api-step-number'));
});

test('a workflow run from a different head repository is not accepted', () => {
  assert.ok(verify(receipt, {...run, head_repository: {full_name: 'untrusted/fork'}})
    .includes('run-head-repository'));
  assert.ok(verify(receipt, {...run, head_repository: null})
    .includes('run-head-repository'));
});

test('job SHA cannot diverge from the pinned source head', () => {
  const alien = {...job, head_sha: 'f'.repeat(40)};
  assert.ok(verify(receipt, run, {total_count: 1, jobs: [alien]})
    .includes('job-exact-head'));
  assert.ok(verify(receipt, run, {total_count: 1, jobs: [{...job, head_sha: null}]})
    .includes('job-exact-head'));
});

test('previous or future job attempt cannot masquerade as the current GitHub run attempt', () => {
  assert.ok(verify(receipt, run, {total_count: 1, jobs: [{...job, run_attempt: 2}]})
    .includes('job-attempt-match'));
  assert.ok(verify(receipt, run, {total_count: 1, jobs: [{...job, run_attempt: null}]})
    .includes('job-attempt-match'));
});

test('workflow path and job identity cannot be replaced by unrelated host-only checks', () => {
  assert.ok(verify(receipt, {...run, path: '.github/workflows/host-only.yml'})
    .includes('workflow-path'));
  assert.ok(verify(receipt, {...run, name: 'host reference oracle'})
    .includes('workflow-name'));
  assert.ok(verify(receipt, run, {total_count:1,jobs:[{...job,name:'host-only'}]})
    .includes('workflow-job-name'));
});

test('LLVM native guest snapshot must correlate its real poisoned-checksum execution step', () => {
  const without = {...receipt, ciJob: {...receipt.ciJob, steps: receipt.ciJob.steps.slice(0, 3)}};
  assert.ok(verify(without).includes('llvm-poisoned-guest-step'));
  const wrong = job.steps.map(s => ({...s}));
  wrong[3].name = 'host-only negative oracle';
  assert.ok(verify(receipt, run, {...page, jobs:[{...job, steps:wrong}]})
    .includes('observed-step-name-match'));
});

test('source Git commit and declared tree are independently correlated by immutable URLs', () => {
  const commit = {
    sha:head, tree:{sha:head,
      url:'https://api.github.com/repos/' + repo + '/git/trees/' + head},
    url:'https://api.github.com/repos/' + repo + '/git/commits/' + head
  };
  assert.deepEqual(validateDopGithubCommit(receipt,commit,repo),[]);
  assert.ok(validateDopGithubCommit({...receipt,sourceTreeSha:'c'.repeat(40)},commit,repo)
    .includes('git-commit-tree-match'));
  assert.ok(validateDopGithubCommit({...receipt,sourceHeadSha:'c'.repeat(40)},commit,repo)
    .includes('git-commit-exact-head'));
  assert.ok(validateDopGithubCommit(receipt,{...commit,url:commit.url + '?ref=main'},repo)
    .includes('git-commit-canonical-url'));
  assert.ok(validateDopGithubCommit(receipt,{...commit,tree:{...commit.tree,
    url:commit.tree.url.replace('/git/trees/', '/git/blobs/')}},repo)
    .includes('git-tree-canonical-url'));
  assert.ok(validateDopGithubCommit(receipt,commit,'other/repo')
    .includes('git-commit-canonical-url'));
});
test('malformed or unexecuted Git commit evidence cannot be correlated', () => {
  const commit={sha:head,tree:{sha:head,
    url:'https://api.github.com/repos/' + repo + '/git/trees/' + head},
    url:'https://api.github.com/repos/' + repo + '/git/commits/' + head};
  for (const bad of [null,[],{sha:head},{...commit,tree:null}]) {
    assert.notDeepEqual(validateDopGithubCommit(receipt,bad,repo),[]);
  }
  assert.ok(validateDopGithubCommit({...receipt,status:'NOT_EXECUTED'},commit,repo)
    .includes('not-executed-cannot-attest-commit'));
  for (const invalidRepo of ['../other', 'owner/.', 'owner/..', 'owner/name.git',
    'owner/name.GIT', 'owner/repo?ref=main', 'owner%2ffork/repo']) {
    assert.ok(validateDopGithubCommit(receipt,commit,invalidRepo)
      .includes('commit-source-repository'), invalidRepo);
  }
});
