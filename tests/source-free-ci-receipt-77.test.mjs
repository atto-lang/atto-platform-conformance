import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateFiveBackendEvidenceManifest} from "../src/five-backend-evidence-ledger.mjs";

const receipt = JSON.parse(readFileSync(
  new URL("../evidence/source-free-ci-77-38996750516.json", import.meta.url), "utf8"
));
const native = JSON.parse(readFileSync(
  new URL("../contracts/v1/semantics/five-backend-evidence.pending.json", import.meta.url),
  "utf8"
));
const backends = ["oreslang-source.java", "oreslang-source.llvm",
  "oreslang-source.net", "oreslang-source.wasm", "oreslang-source.forge"];
const blobs = {
  "scripts/verify_ci_run.py": "de7b3921a66c32f50115ee9933ef4e391ec34f8f",
  "scripts/test_verify_ci_run.py": "b73b3c06da3170294b5dfb589ba2131af217d268",
  ".github/workflows/ci-run-evidence-contract.yml": "36e375543b44b6c2cab3a1705f4a08a2dd40c9eb"
};

test("77x3 receipt is source-free and never native certification", () => {
  assert.equal(receipt.schema, "oreslang.source-free-ci-receipt.v1");
  assert.equal(receipt.sourceFreeOnly, true);
  for (const field of ["nativeCompilerExecuted", "nativeGuestExecuted",
    "nativeParityCertified", "privateSourceExportAuthorized"]) {
    assert.equal(receipt[field], false, field);
  }
  assert.equal(receipt.run.id, 38996750516);
  assert.equal(receipt.run.jobId, 117290889613);
  assert.equal(receipt.results.testsPerRound * receipt.results.rounds,
    receipt.results.expectedTotal);
  assert.equal(receipt.results.expectedTotal, 231);
  assert.match(receipt.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(receipt.pinnedGitBlobs, blobs);
  assert.deepEqual(Object.keys(receipt.backendPrHeads).sort(), backends.sort());
  for (const backend of backends) {
    assert.match(receipt.backendPrHeads[backend].sha, /^[a-f0-9]{40}$/);
    assert.ok(Number.isSafeInteger(receipt.backendPrHeads[backend].pr));
  }
});

test("separate native ledger remains exactly five pending, never certified", () => {
  assert.deepEqual(native.records.map(x=>x.backend).sort(), backends.sort());
  assert.ok(native.records.every(x => x.status === "pending" &&
    !Object.hasOwn(x, "execution")));
  const result = validateFiveBackendEvidenceManifest(native);
  assert.equal(result.nativeExecutionAuthenticated, false);
  assert.equal(result.authenticatedExecutionCount, 0);
  assert.equal(result.parityCertified, false);
  assert.equal(result.releaseReady, false);
  assert.equal(result.blocked.length, 5);
});

test("source-free receipt cannot be smuggled into native ledger", () => {
  const fake = structuredClone(native);
  fake.records[0].sourceFreeReceipt = receipt;
  assert.throws(() => validateFiveBackendEvidenceManifest(fake),
    /INVALID_FIVE_BACKEND_EVIDENCE/);
  const fakeExecution = structuredClone(native);
  fakeExecution.records[0].execution = receipt;
  assert.throws(() => validateFiveBackendEvidenceManifest(fakeExecution),
    /INVALID_FIVE_BACKEND_EVIDENCE/);
});
