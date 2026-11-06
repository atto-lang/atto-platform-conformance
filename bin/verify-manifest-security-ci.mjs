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
  const actual = Object.keys(object(value, name)).sort();
  if (actual.join('\0') !== [...keys].sort().join('\0')) fail(`${name}: unexpected or missing keys`);
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

      const commit = object(await api(`${base}/commits/${head}`), `${backend} commit`);
      if (commit.sha !== head || commit.commit?.tree?.sha !== tree) fail('exact source tree does not match GitHub');
      const workflow = object(await api(`${base}/contents/${workflowPath}?ref=${head}`), `${backend} workflow`);
      if (workflow.sha !== target.workflowSha || workflow.type !== 'file')
        fail('review-pinned workflow blob mismatch');

      const run = object(await api(`${base}/actions/runs/${runId}`), `${backend} run`);
      if (run.id !== runId || run.repository?.id !== target.id || run.head_sha !== head ||
          run.path !== workflowPath || run.event !== 'pull_request' ||
          run.status !== 'completed' || run.conclusion !== 'success')
        fail('workflow run is not a successful, exact-head source-owned PR run');
      const job = object(await api(`${base}/actions/jobs/${jobId}`), `${backend} job`);
      if (job.id !== jobId || job.run_id !== runId || job.status !== 'completed' ||
          job.conclusion !== 'success' || !Number.isSafeInteger(job.runner_id) || job.runner_id <= 0)
        fail('job never executed on a verified assigned runner');
      if (!Array.isArray(job.steps) || job.steps.length === 0)
        fail('NOT_EXECUTED: zero-step job cannot attest tests');
      for (const expected of requiredSteps[backend === 'forge' ? 'forge' : 'rust']) {
        const matches = job.steps.filter(s => s?.name === expected);
        if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success')
          fail(`required step missing, duplicate or not successful: ${expected}`);
      }
      if (!job.steps.some(s => /^Run actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683$/.test(s?.name) && s.conclusion === 'success'))
        fail('pinned checkout step missing or not successful');
      qualifications.push({ backend, head_sha: head, tree_sha: tree, run_id: runId, job_id: jobId,
        executed_steps: job.steps.filter(s => s.status === 'completed').length, status: 'CI_VERIFIED' });
    } catch (error) {
      errors.push(`${backend}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ok: errors.length === 0 && qualifications.length === 5,
    status: errors.length === 0 && qualifications.length === 5 ? 'CI_VERIFIED' : 'NOT_VERIFIED',
    qualifications, errors };
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
