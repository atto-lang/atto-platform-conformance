import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/collection-ownership-sync-v1.json", import.meta.url), "utf8"));

test("collection safety matrix is a candidate, not claimed backend evidence", () => {
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.contract, "collection-ownership-sync-v1");
  assert.equal(contract.status, "candidate-unattested");
  assert.equal(contract.sourceExtension, ".atto");
  assert.deepEqual(contract.backendTargets, ["java", "llvm", "wasm", "forge", "net"]);
  assert.deepEqual(Object.keys(contract.evidence), contract.backendTargets);
  for (const backend of contract.backendTargets) {
    assert.equal(contract.evidence[backend], "unattested");
  }
});

test("all scenarios are unique, explicit and unattested", () => {
  const cases = contract.scenarios;
  assert.equal(cases.length, 16);
  assert.equal(new Set(cases.map(x => x.id)).size, cases.length);
  for (const c of cases) {
    assert.match(c.id, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
    assert.ok(["compiler", "compiler-runtime", "runtime"].includes(c.kind));
    assert.ok(["accept", "reject"].includes(c.expectation));
    assert.ok(c.requirement.length >= 20);
    assert.equal(c.attestation, "unattested");
  }
  const byId = new Map(cases.map(c => [c.id, c]));
  for (const id of [
    "sender-use-after-take",
    "readonly-view-writable-backing-share",
    "readonly-view-wrapper-laundering",
    "mutable-borrow-task-escape",
    "borrowed-mutex-initializer",
    "mutex-use-after-consume",
    "guard-suspend-await",
    "guard-view-iterator-escape",
    "independent-sync-proof-scoped-task-read"
  ]) assert.equal(byId.get(id)?.expectation, "reject", id);
  assert.equal(byId.get("scalar-tuple-scoped-task-read")?.expectation, "accept");
});

test("promotion does not accept source-free or runner-free substitutes", () => {
  const p = contract.promotion;
  for (const key of [
    "sourceFixturesRequired",
    "guestCompilerExecutionRequired",
    "guestRuntimeExecutionRequiredForRuntimeCases",
    "identicalScenarioIdsAcrossFiveBackends",
    "exactCommitAndTreeRequired",
    "wasmWorkerExecutionRequired",
    "privateSourceTransferRequiresSecurityApproval"
  ]) assert.equal(p[key], true, key);
  for (const key of [
    "zeroStepJobsCount",
    "parserOnlyRejectionCountsAsParity",
    "hostModelAloneCountsAsParity"
  ]) assert.equal(p[key], false, key);
  assert.deepEqual(p.nativeSanitizersRequired, ["llvm", "forge"]);
  assert.deepEqual(p.aotRequiredFor, ["java", "net"]);
});
