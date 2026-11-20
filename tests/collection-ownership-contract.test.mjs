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
  assert.equal(cases.length, 18);
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

test("candidate rejection fixtures are valid .atto files and cannot claim parser-only parity", () => {
  const expected = [
    "sender-use-after-take",
    "readonly-view-writable-backing-share",
    "mutable-borrow-task-escape",
    "borrowed-mutex-initializer",
    "mutex-use-after-consume",
    "guard-suspend-await"
  ];
  const present = contract.scenarios.filter(c => c.fixture && c.expectation === "reject");
  assert.deepEqual(present.map(c => c.id), expected);
  for (const c of present) {
    assert.equal(c.kind, "compiler", c.id);
    assert.equal(c.expectation, "reject", c.id);
    assert.equal(c.rejectionEvidenceRequired, "semantic-ownership-diagnostic", c.id);
    assert.equal(c.fixture, `fixtures/collection-ownership-sync-v1/${c.id}.atto`);
    const source = readFileSync(new URL(`../${c.fixture}`, import.meta.url), "utf8");
    assert.match(source, /pub (async )?fnc main\(\)/);
    assert.ok(source.length >= 80, c.id);
  }
  assert.equal(contract.promotion.semanticRejectionRequired, true);
  assert.equal(contract.promotion.unsupportedSyntaxDoesNotPass, true);
});

test("positive collection fixtures prohibit reject-everything false parity", () => {
  const expected = [
    "ordinary-owned-local-mutation",
    "owned-mutex-guard-mutation"
  ];
  const positive = contract.scenarios.filter(
    c => c.fixture && c.expectation === "accept");
  assert.deepEqual(positive.map(c => c.id), expected);
  for (const c of positive) {
    assert.equal(c.kind, "compiler-runtime");
    assert.equal(c.attestation, "unattested");
    assert.equal(c.fixture, `fixtures/collection-ownership-sync-v1/${c.id}.atto`);
    const source = readFileSync(new URL(`../${c.fixture}`, import.meta.url), "utf8");
    assert.match(source, /pub fnc main\(\): void/);
    assert.match(source, /\.set\(0,/);
    assert.ok(source.includes("return;"), c.id);
  }
  const positiveWithMutex = positive.find(c => c.id === "owned-mutex-guard-mutation");
  assert.ok(positiveWithMutex);
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
