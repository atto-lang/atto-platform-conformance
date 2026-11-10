import {createHash} from "node:crypto";
import {lstatSync, readFileSync} from "node:fs";
import {resolve, sep} from "node:path";

export const REQUIRED_BACKENDS = Object.freeze(["java", "llvm", "net", "wasm", "forge"]);
export const PINS = Object.freeze({
  "scalar-parity": "9e3d2d230faaba5e1ccfeaf1c4449c0c2a120c34",
  "reject-int-and": "65cabaf87bbd1f3cfb9715662c7e4b34022a9050",
  "reject-int-or": "96aea7a5ec5a5866a0bf0a2bc58fe82c60edef20",
  "reject-int-xor": "563a33ba652263cc3cea3b6409a459742fa334c7",
  "reject-dead-and": "98d52a20112fd42c776c8aede139161363811add",
  "reject-dead-or": "5a053f32c327dc5f6652e3c11b5c7cf5001e8fb9",
  "reject-caret-xor": "fce35efd5ce310c5c964c1823879253a27b63020",
  "reject-double-caret-xor": "b969fd079e6eb5f9a56b3bbbad5a5a21e9ddb3a0",
  "short-circuit-and": "198c5d3812286c1390ee714db390abd730ec6fce",
  "short-circuit-or": "b7c02d57a0e75e1385a31f427dbfc619de19428a",
  "xor-eager": "4c34a92a224a7d7b59b5ff1df3d663dd1e6dc196",
  "xor-left-to-right": "f5e907fe908dcc758b97a9fe9646ea66eaa337f4"
});
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GUEST_STEPS = Object.freeze(["checkout-exact-head", "compile-atto", "execute-guest", "reject-negative-no-output"]);

export function gitBlob(raw) {
  if (!Buffer.isBuffer(raw)) throw new TypeError("raw Buffer required");
  return createHash("sha1").update("blob " + raw.length + "\0").update(raw).digest("hex");
}
export function validateLogicalContract(manifest, root) {
  if (manifest?.schema !== "attolang.logical-word-operators.crossbackend.v1" ||
      manifest.status !== "SOURCE_CONTRACT_NOT_BACKEND_EXECUTION" ||
      !Array.isArray(manifest.receipts) || manifest.receipts.length !== 0)
    throw Error("source-only logical contract cannot promote guest evidence");
  if (JSON.stringify(manifest.spelling) !== JSON.stringify({
    canonical:["and","xor","or"],precedence_tight_to_loose:["and","xor","or"],
    left_associative:true,operands:"bool-only-no-coercion",and:"short-circuit-ltr",
    or:"short-circuit-ltr",xor:"eager-on-success-ltr-once",removed:["^","^^"]
  })) throw Error("logical operator grammar/semantics drift");
  const names = Object.keys(manifest.backends ?? {}).sort();
  if (names.join(",") !== [...REQUIRED_BACKENDS].sort().join(","))
    throw Error("exactly five backends required");
  for (const name of REQUIRED_BACKENDS) {
    const b = manifest.backends[name];
    if (b?.repo !== "ores-truffle-oreslang/oreslang-source." + name ||
        b.state !== ({wasm:"NO_SCOPED_PR_FOUND_UNVERIFIED",forge:"REJECTION_ONLY_DRAFT_UNVERIFIED"}[name] ?? "DRAFT_UNVERIFIED") ||
        b.pr !== ({java:2648,llvm:1554,net:415,wasm:null,forge:241})[name])
      throw Error("backend identity or unverified status drift: " + name);
  }
  if (!Array.isArray(manifest.fixtures) ||
      manifest.fixtures.length !== Object.keys(PINS).length ||
      new Set(manifest.fixtures.map(f => f.id)).size !== Object.keys(PINS).length)
    throw Error("missing, extra or duplicated logical fixtures");
  const base = resolve(root), seen = {};
  for (const f of manifest.fixtures) {
    if (!Object.hasOwn(PINS,f.id) || f.git_blob !== PINS[f.id] ||
        f.path !== "fixtures/logical-word-operators-v1/" + f.id + ".atto" ||
        !SHA40.test(f.git_blob))
      throw Error("unrecognized logical fixture or wrong source SHA: " + f.id);
    const effects = ["short-circuit-and","short-circuit-or","xor-eager","xor-left-to-right"].includes(f.id);
    const expectedKind = f.id === "scalar-parity" || effects ? "GUEST_EXIT" : "COMPILE_REJECT_NO_OUTPUT";
    const expectedExit = f.id === "scalar-parity" || f.id.startsWith("xor-") && effects ? 42 : 1;
    if (f.profile !== (effects ? "borrow_mut_class_effects" : "baseline") ||
        f.kind !== expectedKind ||
        (expectedKind === "GUEST_EXIT"
          ? f.expected_exit !== expectedExit : Object.hasOwn(f,"expected_exit")))
      throw Error("logical fixture admission or expected outcome drift: " + f.id);
    const filename = resolve(base,f.path);
    if (!filename.startsWith(base + sep) || !lstatSync(filename).isFile())
      throw Error("logical fixture path is not an owned regular file");
    const bytes = readFileSync(filename);
    if (bytes.includes(0) || bytes.includes(13) || bytes.length > 16384 ||
        !bytes.toString("utf8").endsWith("\n") ||
        !Buffer.from(bytes.toString("utf8"),"utf8").equals(bytes))
      throw Error("invalid logical fixture bytes: " + f.id);
    if (gitBlob(bytes) !== f.git_blob) throw Error("logical fixture blob drift: " + f.id);
    seen[f.id] = f.git_blob;
  }
  return Object.freeze(seen);
}

/** Source-free receipt admission only. NEVER returns VERIFIED. */
export function assessLogicalReceipt(manifest, receipt) {
  const deny = reason => ({state:"NOT_VERIFIED",reason});
  if (manifest?.status !== "SOURCE_CONTRACT_NOT_BACKEND_EXECUTION" ||
      !receipt || !Object.hasOwn(manifest.backends ?? {},receipt.backend))
    return deny("UNTRUSTED_CONTRACT_OR_BACKEND");
  const b = manifest.backends[receipt.backend];
  if (receipt.claimed_state === "VERIFIED") return deny("SELF_ATTESTED_VERIFICATION_FORBIDDEN");
  if (receipt.repository !== b.repo || !SHA40.test(receipt.head_sha ?? "") ||
      !SHA40.test(receipt.tree_sha ?? "") || !SHA256.test(receipt.compiled_guest_sha256 ?? ""))
    return deny("HEAD_TREE_OR_COMPILED_GUEST_UNBOUND");
  if (typeof receipt.execution_repository !== "string" ||
      !/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(receipt.execution_repository))
    return deny("EXECUTION_REPOSITORY_UNBOUND");
  const job=receipt.job;
  if (!job || !Number.isSafeInteger(job.id) || job.id < 1 ||
      !Number.isSafeInteger(job.run_id) || job.run_id < 1 ||
      !Number.isSafeInteger(job.run_attempt) || job.run_attempt < 1 ||
      !Number.isSafeInteger(job.runner_id) || job.runner_id < 1 ||
      !Array.isArray(job.steps) || job.steps.length < GUEST_STEPS.length ||
      GUEST_STEPS.some(name => !job.steps.some(step => step?.name === name && step.status === "completed" && step.conclusion === "success")) ||
      job.steps.some(step => step?.status !== "completed" || step.conclusion !== "success"))
    return deny("NO_ADMITTED_EXECUTED_GUEST_STEPS");
  if (receipt.test_kind !== "COMPILER_LINKED_ATTO_GUEST" ||
      receipt.provenance_class !== "GUEST_NOT_HOST_OR_SOURCE_FREE" ||
      !["baseline","borrow_mut_class_effects"].includes(receipt.profile))
    return deny("HOST_CANARY_OR_COMPILER_ONLY_IS_NOT_GUEST");
  const required = manifest.fixtures.filter(f => f.profile === receipt.profile);
  if (!Array.isArray(receipt.cases) ||
      receipt.cases.length !== required.length ||
      new Set(receipt.cases.map(x => x.id)).size !== required.length)
    return deny("MISSING_OR_DUPLICATED_CASES");
  for (const f of required) {
    const c = receipt.cases.find(x => x.id === f.id);
    if (!c || c.input_blob !== f.git_blob ||
        (f.kind === "GUEST_EXIT"
          ? c.guest_exit_code !== f.expected_exit || c.compiled_and_linked !== true
          : !Number.isInteger(c.compiler_exit_code) || c.compiler_exit_code === 0 ||
            c.ir_bytes !== 0 || c.executable_bytes !== 0 || c.diagnostic_seen !== true))
      return deny("MISSING_GUEST_RESULT_OR_FAIL_CLOSED_NEGATIVE");
  }
  if (receipt.execution_repository !== b.repo) {
    const a=receipt.private_carrier_approval;
    if (a?.authorized !== true ||
        a.destination_repository !== receipt.execution_repository ||
        !Number.isSafeInteger(a.destination_repository_id) || a.destination_repository_id < 1 ||
        a.approved_source_tree !== receipt.tree_sha ||
        typeof a.independent_reviewer !== "string" || !a.independent_reviewer.trim())
      return deny("PRIVATE_SOURCE_EXPORT_NOT_AUTHORIZED");
  }
  return {state:"CANDIDATE_REQUIRES_LIVE_GITHUB_ATTESTATION_AND_INDEPENDENT_REVIEW",
    reason:"Source-free schema checks cannot authenticate step logs, exact compilation or guest behavior"};
}
