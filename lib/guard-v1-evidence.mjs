import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve, sep} from "node:path";

export const REQUIRED_BACKENDS = Object.freeze(["java", "llvm", "net", "wasm", "forge"]);
export const REQUIRED_FIXTURES = Object.freeze([
  "scalar-success", "failure-must-exit", "no-else",
]);
const SHA = /^[a-f0-9]{40}$/;

export function gitBlob(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError("gitBlob requires raw UTF-8 bytes");
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}

/**
 * Verify source *identity* only. This has no compiler execution path.
 * Reject path traversal, missing, changed, or mischaracterized fixtures.
 */
export function validateGuardContract(contract, root) {
  if (contract?.schema !== "attolang.guard.crossbackend.v1" ||
      contract.status !== "SOURCE_CONTRACT_NOT_BACKEND_EXECUTION" ||
      !Array.isArray(contract.receipts) || contract.receipts.length !== 0) {
    throw Error("guard contract cannot claim guest execution or embed unreviewed receipts");
  }
  const names = Object.keys(contract.backends ?? {}).sort();
  if (names.join(",") !== [...REQUIRED_BACKENDS].sort().join(",")) {
    throw Error("guard contract requires exactly five compiler backends");
  }
  for (const [name, entry] of Object.entries(contract.backends)) {
    if (entry.repo !== "ores-truffle-oreslang/oreslang-source." + name ||
        !Number.isInteger(entry.pr) || entry.pr < 1 ||
        !["CONTRACT_ONLY", "REJECTION_ONLY_UNVERIFIED", "AUTHORED_UNVERIFIED"].includes(entry.state)) {
      throw Error("unverified backend state or mismatched identity: " + name);
    }
  }
  if (!Array.isArray(contract.fixtures) ||
      contract.fixtures.length !== REQUIRED_FIXTURES.length ||
      new Set(contract.fixtures.map(x => x.id)).size !== REQUIRED_FIXTURES.length ||
      REQUIRED_FIXTURES.some(id => !contract.fixtures.some(x => x.id === id))) {
    throw Error("guard fixture inventory does not match required acceptance cases");
  }
  const base = resolve(root);
  const identities = {};
  for (const item of contract.fixtures) {
    if (!SHA.test(item.git_blob) || typeof item.path !== "string" ||
        !/^fixtures\/guard-v1\/[a-z-]+\.atto$/.test(item.path)) {
      throw Error("malformed source identity for " + item.id);
    }
    const full = resolve(base, item.path);
    if (!full.startsWith(base + sep)) throw Error("fixture path escapes contract root");
    const bytes = readFileSync(full);
    if (bytes.includes(0) || !bytes.equals(Buffer.from(bytes.toString("utf8"), "utf8")) ||
        !bytes.toString("utf8").endsWith("\n") || bytes.includes(13)) {
      throw Error("malformed UTF-8 source file: " + item.path);
    }
    const got = gitBlob(bytes);
    if (got !== item.git_blob) throw Error("guard source blob drift: " + item.id);
    if (item.id === "scalar-success" &&
        (item.kind !== "NATIVE_GUEST_RETURN" || item.expected_integer !== 42)) {
      throw Error("positive guard witness must return integer 42");
    }
    if (item.id !== "scalar-success" && item.kind !== "COMPILE_REJECT_NO_IR") {
      throw Error("negative case must be a compiler rejection with no emitted IR");
    }
    identities[item.id] = got;
  }
  return Object.freeze(identities);
}

/**
 * Reject incomplete/unauthorized proof data. Even a fully shaped candidate
 * is NOT verified by a source-free validator; live GitHub evidence and an
 * independent review must authenticate it.
 */
export function assessGuardReceipt(contract, receipt) {
  const denied = reason => ({state: "NOT_VERIFIED", reason});
  if (!receipt || !contract || !Object.hasOwn(contract.backends, receipt.backend))
    return denied("UNKNOWN_BACKEND");
  const entry = contract.backends[receipt.backend];
  if (receipt.repository !== entry.repo || !SHA.test(receipt.head_sha ?? "") ||
      !SHA.test(receipt.tree_sha ?? "") || !SHA.test(receipt.compiled_executable_sha ?? ""))
    return denied("UNBOUND_PR_OR_EXECUTABLE_IDENTITY");
  if (typeof receipt.execution_repository !== "string" ||
      !/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(receipt.execution_repository)) {
    return denied("MISSING_EXECUTION_REPOSITORY_BINDING");
  }
  if (!receipt.job || !Number.isInteger(receipt.job.runner_id) ||
      receipt.job.runner_id <= 0 ||
      !Number.isInteger(receipt.job.run_attempt) || receipt.job.run_attempt <= 0 ||
      !Number.isInteger(receipt.job.id) || receipt.job.id <= 0 ||
      !Array.isArray(receipt.job.steps) || receipt.job.steps.length < 1 ||
      receipt.job.steps.some(step => step?.status !== "completed" ||
          step?.conclusion !== "success" ||
          !Number.isInteger(step.number) || step.number < 1))
    return denied("NO_EXECUTED_RUNNER_STEPS");
  if (receipt.test_kind !== "COMPILER_LINKED_GUEST" ||
      receipt.positive_result !== 42 ||
      receipt.negative_no_ir !== true ||
      receipt.provenance_class !== "GUEST_NOT_HOST_MODEL") {
    return denied("INSUFFICIENT_GUEST_AND_NEGATIVE_PROOF");
  }
  const supplied = receipt.input_blobs;
  if (!supplied || contract.fixtures.some(x => supplied[x.id] !== x.git_blob) ||
      Object.keys(supplied).length !== contract.fixtures.length)
    return denied("SOURCE_BLOB_MISMATCH");
  // A self-reported source_org does not prove where a job executed.
  // The execution repository must be authenticated against GitHub live data;
  // a different repo is an export even when the same organization owns it.
  if (receipt.execution_repository !== entry.repo) {
    const approval = receipt.private_carrier_approval;
    if (!approval || approval.authorized !== true ||
        !Number.isInteger(approval.destination_repository_id) ||
        approval.destination_repository_id < 1 ||
        approval.destination_repository !== receipt.execution_repository ||
        !SHA.test(approval.approved_source_tree ?? "") ||
        approval.approved_source_tree !== receipt.tree_sha ||
        typeof approval.independent_reviewer !== "string" ||
        !approval.independent_reviewer.trim()) {
      return denied("PRIVATE_CROSS_REPOSITORY_EXPORT_NOT_AUTHORIZED");
    }
  }
  return {state: "CANDIDATE_REQUIRES_LIVE_VERIFICATION_AND_INDEPENDENT_REVIEW",
    reason: "Static receipt shape cannot authenticate GitHub step logs or compiler execution"};
}
