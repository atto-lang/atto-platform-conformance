import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const EXPECTED_BACKENDS = ["java", "llvm", "wasm", "forge", "net"];
const EXPECTED_CASE_IDS = [
  "typed-two-node-graph",
  "independent-actors",
  "stale-slot-reuse",
  "generation-exhaustion",
  "wrong-nominal-target",
  "reference-field-raw-write",
  "typed-scalar-tearing",
  "cross-actor-reference-send",
  "drop-under-read-loan",
  "turn-retained-loan",
  "stop-physical-reclaim",
  "allocation-failure-transactional",
  "panic-raise-throw-cleanup",
  "await-suspension-borrow",
  "whole-actor-zero-gc"
];
const SHA40 = /^[a-f0-9]{40}$/;
const REPO_PREFIX = "ores-truffle-oreslang/oreslang-source.";

function deny(reason) {
  throw new Error("actor-ref32-five-backend-v1: " + reason);
}

export function gitBlobSha1(content) {
  const payload = Buffer.from(content, "utf8");
  return createHash("sha1")
    .update(Buffer.from("blob " + payload.length + "\0"))
    .update(payload)
    .digest("hex");
}

/**
 * Validate the source-only contract, not runtime or compiler execution.
 * Any evidence promotion requires an independently verified receipt schema,
 * never simply changing source-free statuses in this manifest.
 */
export function validateActorRef32FiveBackendV1(manifest, source) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    deny("manifest must be an object");
  if (manifest.schemaVersion !== 1 ||
      manifest.id !== "actor-ref32-five-backend-v1" ||
      manifest.sourceExtension !== ".atto" ||
      manifest.status !== "SOURCE_ONLY_NOT_CERTIFIED" ||
      manifest.zeroGcCertified !== false)
    deny("scope or certification claims changed");
  if (manifest.physicalReferenceRepresentation !==
      "backend-private; no cross-actor wire ABI")
    deny("local reference must not be treated as a wire capability");
  if (!Array.isArray(manifest.backends) ||
      manifest.backends.length !== EXPECTED_BACKENDS.length)
    deny("five backend inventory required");
  for (let i = 0; i < EXPECTED_BACKENDS.length; i++) {
    const backend = manifest.backends[i];
    const id = EXPECTED_BACKENDS[i];
    if (!backend || backend.id !== id ||
        backend.repository !== REPO_PREFIX + id ||
        !SHA40.test(backend.observedMainHead) ||
        backend.certified !== false ||
        backend.guestExecuted !== false ||
        backend.exactHeadReceipt !== null ||
        typeof backend.implementation !== "string" ||
        backend.implementation.length < 25)
      deny("backend is missing or falsely certified: " + id);
  }
  const fixture = manifest.fixture;
  if (!fixture ||
      fixture.path !== "fixtures/actor-ref32-five-backend-v1/node_graph.atto" ||
      fixture.status !== "source-only" ||
      !SHA40.test(fixture.gitBlobSha1) ||
      typeof source !== "string" ||
      !source.endsWith("\n") ||
      source.includes("\r") ||
      Buffer.from(source, "utf8").length > 16 * 1024 ||
      gitBlobSha1(source) !== fixture.gitBlobSha1)
    deny("canonical fixture path, bounds, encoding or Git blob mismatch");
  if (!source.includes("define class Node as") ||
      !source.includes("define actor HeapGraphProbe as") ||
      !source.includes("assert(second.next?.value == 42)"))
    deny("canonical two-node .atto fixture drift");
  const cases = manifest.cases;
  if (!Array.isArray(cases) || cases.length !== EXPECTED_CASE_IDS.length)
    deny("test-case inventory must be complete");
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (!c || c.id !== EXPECTED_CASE_IDS[i] ||
        !["execute-guest", "compile-reject", "measure"].includes(c.kind) ||
        !["compiler-native", "compiler", "runtime", "performance"].includes(c.phase) ||
        typeof c.expected !== "string" || c.expected.length < 12 ||
        c.sourceFixture !== (i === 0 ? "node_graph.atto" : null) ||
        c.mandatory !== (i !== cases.length - 1))
      deny("case oracle drift or fabricated source fixture: " + i);
  }
  const gates = manifest.promotion;
  const requiredTrue = [
    "requiresExactHead",
    "requiresExactSourceBlob",
    "requiresSourceCompiler",
    "requiresGuestBinaryExecution",
    "requiresNonzeroJobSteps",
    "requiresHostGuestEvidenceSeparation",
    "requiresAllMandatoryCases",
    "requiresIndependentSecurityReviewForPrivateExport"
  ];
  const requiredFalse = [
    "sourceFreeRunMayPromote",
    "unapprovedMirroringAllowed"
  ];
  if (!gates || requiredTrue.some(k => gates[k] !== true) ||
      requiredFalse.some(k => gates[k] !== false) ||
      Object.keys(gates).length !== requiredTrue.length + requiredFalse.length)
    deny("promotion requires executable exact-head source and approved CI");
  return Object.freeze({
    contract: manifest.id,
    fiveBackends: EXPECTED_BACKENDS.length,
    cases: cases.length,
    sourceBlob: fixture.gitBlobSha1,
    guestVerified: false,
    nativeAotVerified: false,
    zeroGcCertified: false
  });
}

export function verifyCurrentActorRef32FiveBackendV1() {
  const root = new URL("../", import.meta.url);
  const manifest = JSON.parse(readFileSync(
    new URL("contracts/actor-ref32-five-backend-v1.json", root), "utf8"));
  const source = readFileSync(
    new URL("fixtures/actor-ref32-five-backend-v1/node_graph.atto", root),
    "utf8");
  return validateActorRef32FiveBackendV1(manifest, source);
}

if (process.argv[1] && resolve(process.argv[1]) ===
    fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(verifyCurrentActorRef32FiveBackendV1()));
}
