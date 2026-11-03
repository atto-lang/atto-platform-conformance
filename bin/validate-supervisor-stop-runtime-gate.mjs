import {readFileSync} from "node:fs";
import {isDeepStrictEqual} from "node:util";

const path = new URL("../fixtures/supervision/v1/stop-only-runtime-gate.json", import.meta.url);
const backends = ["java", "llvm", "wasm", "cranelift", "net"];
const failureFields = [
  "supervisor_id", "group_id", "physical_actor_id", "logical_child_id",
  "incarnation", "kind", "origin_kind", "diagnostic"
];
const stopFields = [
  "supervisor_id", "group_id", "turn_generation", "physical_actor_id",
  "incarnation", "host_effect_receipt"
];
const phases = [
  "physical-child-finalization", "immutable-terminal-failure",
  "reserved-control-turn", "generation-fenced-stop-intent",
  "host-effect", "authoritative-ack-or-quarantine"
];
const invariants = [
  "terminal-throw-raise-promoted-to-panic-with-origin",
  "no-actor-local-panic-interception",
  "fail-closed-foreign-or-stale-identity",
  "single-flight-control",
  "bounded-control-capacity",
  "stop-effect-at-most-once-per-generation",
  "unknown-host-outcome-is-quarantined-not-retried",
  "no-fake-guest-authority-or-serialized-supervisor-handle"
];
const host = Object.freeze({java: true, llvm: true, wasm: false, cranelift: false, net: false});
const compiled = Object.freeze({java: true, llvm: false, wasm: false, cranelift: false, net: false});
// Each toolchain now has independently executed host-only receipt bookkeeping.
// This is NOT a compiled guest supervisor or an integrated actor scheduler.
const ledgers = Object.freeze({java: true, llvm: true, wasm: true, cranelift: true, net: true});
const evidence = Object.freeze({
  javaControl: "https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41358923195",
  javaCompiler: "https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41359448732",
  llvmControl: "https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41359210787",
  javaLedger: "https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41359927149",
  wasmLedger: "https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41363000747",
  craneliftLedger: "https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41363000747",
  netLedger: "https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41363153493"
});

const currentHeadGate = Object.freeze({
  snapshotDate: "2026-11-03",
  status: "HOLD",
  privateMirrorAuthorized: false,
  unresolvedSecurityIncidents: [22, 77, 127, 171, 172],
  sourceHeads: {
    java: "0742edd690252ca20282c512c5cdfa382a21daf3",
    llvm: "5dcbb1d167cd8f7448060700717c1023e763ec08",
    wasm: "492ac62946781a78d9e815a24643e9c47da20d1c",
    cranelift: "dbafc1a2ba6206b90208afe573a1f0cfcb5e3275",
    net: "11975d97ee94a222d68c66b795460702550cca33"
  },
  executedSourceOrgCurrentHeadCI: {
    java: false, llvm: false, wasm: false, cranelift: false, net: false
  },
  notes: "Snapshot only. Last known source-org CI jobs failed before step execution. Historical host-ledger proofs do not certify current branch heads."
});

export function readSupervisorStopRuntimeGate() {
  return JSON.parse(readFileSync(path, "utf8"));
}
function requireExact(actual, expected, reason) {
  if (!isDeepStrictEqual(actual, expected)) throw Error("STOP runtime gate: " + reason);
}
export function validateSupervisorStopRuntimeGate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("STOP runtime gate: invalid root");
  requireExact(Object.keys(input).sort(), [
    "backends", "backendGate", "currentHeadGate", "enforce", "evidence", "evidenceClass",
    "lifecycleOrder", "logicalFailureFields", "schemaVersion",
    "scope", "stopTurnFields"
  ].sort(), "unexpected contract keys");
  requireExact(input.schemaVersion, 1, "wrong version");
  requireExact(input.scope, "supervisor-stop-only-runtime-gate-v1", "wrong scope");
  requireExact(input.evidenceClass,
    "focused-host-control-and-source-lowering-not-guest-parity",
    "guest source parity must not be inferred from host proof");
  requireExact(input.backends, backends, "five backends required");
  requireExact(input.logicalFailureFields, failureFields, "immutable Failure ABI drift");
  requireExact(input.stopTurnFields, stopFields, "STOP turn receipt ABI drift");
  requireExact(input.lifecycleOrder, phases, "lifecycle ordering drift");
  requireExact(input.enforce, invariants, "CONTROL safety invariant drift");
  requireExact(Object.keys(input.backendGate).sort(), [...backends].sort(),
    "missing or unrecognized backend");
  for (const backend of backends) {
    requireExact(input.backendGate[backend], {
      focusedHostStop: host[backend],
      sourceStopPlan: compiled[backend],
      hostStopLedger: ledgers[backend],
      guestSourceParity: false
    }, backend + " has fabricated or stale guest runtime evidence");
  }
  requireExact(input.evidence, evidence, "provenance changed without a reviewed gate update");
  // A historical exact-blob host-ledger run cannot certify a changed source
  // head. This is a read-only status snapshot, not an Actions scheduler or
  // transfer authorization. Any promotion requires independently reviewed
  // incident closure and fresh executable exact-head evidence.
  requireExact(input.currentHeadGate, currentHeadGate,
    "unverified current-head certification or unauthorized mirror promotion");
  return {backends: 5, focusedHostStop: 2, hostStopLedger: 5, sourceStopPlan: 1, guestSourceParity: 0, currentHeadCertified: 0, releaseStatus: "HOLD"};
}
if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  console.log(JSON.stringify(validateSupervisorStopRuntimeGate(readSupervisorStopRuntimeGate())));
}
