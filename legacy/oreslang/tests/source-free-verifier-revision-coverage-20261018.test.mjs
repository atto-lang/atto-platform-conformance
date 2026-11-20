import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateFiveBackendEvidenceManifest} from "../src/five-backend-evidence-ledger.mjs";

const receipt = JSON.parse(readFileSync(new URL("../evidence/source-free-verifier-revision-coverage-20261018.json", import.meta.url), "utf8"));
const pending = JSON.parse(readFileSync(
  new URL("../contracts/v1/semantics/five-backend-evidence.pending.json", import.meta.url), "utf8"));
const hex40 = /^[a-f0-9]{40}$/;
const hex64 = /^[a-f0-9]{64}$/;

test("86x3 successful hosted result is accurately scoped to historical source-free files", () => {
  assert.equal(receipt.schema, "oreslang.source_free_revision_coverage.v1");
  assert.equal(receipt.classification, "SOURCE_FREE_GITHUB_VERIFIER_ONLY_NOT_NATIVE_EXECUTION");
  const {carrierReceipt: old, coverage} = receipt;
  assert.equal(old.repositoryId, 1323598260);
  assert.equal(old.private, true);
  assert.equal(old.runId, 38998666203);
  assert.equal(old.jobId, 117296734652);
  assert.equal(old.artifactId, 12088012140);
  assert.ok(hex64.test(old.artifactSha256));
  assert.equal(old.artifactSha256, "d8777abb23a68844c6323fc90f1e92738e54d7e26eb53d05108f74aadbb204be");
  assert.deepEqual([old.testsPerRound, old.rounds, old.executedTotal], [86, 3, 258]);
  assert.equal(old.testsPerRound * old.rounds, old.executedTotal);
  assert.equal(coverage.carrierCoversHistoricalRevision, true);
  assert.equal(coverage.carrierCoversCurrentCandidate, false);
  assert.equal(coverage.reason, "CURRENT_91_TEST_BLOBS_DIFFER_FROM_EXECUTED_86_TEST_BLOBS");
});

test("all five reviewed PRs share a newer unexecuted three-blob revision", () => {
  const {carrierReceipt: old, candidateSnapshot: now} = receipt;
  assert.equal(now.observedTestDefinitions, 91);
  assert.equal(now.testCountProvenByHostedRun, false);
  assert.equal(now.verifiedSameThreeBlobsOnFiveHeads, true);
  assert.equal(now.backendPrHeads.length, 5);
  assert.equal(new Set(now.backendPrHeads.map(x => x.backend)).size, 5);
  for (const [path, newSha] of Object.entries(now.verifierBlobs)) {
    assert.ok(hex40.test(newSha), `invalid candidate Git blob for ${path}`);
    assert.ok(hex40.test(old.blobs[path]));
    assert.notEqual(newSha, old.blobs[path], `old executed blob MUST NOT cover new ${path}`);
  }
  for (const item of now.backendPrHeads) {
    assert.ok(hex40.test(item.sha));
    assert.ok(Number.isSafeInteger(item.pr) && item.pr > 0);
  }
});

test("revision coverage NEVER authenticates native compiler or guest parity", () => {
  for (const key of ["nativeCompilerExecuted","nativeGuestExecuted",
    "nativeParityCertified","privateSourceExportAuthorized","releaseReady"]) {
    assert.equal(receipt.coverage[key], false, key);
  }
  assert.equal(receipt.coverage.allFiveNativeEvidencePending, true);
  assert.deepEqual(new Set(pending.records.map(x=>x.backend)),
    new Set(receipt.candidateSnapshot.backendPrHeads.map(x=>x.backend)));
  assert.ok(pending.records.every(x=>x.status==="pending" && !Object.hasOwn(x, "execution")));
  const result = validateFiveBackendEvidenceManifest(pending);
  assert.equal(result.authenticatedExecutionCount, 0);
  assert.equal(result.parityCertified, false);
  assert.equal(result.releaseReady, false);
  assert.equal(result.blocked.length, 5);
});
