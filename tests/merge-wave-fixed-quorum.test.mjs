import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifyWave} from '../tools/merge-wave-qualifier.mjs';

const SHA = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const REPOS = ['iot', 'embedded', 'desktop', 'asic', 'fpga', 'mobile']
  .map(name => `ores-truffle-oreslang/oreslang-platform.${name}`)
  .concat('ores-truffle-oreslang/oreslang-platform-conformance');

function candidate(repo, number) {
  const run_id = 1000 + number;
  const job_id = 2000 + number;
  return {
    repo, number, head_sha: SHA, head_tree_sha: TREE, base_sha: BASE,
    base_ref: 'main', draft: false, mergeable: true, state: 'open',
    author: 'example-author',
    protection: {
      protected: true, require_pull_request: true, require_codeowners: true,
      dismiss_stale_reviews: true, strict_checks: true, enforce_admins: true,
      bypass_count: 0
    },
    reviews: [{login: 'independent-reviewer', state: 'APPROVED', commit_sha: SHA}],
    required_checks: [{context: 'ci', app_id: 15368}],
    checks: [{
      context: 'ci', app_id: 15368, head_sha: SHA, tree_sha: TREE,
      conclusion: 'success', run_id, run_attempt: 1,
      jobs: [{
        id: job_id, run_id, run_attempt: 1, head_sha: SHA,
        runner_id: 50, conclusion: 'success',
        steps: [{name: 'Run actual tests', conclusion: 'success'}]
      }]
    }],
    scope: 'source_free',
    test_receipts: ['source_free', 'negative'].map(kind => ({
      kind, head_sha: SHA, tree_sha: TREE, run_id, run_attempt: 1,
      job_id, assertions: 10, conclusion: 'success'
    })),
    lease: null
  };
}
function snapshot(repos = REPOS.slice(0, 5)) {
  return {
    schema_version: 1,
    as_of: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    candidates: repos.map((repo, index) => candidate(repo, index + 1))
  };
}

test('default qualifies only five candidates over at least three distinct repos', () => {
  const result = qualifyWave(snapshot());
  assert.equal(result.status, 'SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
  assert.equal(result.selected.length, 5);
  assert.equal(result.distinct_repo_count, 5);
  assert.equal(result.required_size, 5);
  assert.equal(result.min_repos, 3);
});

test('explicit exact fixed quorum is accepted but remains advisory', () => {
  const result = qualifyWave(snapshot(), {size: 5, minRepos: 3});
  assert.equal(result.status, 'SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
  assert.match(result.note, /never auto-merge/i);
});

test('five PRs across exactly three repos meets the diversity floor', () => {
  const repos = [REPOS[0], REPOS[1], REPOS[2], REPOS[0], REPOS[1]];
  const result = qualifyWave(snapshot(repos));
  assert.equal(result.status, 'SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
  assert.equal(result.selected.length, 5);
  assert.equal(result.distinct_repo_count, 3);
});

test('five PRs in two repos cannot qualify', () => {
  const repos = [REPOS[0], REPOS[1], REPOS[0], REPOS[1], REPOS[0]];
  const result = qualifyWave(snapshot(repos));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.selected.length, 0);
  assert.equal(result.distinct_repo_count, 2);
});

test('four PRs across four repos cannot qualify', () => {
  const result = qualifyWave(snapshot(REPOS.slice(0, 4)));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.selected.length, 0);
  assert.equal(result.eligible_count, 4);
});

test('seven candidates can select exactly five across distinct platform repos', () => {
  const result = qualifyWave(snapshot(REPOS));
  assert.equal(result.status, 'SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
  assert.equal(result.selected.length, 5);
  assert.equal(new Set(result.selected.map(item => item.repo)).size, 5);
});

for (const [size, minRepos] of [
  [1, 1], [2, 2], [4, 2], [4, 3], [5, 1], [5, 2],
  [5, 4], [5, 5], [6, 3], [0, 0], [-1, 3], [1.5, 1],
  ['5', 3], [5, '3'], [null, 3], [5, null],
  [true, 3], [5, true], [Infinity, 3], [5, NaN]
]) {
  test(`nonstandard quorum size=${String(size)} minRepos=${String(minRepos)} is rejected`, () => {
    assert.throws(
      () => qualifyWave(snapshot(), {size, minRepos}),
      /fixed merge wave requires size=5 and minRepos=3/
    );
  });
}
