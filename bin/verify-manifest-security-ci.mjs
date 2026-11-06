#!/usr/bin/env node
/** Verify *live* GitHub-hosted, exact-head manifest-security CI evidence.
 * The operator-supplied receipt is a set of identifiers, never an attestation.
 * This gate does NOT authorize a merge, private-source transfer or parity claim.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const oid = /^[0-9a-f]{40}$/;
const registry = Object.freeze({
  java: { repo: 'ores-truffle-oreslang/oreslang-source.java', id: 1400792274, pr: 2573,
    workflowSha: 'f4dafa788f8a50565d5ded7d2cfb3911e40c8ae2' },
  llvm: { repo: 'ores-truffle-oreslang/oreslang-source.llvm', id: 1410897874, pr: 1446,
    workflowSha: 'f4dafa788f8a50565d5ded7d2cfb3911e40c8ae2' },
  wasm: { repo: 'ores-truffle-oreslang/oreslang-source.wasm', id: 1419858954, pr: 398,
    workflowSha: 'f4dafa788f8a50565d5ded7d2cfb3911e40c8ae2' },
  net: { repo: 'ores-truffle-oreslang/oreslang-source.net', id: 1419704375, pr: 373,
    workflowSha: 'f4dafa788f8a50565d5ded7d2cfb3911e40c8ae2' },
  forge: { repo: 'ores-truffle-oreslang/oreslang-source.forge', id: 1419703674, pr: 197,
    workflowSha: 'b954708b99de2c7ea71c1df4d0f65d9ddb057bb0' },
});
const workflowPath = '.github/workflows/integration-declarations.yml';
const requiredSteps = Object.freeze({
  rust: [
    'Assert exact originating-source checkout',
    'Test Rust repository policy tooling',
    'Verify declaration-only manifest (not a runtime parity claim)',
  ],
  forge: [
    'Assert exact originating-source checkout',
    'Verify declaration-only manifest (not a runtime parity claim)',
    'Run fail-closed manifest gate adversarial regression suite',
  ],
});

function fail(message) { throw new Error(message); }
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name}: expected object`);
  return value;
}
function exactKeys(value, keys, name) {
  const actual = Object.keys(object(value, name));
  if (actual.length !== keys.length ||
      actual.some(key => !keys.includes(key))) fail(`${name}: unexpected or missing keys`);
}
function positiveInt(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${name}: expected positive integer`);
}
function sha(value, name) { if (typeof value !== 'string' || !oid.test(value)) fail(`${name}: invalid SHA-1`); }

function parseCandidates(receipt) {
  exactKeys(receipt, ['schema', 'candidates'], 'receipt');
  if (receipt.schema !== 'atto.manifest-security-ci/1') fail('unsupported receipt schema');
  if (!Array.isArray(receipt.candidates) || receipt.candidates.length !== 5)
    fail('all five backend candidates are required');
  const seen = new Set();
  for (const [i, entry] of receipt.candidates.entries()) {
    exactKeys(entry, ['backend', 'repository', 'repository_id', 'pr', 'head_sha', 'tree_sha', 'run_id', 'job_id'], `candidate[${i}]`);
    const target = Object.hasOwn(registry, entry.backend) ? registry[entry.backend] : null;
    if (!target || seen.has(entry.backend)) fail(`candidate[${i}]: unknown or duplicate backend`);
    seen.add(entry.backend);
    if (entry.repository !== target.repo || entry.repository_id !== target.id || entry.pr !== target.pr)
      fail(`${entry.backend}: canonical repository ID / PR mismatch`);
    sha(entry.head_sha, `${entry.backend}.head_sha`);
    sha(entry.tree_sha, `${entry.backend}.tree_sha`);
    positiveInt(entry.run_id, `${entry.backend}.run_id`);
    positiveInt(entry.job_id, `${entry.backend}.job_id`);
  }
  return receipt.candidates;
}

/** api(path) MUST perform authenticated read-only GitHub API calls, not read caller-supplied fixtures. */
export async function qualifyManifestSecurityCI(receipt, api) {
  const candidates = parseCandidates(receipt);
  if (typeof api !== 'function') fail('trusted GitHub API reader required');
  const errors = [];
  const qualifications = [];
  for (const candidate of candidates) {
    const { backend, repository: repo, pr: prNo, head_sha: head, tree_sha: tree, run_id: runId, job_id: jobId } = candidate;
    const target = registry[backend];
    const base = `/repos/${repo}`;
    try {
      const pull = object(await api(`${base}/pulls/${prNo}`), `${backend} PR`);
      if (pull.state !== 'open' || pull.head?.sha !== head || pull.base?.ref !== targetBase(backend))
        fail('PR not open or exact head/base differs');
      if (pull.head?.repo?.id !== target.id || pull.base?.repo?.id !== target.id)
        fail('PR head/base repository identity mismatch');
      if (typeof pull.head?.ref !== 'string' || !pull.head.ref)
        fail('PR head branch identity missing');

      const commit = object(await api(`${base}/commits/${head}`), `${backend} commit`);
      if (commit.sha !== head || commit.commit?.tree?.sha !== tree) fail('exact source tree does not match GitHub');
      const workflow = object(await api(`${base}/contents/${workflowPath}?ref=${head}`), `${backend} workflow`);
      if (workflow.sha !== target.workflowSha || workflow.type !== 'file')
        fail('review-pinned workflow blob mismatch');

      const installedWorkflow = object(await api(`${base}/actions/workflows/integration-declarations.yml`), `${backend} workflow identity`);
      positiveInt(installedWorkflow.id, `${backend} workflow_id`);
      if (installedWorkflow.path !== workflowPath || installedWorkflow.name !== 'Integration declaration integrity')
        fail('registered workflow identity mismatch');

      const run = object(await api(`${base}/actions/runs/${runId}`), `${backend} run`);
      if (run.id !== runId || run.repository?.id !== target.id || run.head_repository?.id !== target.id ||
          run.head_sha !== head || run.head_branch !== pull.head.ref ||
          run.workflow_id !== installedWorkflow.id || run.name !== installedWorkflow.name ||
          run.path !== workflowPath || run.event !== 'pull_request' ||
          run.status !== 'completed' || run.conclusion !== 'success')
        fail('workflow run is not a successful, exact-head source-owned PR run');
      if (!Array.isArray(run.pull_requests) ||
          !run.pull_requests.some(entry => entry?.number === prNo && entry?.head?.sha === head))
        fail('workflow run is not associated with the exact PR head');
      positiveInt(run.run_attempt, `${backend}.run_attempt`);
      // An older successful job can still be fetched by ID after a failed rerun.
      // Bind the selected job to the *current attempt's* canonical membership.
      const attempt = object(await api(`${base}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`), `${backend} attempt jobs`);
      if (!Number.isSafeInteger(attempt.total_count) || attempt.total_count < 1 ||
          attempt.total_count > 100 || !Array.isArray(attempt.jobs) ||
          attempt.jobs.length !== attempt.total_count ||
          attempt.jobs.filter(entry => entry?.id === jobId).length !== 1)
        fail('selected job is not uniquely present in the latest completed run attempt');
      const job = object(await api(`${base}/actions/jobs/${jobId}`), `${backend} job`);
      if (job.id !== jobId || job.run_id !== runId || job.head_sha !== run.head_sha ||
          job.name !== 'declaration-integrity' ||
          job.workflow_name !== 'Integration declaration integrity' ||
          job.status !== 'completed' || job.conclusion !== 'success' ||
          !Array.isArray(job.labels) || !job.labels.includes('ubuntu-24.04') ||
          !Number.isSafeInteger(job.runner_id) || job.runner_id <= 0)
        fail('job is not the expected completed Ubuntu runner-backed security job');
      if (!Array.isArray(job.steps) || job.steps.length === 0)
        fail('NOT_EXECUTED: zero-step job cannot attest tests');
      for (const expected of requiredSteps[backend === 'forge' ? 'forge' : 'rust']) {
        const matches = job.steps.filter(s => s?.name === expected);
        if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success')
          fail(`required step missing, duplicate or not successful: ${expected}`);
      }
      const checkout = job.steps.filter(s =>
        s?.name === 'Run actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683');
      if (checkout.length !== 1 || checkout[0].status !== 'completed' || checkout[0].conclusion !== 'success')
        fail('unique pinned checkout step missing or not successful');
      qualifications.push({ backend, head_sha: head, tree_sha: tree, run_id: runId, job_id: jobId,
        executed_steps: job.steps.filter(s => s.status === 'completed').length, status: 'CI_VERIFIED' });
    } catch (error) {
      errors.push(`${backend}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // A PR can move while the five backend API queries are in flight.
  // Re-read all PR refs immediately before issuing any qualification, then
  // require a separate expected-head lease at merge time: this isn't atomic.
  if (errors.length === 0 && qualifications.length === 5) {
    for (const candidate of candidates) {
      try {
        const refreshed = object(await api(`/repos/${candidate.repository}/pulls/${candidate.pr}`),
          `${candidate.backend} final PR read`);
        if (refreshed.state !== 'open' || refreshed.head?.sha !== candidate.head_sha ||
            refreshed.head?.repo?.id !== registry[candidate.backend].id ||
            refreshed.base?.ref !== targetBase(candidate.backend))
          fail('PR changed during evidence verification');
      } catch (error) {
        errors.push(`${candidate.backend}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const ok = errors.length === 0 && qualifications.length === 5;
  return { ok, status: ok ? 'CI_VERIFIED' : 'NOT_VERIFIED',
    // Never emit partial success markers that a downstream consumer might
    // incorrectly interpret as per-backend release approval.
    qualifications: ok ? qualifications : [], errors };
}

function targetBase(backend) {
  const stems = {
    java: 'hardening/java-rust-manifest-file-boundary-20261106',
    llvm: 'hardening/llvm-rust-manifest-file-boundary-20261106',
    wasm: 'hardening/wasm-rust-manifest-file-boundary-20261106',
    net: 'hardening/net-rust-manifest-file-boundary-20261106',
    forge: 'hardening/forge-manifest-parent-symlink-20261106',
  };
  return stems[backend];
}

/** Production reader, deliberately restricted to api.github.com; never exports Git trees. */
export function githubReader(token, fetchImpl = fetch) {
  if (typeof token !== 'string' || !token.trim()) fail('GITHUB_TOKEN required for live qualification');
  return async path => {
    if (!path.startsWith('/repos/ores-truffle-oreslang/')) fail('non-canonical API path');
    const response = await fetchImpl(`https://api.github.com${path}`, {
      headers: { 'Accept': 'application/vnd.github+json', 'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'atto-manifest-security-ci-gate/1' },
      redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) fail(`GitHub API HTTP ${response.status}; live verification unavailable`);
    const limit = 512 * 1024;
    const reader = response.body?.getReader();
    if (!reader) fail('GitHub API response has no body');
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) fail('GitHub API response exceeds 512 KiB');
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) {
    console.error('Usage: GITHUB_TOKEN=... node bin/verify-manifest-security-ci.mjs <candidate-receipt.json>');
    process.exitCode = 2;
  } else {
    try {
      const receipt = JSON.parse(readFileSync(file, { encoding: 'utf8' }));
      const outcome = await qualifyManifestSecurityCI(receipt, githubReader(process.env.GITHUB_TOKEN));
      console.log(JSON.stringify(outcome, null, 2));
      if (!outcome.ok) process.exitCode = 1;
    } catch (error) {
      console.error(`NOT_VERIFIED: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
