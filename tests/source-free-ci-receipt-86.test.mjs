import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateFiveBackendEvidenceManifest} from "../src/five-backend-evidence-ledger.mjs";

const receipt = JSON.parse(readFileSync(
  new URL("../evidence/source-free-ci-86-38998516318.json", import.meta.url), "utf8"));
const native = JSON.parse(readFileSync(
  new URL("../contracts/v1/semantics/five-backend-evidence.pending.json", import.meta.url), "utf8"));

const expectedHeads = {
  "oreslang-source.java": ["9b303de2ef3d96dea4f75129704c7201b00df2e0", 1112],
  "oreslang-source.llvm": ["5859c447ccd0c1235629ba4a4f8e113a113ae7b2", 495],
  "oreslang-source.net": ["5630c28fdb21d6f5bb07b44c800c53ce8f6aef42", 56],
  "oreslang-source.wasm": ["b1acffed5503df9c681cf2c910889ee199a96c4c", 52],
  "oreslang-source.forge": ["a56358127e03c37083c5061b7cfaf6e8d662c594", 50]
};
const expectedBlobs = {
  "scripts/verify_ci_run.py": "26868f6f8e423a038e32ed56ef09da7fcdb43b52",
  "scripts/test_verify_ci_run.py": "9d268ba9fa019fa96d3439b64dee0b9fadfdf0cf",
  ".github/workflows/ci-run-evidence-contract.yml": "3af5567b01dfa757b52c31bd6da09711bd780593"
};

test("86x3 carrier source-free receipt never certifies Oreslang guest execution", () => {
  assert.equal(receipt.schema, "oreslang.source-free-ci-receipt.v1");
  assert.equal(receipt.classification, "SOURCE_FREE_CI_SECURITY_REGRESSIONS_ONLY");
  assert.equal(receipt.sourceFreeOnly, true);
  for (const key of ["nativeCompilerExecuted", "nativeGuestExecuted",
    "nativeParityCertified", "privateSourceExportAuthorized"]) {
    assert.equal(receipt[key], false, key);
  }
  assert.equal(receipt.carrier.repositoryId, 1323598260);
  assert.equal(receipt.run.id, 38998516318);
  assert.equal(receipt.run.attempt, 1);
  assert.equal(receipt.run.jobId, 117296273366);
  assert.equal(receipt.run.conclusion, "success");
  assert.equal(receipt.artifact.id, 12088435863);
  assert.equal(receipt.artifact.sha256,
    "2728c4a06f228235b6c3e28c962ebab08252bfcd960eecbac8c87627066a1866");
  assert.equal(receipt.results.testsPerRound, 86);
  assert.equal(receipt.results.rounds, 3);
  assert.equal(receipt.results.expectedTotal, 258);
  assert.equal(receipt.results.testsPerRound * receipt.results.rounds, 258);
  assert.deepEqual(receipt.pinnedGitBlobs, expectedBlobs);
});

test("all five new PR heads are pinned and native evidence remains five pending", () => {
  assert.deepEqual(Object.keys(receipt.backendPrHeads).sort(),
    Object.keys(expectedHeads).sort());
  for (const [backend, [sha, pr]] of Object.entries(expectedHeads)) {
    assert.deepEqual(receipt.backendPrHeads[backend], {pr, sha});
  }
  assert.deepEqual(native.records.map(x => x.backend).sort(),
    Object.keys(expectedHeads).sort());
  assert.ok(native.records.every(r => r.status === "pending" &&
    !Object.hasOwn(r, "execution")));
  const result = validateFiveBackendEvidenceManifest(native);
  assert.equal(result.authenticatedExecutionCount, 0);
  assert.equal(result.nativeExecutionAuthenticated, false);
  assert.equal(result.parityCertified, false);
  assert.equal(result.releaseReady, false);
  assert.equal(result.blocked.length, 5);
});

test("the receipt cannot be grafted into the native execution schema", () => {
  const fake = structuredClone(native);
  fake.records[0].sourceFreeReceipt = receipt;
  assert.throws(() => validateFiveBackendEvidenceManifest(fake),
    /INVALID_FIVE_BACKEND_EVIDENCE/);
  const fakeClaim = structuredClone(native);
  fakeClaim.records[0].status = "executed-claimed";
  fakeClaim.records[0].execution = receipt;
  delete fakeClaim.records[0].reason;
  assert.throws(() => validateFiveBackendEvidenceManifest(fakeClaim),
    /INVALID_FIVE_BACKEND_EVIDENCE/);
});
