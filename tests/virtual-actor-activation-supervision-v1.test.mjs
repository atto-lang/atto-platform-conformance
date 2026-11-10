import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyVirtualActorGuestReceipt as classify } from "../lib/virtual-actor-guest-receipt-v1.mjs";

const contract = JSON.parse(await readFile(new URL(
  "../contracts/virtual-actor-activation-supervision-v1.json", import.meta.url), "utf8"));
const backends = ["java", "llvm", "net", "wasm", "forge"];
const h = "a".repeat(40), tree = "b".repeat(40), fixture = "c".repeat(64);
const expected = { headSha: h, treeSha: tree, fixtureSha256: fixture };
const candidate = () => ({
  ...expected, runnerId: 42,
  steps: [{ kind: "compiled-atto-guest", conclusion: "success" }],
  compilerBackedGuest: true, hostOnly: false, sourceFree: false,
  guestLogSha256: "d".repeat(64),
  jobUrl: "https://github.com/ores-truffle-oreslang/example/actions/runs/1/job/42",
  negativeMutationReceipts: [{ rejected: true, logSha256: "e".repeat(64) }]
});

test("all five backends remain explicitly without guest evidence", () => {
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.contract, "atto.virtual-actor-activation-supervision/1");
  assert.equal(contract.status, "CANDIDATE_UNATTESTED");
  assert.deepEqual(contract.backends, backends);
  assert.equal(contract.cases.length, 11);
  assert.equal(new Set(contract.cases.map(c => c.id)).size, 11);
  for (const c of contract.cases) {
    assert.ok(c.scenario.length > 20 && c.expected.length > 20, c.id);
    assert.deepEqual(Object.keys(c.backendStatus), backends, c.id);
    for (const b of backends) {
      assert.equal(c.backendStatus[b].status, "NOT_EXECUTED", c.id + "/" + b);
      assert.equal(c.backendStatus[b].guestReceipt, null, c.id + "/" + b);
    }
  }
});

test("lookup, single-flight, restart, admission, nonreentrancy and owner oracles are present", () => {
  for (const prefix of ["lookup.", "activation.", "admission.", "restart.",
                        "nonreentrancy.", "security.", "isolation."])
    assert.ok(contract.cases.some(c => c.id.startsWith(prefix)), prefix);
});

test("zero-step, missing-step and zero-runner IDs never imply guest success", () => {
  assert.equal(classify({ ...candidate(), steps: [] }, expected).classification,
    "UNVERIFIED_RUNNER_ADMISSION");
  assert.equal(classify({ ...candidate(), steps: null }, expected).classification,
    "UNVERIFIED_RUNNER_ADMISSION");
  assert.equal(classify({ ...candidate(), runnerId: 0 }, expected).classification,
    "UNVERIFIED_RUNNER_ADMISSION");
  assert.equal(classify({ ...candidate(), steps: [{ conclusion: "skipped" }] }, expected).classification,
    "UNVERIFIED_RUNNER_ADMISSION");
});

test("host-only canaries and mismatched exact source are never guest evidence", () => {
  assert.equal(classify({ ...candidate(), hostOnly: true }, expected).classification,
    "UNVERIFIED_HOST_ONLY");
  assert.equal(classify({ ...candidate(), sourceFree: true }, expected).classification,
    "UNVERIFIED_HOST_ONLY");
  assert.equal(classify({ ...candidate(), compilerBackedGuest: false }, expected).classification,
    "UNVERIFIED_HOST_ONLY");
  for (const field of ["headSha", "treeSha", "fixtureSha256"])
    assert.equal(classify({ ...candidate(), [field]: "f".repeat(40) }, expected).classification,
      "UNVERIFIED_IDENTITY", field);
});

test("guest steps, raw logs, negative mutations and independent review remain necessary", () => {
  assert.equal(classify({ ...candidate(), steps: [{ kind: "source-only", conclusion: "success" }] }, expected).classification,
    "UNVERIFIED_GUEST_EXECUTION");
  assert.equal(classify({ ...candidate(), guestLogSha256: null }, expected).classification,
    "UNVERIFIED_GUEST_EXECUTION");
  assert.equal(classify({ ...candidate(), negativeMutationReceipts: [] }, expected).classification,
    "UNVERIFIED_NEGATIVE_MUTATIONS");
  assert.equal(classify({ ...candidate(), negativeMutationReceipts:
    [{ rejected: false, logSha256: "e".repeat(64) }] }, expected).classification,
    "UNVERIFIED_NEGATIVE_MUTATIONS");
  // This status is never VERIFIED: real logs, compiler path, source tree, and
  // independent review must be checked outside a user-provided receipt object.
  assert.equal(classify(candidate(), expected).classification, "CANDIDATE_UNREVIEWED");
});
