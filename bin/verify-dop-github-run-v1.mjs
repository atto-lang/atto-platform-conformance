#!/usr/bin/env node
// Source-free REST correlation only. This is NOT compiler guest attestation.
import { readDopEvidenceJsonFile } from '../verification/dop-evidence-file-v1.mjs';
import { validateDopGithubSnapshot, validateDopGithubCommit } from '../verification/dop-github-run-snapshot-v1.mjs';
import { fetchDopGithubRun, fetchDopGithubCommit, validateGithubIdentity, requireCanonicalDopSourceRepo } from '../verification/dop-github-api-v1.mjs';
import { fetchAndValidatePinnedWorkflow } from '../verification/dop-workflow-source-v1.mjs';

async function main() {
  if (process.argv.length !== 5) throw new Error('usage: verify-dop-github-run-v1.mjs RECEIPT.json OWNER/REPO RUN_ID');
  const [receiptPath, repository, rawRunId] = process.argv.slice(2);
  const {id} = validateGithubIdentity(repository, rawRunId);
  const receipt = readDopEvidenceJsonFile(receiptPath);
  const contract = readDopEvidenceJsonFile(new URL('../contracts/dop-scalar-guest-v1/manifest.json', import.meta.url));
  requireCanonicalDopSourceRepo(receipt.backend, repository);
  if (receipt.ciJob?.runId !== Number(id)) throw new Error('receipt-run-id-mismatch');
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const {run, jobs} = await fetchDopGithubRun({repository, runId:id, token});
  const errors = validateDopGithubSnapshot(receipt, contract, run, jobs, repository);
  // Job IDs and steps alone do not attest the workflow source used on a PR.
  // Fetch only after the independent run/job snapshot matches; pin source bytes
  // to the exact recorded run commit, not a mutable branch/ref.
  if (errors.length === 0) {
    // The Actions API exposes the commit SHA but not its Git tree. Read the
    // immutable source-local Git commit before checking workflow contents.
    const commit = await fetchDopGithubCommit({
      backend:receipt.backend, repository, headSha:run.head_sha, token
    });
    errors.push(...validateDopGithubCommit(receipt, commit, repository));
  }
  if (errors.length === 0) {
    errors.push(...await fetchAndValidatePinnedWorkflow({
      backend:receipt.backend, repository, headSha:run.head_sha, token
    }));
  }
  // A matching REST job still does not establish executable/compiler/artifact provenance.
  console.log(JSON.stringify({classification:'GITHUB_JOB_CORRELATION_ONLY',
    result: errors.length ? 'REJECTED' : 'CORRELATED_NOT_GUEST_ATTESTED', errors}));
  process.exitCode = errors.length ? 1 : 0;
}

main().catch(error => {
  // Never print request objects, credentials, API bodies or raw error stacks.
  const reason = String(error?.message || 'unknown');
  const safe = /^(invalid-|evidence-|backend-|github-|missing-github-token|json-|receipt-run-id-mismatch|usage:)/.test(reason)
    ? reason : 'github-read-failed';
  console.error('DOP_GITHUB_RECEIPT_REJECTED: ' + safe);
  process.exitCode = 1;
});
