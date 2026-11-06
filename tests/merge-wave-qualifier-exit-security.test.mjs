import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const CLI = fileURLToPath(new URL('../bin/merge-wave-qualifier.mjs', import.meta.url));
const H = 'a'.repeat(40), TREE = 'b'.repeat(40), BASE = 'c'.repeat(40);
const REPOS = ['iot', 'embedded', 'desktop', 'asic', 'fpga']
  .map(name => `ores-truffle-oreslang/oreslang-platform.${name}`);

function candidate(repo, number) {
  const run_id = 1000 + number, job_id = 2000 + number;
  return {
    repo, number, head_sha: H, head_tree_sha: TREE, base_sha: BASE,
    base_ref: 'main', draft: false, mergeable: true, state: 'open',
    author: 'example-author',
    protection: {
      protected: true, require_pull_request: true, require_codeowners: true,
      dismiss_stale_reviews: true, strict_checks: true, enforce_admins: true,
      bypass_count: 0
    },
    reviews: [{state: 'APPROVED', login: 'independent-reviewer', commit_sha: H}],
    required_checks: [{context: 'ci', app_id: 15368}],
    checks: [{
      context: 'ci', app_id: 15368, head_sha: H, tree_sha: TREE,
      conclusion: 'success', run_id, run_attempt: 1,
      jobs: [{
        id: job_id, run_id, run_attempt: 1, head_sha: H, runner_id: 50,
        conclusion: 'success',
        steps: [{name: 'Run actual regression tests', conclusion: 'success'}]
      }]
    }],
    scope: 'source_free',
    test_receipts: ['source_free', 'negative'].map(kind => ({
      kind, head_sha: H, tree_sha: TREE, run_id, run_attempt: 1,
      job_id, assertions: 10, conclusion: 'success'
    })),
    lease: null
  };
}
function snapshot() {
  return {
    schema_version: 1, as_of: '2026-11-06T19:00:00Z',
    candidates: REPOS.map((repo, i) => candidate(repo, i + 1))
  };
}
function fixture(t, bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'atto-merge-wave-cli-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const path = join(dir, 'snapshot.json');
  writeFileSync(path, bytes);
  return {dir, path};
}
function run(path, ...args) {
  return spawnSync(process.execPath, [CLI, path, ...args], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 1_000_000
  });
}
function verify_exit(result, expected) {
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.signal, null);
  assert.equal(result.status, expected, result.stderr);
  assert.notEqual(result.status, 0, 'offline evidence must NEVER cause process success');
}

test('synthetically qualified five-platform wave exits 3, never 0', t => {
  const {path} = fixture(t, JSON.stringify(snapshot()));
  const result = run(path);
  verify_exit(result, 3);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, 'SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
  assert.equal(parsed.selected.length, 5);
  assert.equal(parsed.distinct_repo_count, 5);
});

test('one missing exact-head check is blocked with exit 1', t => {
  const snap = snapshot();
  snap.candidates[0].checks[0].jobs[0].steps = [];
  const result = run(fixture(t, JSON.stringify(snap)).path);
  verify_exit(result, 1);
  assert.equal(JSON.parse(result.stdout).status, 'BLOCKED');
});

test('invalid JSON exits 2 and prints no qualified snapshot', t => {
  const result = run(fixture(t, '{malformed').path);
  verify_exit(result, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /FAIL_CLOSED/);
});

test('missing snapshot file exits 2', t => {
  const {dir} = fixture(t, '');
  verify_exit(run(join(dir, 'missing.json')), 2);
});

test('oversized snapshot is rejected before parsing', t => {
  const result = run(fixture(t, Buffer.alloc(2_000_001, 0x20)).path);
  verify_exit(result, 2);
  assert.match(result.stderr, /2MB/);
});

test('malformed UTF-8 in otherwise syntactically valid JSON fails closed', t => {
  const raw = Buffer.concat([
    Buffer.from('{"schema_version":1,"as_of":"2026-11-06T19:00:00Z","candidates":[],"note":"'),
    Buffer.from([0xff]),
    Buffer.from('"}')
  ]);
  const result = run(fixture(t, raw).path);
  verify_exit(result, 2);
  assert.match(result.stderr, /FAIL_CLOSED/);
});

test('directory is not a snapshot', t => {
  const {dir} = fixture(t, '');
  const subdirectory = join(dir, 'not-a-file');
  mkdirSync(subdirectory);
  const result = run(subdirectory);
  verify_exit(result, 2);
  assert.match(result.stderr, /regular file/);
});

test('symlink input cannot substitute an unreviewed snapshot', t => {
  const {dir, path} = fixture(t, JSON.stringify(snapshot()));
  const link = join(dir, 'link.json');
  try {
    symlinkSync(path, link);
  } catch (error) {
    if (['EPERM', 'ENOTSUP', 'EACCES'].includes(error.code)) {
      t.skip('host disallows symlink creation');
      return;
    }
    throw error;
  }
  const result = run(link);
  verify_exit(result, 2);
  assert.match(result.stderr, /FAIL_CLOSED/);
});

test('unexpected extra CLI arguments exit 2', t => {
  const result = run(fixture(t, JSON.stringify(snapshot())).path, '--force');
  verify_exit(result, 2);
  assert.match(result.stderr, /Usage:/);
});

test('missing CLI argument exits 2 without a false success', () => {
  const result = spawnSync(process.execPath, [CLI], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 100_000
  });
  verify_exit(result, 2);
  assert.match(result.stderr, /Usage:/);
});
