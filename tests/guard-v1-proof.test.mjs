import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {assessGuardReceipt, gitBlob, validateGuardContract}
  from "../lib/guard-v1-evidence.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const contract = JSON.parse(readFileSync(join(root, "contracts/guard-v1.json"), "utf8"));
const pins = {
  "scalar-success": "e2344e360ac643e25df7ca14eb01432929cecbe5",
  "failure-must-exit": "1ff87aa95ed2537839347e80984c69ae46fdfa17",
  "no-else": "b2bbee98cd3b95ac19462b4efd95a2e98b469154",
};
const clone = value => structuredClone(value);

test("source exact-blobs match five compiler repository fixtures, but prove no guest execution", () => {
  assert.deepEqual(validateGuardContract(contract, root), pins);
  assert.deepEqual(Object.keys(contract.backends).sort(), ["forge","java","llvm","net","wasm"]);
  assert.equal(contract.receipts.length, 0);
  const canonical = readFileSync(join(root, "fixtures/guard-v1/canonical-scalar.atto"), "utf8");
  assert.match(canonical, /\\bx neq 5\\b/);
  assert.doesNotMatch(canonical, /\\bx != 5\\b/);
  for (const [name, x] of Object.entries(contract.backends)) {
    assert.ok(["AUTHORED_UNVERIFIED","REJECTION_ONLY_UNVERIFIED","CONTRACT_ONLY"].includes(x.state), name);
  }
});

test("manifest cannot self-upgrade any backend or inject unverifiable receipts", () => {
  for (const broken of [
    {...contract, status: "VERIFIED"},
    {...contract, receipts: [{success: true}]},
    {...contract, backends: {...contract.backends, llvm: {...contract.backends.llvm, state:"VERIFIED"}}},
    {...contract, backends: {...contract.backends, js: {repo:"other", state:"CONTRACT_ONLY"}}},
    {...contract, fixtures: contract.fixtures.slice(1)},
  ]) assert.throws(() => validateGuardContract(broken, root));
});

test("fixture bytes are pinned to immutable Git blob checksums, not names alone", () => {
  const temporary = mkdtempSync(join(tmpdir(), "atto-guard-proof-"));
  try {
    mkdirSync(join(temporary, "fixtures", "guard-v1"), {recursive:true});
    for (const f of contract.fixtures) {
      writeFileSync(join(temporary, f.path), readFileSync(join(root, f.path)));
    }
    assert.deepEqual(validateGuardContract(contract, temporary), pins);
    const positive = contract.fixtures[0];
    const raw = readFileSync(join(temporary, positive.path));
    assert.equal(gitBlob(raw), positive.git_blob);
    writeFileSync(join(temporary, positive.path), Buffer.concat([raw, Buffer.from([10])]));
    assert.throws(() => validateGuardContract(contract, temporary), /blob drift/);
    writeFileSync(join(temporary, positive.path), Buffer.concat([raw, Buffer.from([0])]));
    assert.throws(() => validateGuardContract(contract, temporary), /malformed UTF-8/);
  } finally {rmSync(temporary, {recursive:true, force:true});}
});

const baseline = {
  backend:"llvm",
  repository:"ores-truffle-oreslang/oreslang-source.llvm",
  execution_repository:"ores-truffle-oreslang/oreslang-source.llvm",
  source_org:"ores-truffle-oreslang",
  head_sha:"a".repeat(40),
  tree_sha:"b".repeat(40),
  compiled_executable_sha:"c".repeat(40),
  job:{
    runner_id:123,
    run_attempt:1,
    id:1234,
    steps:[{number:1,status:"completed",conclusion:"success"}]
  },
  test_kind:"COMPILER_LINKED_GUEST",
  provenance_class:"GUEST_NOT_HOST_MODEL",
  positive_result:42,
  negative_no_ir:true,
  input_blobs: {...pins}
};

test("no runner, absent steps, canceled jobs, or fake success can establish a proof", () => {
  for (const mutation of [
    {job:{...baseline.job, steps:null}},
    {job:{...baseline.job, steps:[]}},
    {job:{...baseline.job, runner_id:0}},
    {job:{...baseline.job, steps:[{number:1,status:"queued",conclusion:null}]}},
    {job:{...baseline.job, steps:[{number:1,status:"completed",conclusion:"failure"}]}},
    {test_kind:"HOST_SOURCE_FREE_MODEL"},
    {negative_no_ir:false},
    {positive_result:0},
    {compiled_executable_sha:null},
    {head_sha:"unknown"},
    {execution_repository:null},
    {execution_repository:"other-test-org/hnpt-e2e"},
    {tree_sha:"unknown"},
    {input_blobs:{"scalar-success":pins["scalar-success"]}},
    {input_blobs:{...pins,"no-else":"d".repeat(40)}},
  ]) {
    const result = assessGuardReceipt(contract, {...clone(baseline),...mutation});
    assert.equal(result.state, "NOT_VERIFIED", JSON.stringify(mutation));
  }
});

test("cross-org source export is denied unless independently approved against exact tree", () => {
  const cross={...clone(baseline),
    // Deliberately spoof the source_org field: it must not authorize export.
    source_org:"ores-truffle-oreslang",
    execution_repository:"other-test-org/hnpt-e2e"};
  assert.deepEqual(assessGuardReceipt(contract,cross).reason,
    "PRIVATE_CROSS_REPOSITORY_EXPORT_NOT_AUTHORIZED");
  cross.private_carrier_approval={
    authorized:true,
    destination_repository:"other-test-org/hnpt-e2e",
    destination_repository_id:1,
    approved_source_tree:"d".repeat(40),
    independent_reviewer:"other-reviewer"
  };
  assert.equal(assessGuardReceipt(contract,cross).state,"NOT_VERIFIED");
  cross.private_carrier_approval.approved_source_tree=cross.tree_sha;
  assert.match(assessGuardReceipt(contract,cross).state,/CANDIDATE_REQUIRES/);
  const sameOrg={...clone(baseline),execution_repository:"ores-truffle-oreslang/unlisted-private-carrier"};
  assert.equal(assessGuardReceipt(contract,sameOrg).reason,
    "PRIVATE_CROSS_REPOSITORY_EXPORT_NOT_AUTHORIZED");
});

test("even a perfectly shaped receipt remains a candidate, never verified by this source-free oracle", () => {
  const result=assessGuardReceipt(contract,baseline);
  assert.equal(result.state,"CANDIDATE_REQUIRES_LIVE_VERIFICATION_AND_INDEPENDENT_REVIEW");
  assert.doesNotMatch(result.state,/^VERIFIED$/);
});
