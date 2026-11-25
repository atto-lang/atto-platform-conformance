import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyVirtualActorGuestReceipt as classify } from "../lib/virtual-actor-guest-receipt-v1.mjs";

const contract = JSON.parse(await readFile(new URL(
  "../contracts/virtual-actor-activation-supervision-v1.json", import.meta.url), "utf8"));
const backends = ["java", "llvm", "net", "wasm", "forge"];
const mutations = ["stale-generation", "foreign-supervisor", "nonreentrant-overlap"];
const expected = {
  headSha: "a".repeat(40), treeSha: "b".repeat(40),
  fixtureSha256: "c".repeat(64),
  repoFullName: "ores-truffle-oreslang/example",
  requiredNegativeMutations: mutations
};
const candidate = () => ({
  ...expected, runnerId: 42, runId: 123, jobId: 456, runAttempt: 1,
  jobUrl: "https://github.com/ores-truffle-oreslang/example/actions/runs/123/job/456",
  jobStatus: "completed", jobConclusion: "success",
  steps: [{ number: 1, status: "completed", kind: "compiled-atto-guest",
            conclusion: "success", executedTests: 3 }],
  compilerBackedGuest: true, hostOnly: false, sourceFree: false,
  guestLogSha256: "d".repeat(64),
  negativeMutationReceipts: mutations.map(mutationId => ({
    mutationId, rejected: true, executedTests: 1, logSha256: "e".repeat(64)
  }))
});
const status = receipt => classify(receipt, expected).classification;

test("all five backends remain explicitly WITHOUT guest evidence", () => {
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
test("lookup, single-flight, restart, admission, nonreentrancy and owner oracles exist", () => {
  for (const prefix of ["lookup.", "activation.", "admission.", "restart.",
                         "nonreentrancy.", "security.", "isolation."])
    assert.ok(contract.cases.some(c => c.id.startsWith(prefix)), prefix);
});
test("missing/zero runner, empty, skipped, and never-completed steps are admissions", () => {
  for (const bad of [
    { runnerId: 0 }, { runnerId: null }, { runnerId: undefined }, { runnerId: -1 },
    { steps: null }, { steps: [] },
    { steps: [{ number: 1, status: "completed", conclusion: "skipped" }] },
    { steps: [{ number: 1, status: "in_progress", conclusion: null }] },
    { steps: [{ conclusion: "success", kind: "compiled-atto-guest" }] }
  ]) assert.equal(status({ ...candidate(), ...bad }), "UNVERIFIED_RUNNER_ADMISSION");
});
test("host canaries cannot impersonate compiler-backed guests", () => {
  for (const bad of [
    { hostOnly: true }, { sourceFree: true },
    { compilerBackedGuest: false }, { compilerBackedGuest: undefined }
  ]) assert.equal(status({ ...candidate(), ...bad }), "UNVERIFIED_HOST_ONLY");
});
test("head, tree and fixture identity mismatches fail closed", () => {
  for (const field of ["headSha", "treeSha", "fixtureSha256"])
    assert.equal(status({ ...candidate(), [field]: "f".repeat(40) }),
      "UNVERIFIED_IDENTITY", field);
  assert.equal(classify(candidate(), { ...expected, treeSha: null }).classification,
    "UNVERIFIED_IDENTITY");
});
test("job URL, run, job, attempt and repository must bind", () => {
  for (const bad of [
    { runId: 0 }, { runId: null }, { jobId: 0 }, { runAttempt: 0 },
    { runAttempt: undefined }, { repoFullName: "other/repo" },
    { jobUrl: "https://github.com/other/repo/actions/runs/123/job/456" },
    { jobUrl: "https://github.com/ores-truffle-oreslang/example/actions/runs/123/job/999" }
  ]) assert.equal(status({ ...candidate(), ...bad }), "UNVERIFIED_JOB_IDENTITY");
});
test("a real completed guest step with executed tests is structurally necessary", () => {
  for (const bad of [
    { jobStatus: "queued" }, { jobConclusion: "failure" },
    { guestLogSha256: null },
    { steps: [{ number: 1, status: "completed", conclusion: "success", kind: "host-only" }] },
    { steps: [{ number: 1, status: "completed", conclusion: "success",
                kind: "compiled-atto-guest", executedTests: 0 }] }
  ]) assert.equal(status({ ...candidate(), ...bad }), "UNVERIFIED_GUEST_EXECUTION");
});
test("required negative mutations must each be distinct and executed", () => {
  const base = candidate();
  for (const bad of [
    [],
    base.negativeMutationReceipts.slice(1),
    [...base.negativeMutationReceipts, base.negativeMutationReceipts[0]],
    base.negativeMutationReceipts.map((x, i) => i ? x : { ...x, rejected: false }),
    base.negativeMutationReceipts.map((x, i) => i ? x : { ...x, executedTests: 0 }),
    base.negativeMutationReceipts.map((x, i) => i ? x : { ...x, logSha256: null })
  ]) assert.equal(status({ ...base, negativeMutationReceipts: bad }),
    "UNVERIFIED_NEGATIVE_MUTATIONS");
  assert.equal(classify(base, { ...expected, requiredNegativeMutations: [] }).classification,
    "UNVERIFIED_NEGATIVE_MUTATIONS");
});
test("even perfect self-reported shapes are UNREVIEWED, never attested", () => {
  assert.equal(status(candidate()), "CANDIDATE_UNREVIEWED");
});
