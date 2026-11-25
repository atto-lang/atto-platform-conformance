import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// Independent, byte-for-byte reviewed baseline. JSON.parse alone would accept
// duplicate object keys; a prefix-only case checker would allow a changed
// obligation. Intentional policy edits require reviewing this same baseline.
const APPROVED_SOURCE = "{\n  \"schemaVersion\": 2,\n  \"contract\": \"oreslang-actor-zero-gc-executable-parity-v2\",\n  \"evidenceLevel\": \"source-only-policy\",\n  \"compiledGuestWorkloadCertifiedBackends\": [],\n  \"fullProcessZeroGcCertifiedBackends\": [],\n  \"hardRealtimeCertifiedBackends\": [],\n  \"backends\": {\n    \"java\": {\n      \"goal\": \"near-zero-managed-hotpath\",\n      \"hostTracingCollectorPossible\": true,\n      \"compiledGuestWorkloadVerified\": false,\n      \"memorySubstrate\": \"native-direct-actor-regions\"\n    },\n    \"llvm\": {\n      \"goal\": \"no-guest-tracing-gc\",\n      \"hostTracingCollectorPossible\": false,\n      \"compiledGuestWorkloadVerified\": false,\n      \"memorySubstrate\": \"actor-owned-native-arena\"\n    },\n    \"wasm\": {\n      \"goal\": \"no-wasm-guest-tracing-gc\",\n      \"hostTracingCollectorPossible\": true,\n      \"compiledGuestWorkloadVerified\": false,\n      \"memorySubstrate\": \"bounded-private-linear-memory\"\n    },\n    \"forge\": {\n      \"goal\": \"no-guest-tracing-gc\",\n      \"hostTracingCollectorPossible\": false,\n      \"compiledGuestWorkloadVerified\": false,\n      \"memorySubstrate\": \"actor-owned-cpp-arena\"\n    },\n    \"net\": {\n      \"goal\": \"near-zero-managed-hotpath\",\n      \"hostTracingCollectorPossible\": true,\n      \"compiledGuestWorkloadVerified\": false,\n      \"memorySubstrate\": \"native-memory-primitive-handle-arena\"\n    },\n    \"cranelift\": {\n      \"goal\": \"unsupported-until-actor-object-lowering\",\n      \"hostTracingCollectorPossible\": false,\n      \"compiledGuestWorkloadVerified\": false,\n      \"memorySubstrate\": \"scalar-only\"\n    }\n  },\n  \"requiredCases\": [\n    \"ZG-001-actor-persistent-root-plus-20000-transient-drops\",\n    \"ZG-002-reverse-construction-drop-order-after-slot-reuse\",\n    \"ZG-003-foreign-private-buffer-copy-alias-rejected\",\n    \"ZG-004-stale-incarnation-and-loan-delayed-retirement\",\n    \"ZG-005-no-collector-symbol-in-admitted-guest-binary\",\n    \"ZG-006-no-unbounded-allocation-in-admitted-native-turn\",\n    \"ZG-007-managed-allocation-counter-same-thread-warmup\",\n    \"ZG-008-wasm-linear-memory-caller-output-no-copy-result\",\n    \"ZG-009-throw-raise-panic-cancel-hot-reload-drop-matrix\",\n    \"ZG-010-same-source-head-compiled-guest-evidence\",\n    \"ZG-011-scrub-before-free-and-zero-live-native-budget\",\n    \"ZG-012-failed-allocation-retains-quota-and-ownership\",\n    \"ZG-013-wasm-fixed-memory-zero-page-grow-refresh-and-last-pin-scrub\"\n  ],\n  \"observationsRequiredForExecutedClaims\": [\n    \"sourceRepoAndExactHeadSha\",\n    \"compiledTargetAndRuntimeProfile\",\n    \"compilerCommandAndExitStatus\",\n    \"linkedGuestArtifactSha256\",\n    \"guestExecutionCommandExitAndOutputDigest\",\n    \"realRunnerIdAndNonzeroExecutedSteps\",\n    \"ownerAllocationDropAndRetainedByteCounters\",\n    \"collectorCountAndAllocatedManagedBytesWhereApplicable\",\n    \"nativeAllocatorAndFFIClosureAudit\",\n    \"guestGcOpcodeOrStatepointAudit\",\n    \"osPlatformArchitectureAndCompilerVersion\"\n  ],\n  \"releaseRule\": \"Native host smoke, source-only fixtures, zero observed collections, or draft PRs cannot certify whole-program zero-GC or deterministic guest object destruction.\"\n}\n";
const checkedInText = readFileSync(
  new URL("../contracts/actor_zero_gc_execution_v2.json", import.meta.url), "utf8");
const policy = JSON.parse(checkedInText);

const EXPECTED = Object.freeze({
  "java": [
    "near-zero-managed-hotpath",
    true,
    "native-direct-actor-regions"
  ],
  "llvm": [
    "no-guest-tracing-gc",
    false,
    "actor-owned-native-arena"
  ],
  "wasm": [
    "no-wasm-guest-tracing-gc",
    true,
    "bounded-private-linear-memory"
  ],
  "forge": [
    "no-guest-tracing-gc",
    false,
    "actor-owned-cpp-arena"
  ],
  "net": [
    "near-zero-managed-hotpath",
    true,
    "native-memory-primitive-handle-arena"
  ],
  "cranelift": [
    "unsupported-until-actor-object-lowering",
    false,
    "scalar-only"
  ]
});
const REQUIRED_CASES = Object.freeze([
  "ZG-001-actor-persistent-root-plus-20000-transient-drops",
  "ZG-002-reverse-construction-drop-order-after-slot-reuse",
  "ZG-003-foreign-private-buffer-copy-alias-rejected",
  "ZG-004-stale-incarnation-and-loan-delayed-retirement",
  "ZG-005-no-collector-symbol-in-admitted-guest-binary",
  "ZG-006-no-unbounded-allocation-in-admitted-native-turn",
  "ZG-007-managed-allocation-counter-same-thread-warmup",
  "ZG-008-wasm-linear-memory-caller-output-no-copy-result",
  "ZG-009-throw-raise-panic-cancel-hot-reload-drop-matrix",
  "ZG-010-same-source-head-compiled-guest-evidence",
  "ZG-011-scrub-before-free-and-zero-live-native-budget",
  "ZG-012-failed-allocation-retains-quota-and-ownership",
  "ZG-013-wasm-fixed-memory-zero-page-grow-refresh-and-last-pin-scrub"
]);
const REQUIRED_OBSERVATIONS = Object.freeze([
  "sourceRepoAndExactHeadSha",
  "compiledTargetAndRuntimeProfile",
  "compilerCommandAndExitStatus",
  "linkedGuestArtifactSha256",
  "guestExecutionCommandExitAndOutputDigest",
  "realRunnerIdAndNonzeroExecutedSteps",
  "ownerAllocationDropAndRetainedByteCounters",
  "collectorCountAndAllocatedManagedBytesWhereApplicable",
  "nativeAllocatorAndFFIClosureAudit",
  "guestGcOpcodeOrStatepointAudit",
  "osPlatformArchitectureAndCompilerVersion"
]);

function validate(document) {
  assert.equal(document.schemaVersion, 2);
  assert.equal(document.contract, "oreslang-actor-zero-gc-executable-parity-v2");
  assert.equal(document.evidenceLevel, "source-only-policy");
  for (const key of [
    "compiledGuestWorkloadCertifiedBackends",
    "fullProcessZeroGcCertifiedBackends",
    "hardRealtimeCertifiedBackends"
  ]) assert.deepEqual(document[key], [], key + " cannot be asserted from a policy file");
  assert.deepEqual(Object.keys(document.backends).sort(), Object.keys(EXPECTED).sort());
  for (const [name, [goal, collector, substrate]] of Object.entries(EXPECTED)) {
    const entry = document.backends[name];
    assert.equal(entry.goal, goal, name + " objective changed");
    assert.equal(entry.hostTracingCollectorPossible, collector,
      name + " host-GC reality must not be hidden");
    assert.equal(entry.compiledGuestWorkloadVerified, false,
      name + " has no compiled guest receipt in this source-only contract");
    assert.equal(entry.memorySubstrate, substrate,
      name + " native/managed memory substrate declaration changed");
    assert.deepEqual(Object.keys(entry).sort(),
      ["goal", "hostTracingCollectorPossible", "compiledGuestWorkloadVerified",
       "memorySubstrate"].sort(), "unknown backend claim field");
  }
  assert.deepEqual(document.requiredCases, REQUIRED_CASES,
    "all memory/zero-GC obligations must match the independent reviewed inventory");
  assert.deepEqual(document.observationsRequiredForExecutedClaims, REQUIRED_OBSERVATIONS);
  assert.equal(document.releaseRule,
    "Native host smoke, source-only fixtures, zero observed collections, or draft PRs cannot certify whole-program zero-GC or deterministic guest object destruction.",
    "release rule cannot be weakened or silently extended");
  assert.deepEqual(Object.keys(document).sort(), [
    "schemaVersion", "contract", "evidenceLevel",
    "compiledGuestWorkloadCertifiedBackends", "fullProcessZeroGcCertifiedBackends",
    "hardRealtimeCertifiedBackends", "backends", "requiredCases",
    "observationsRequiredForExecutedClaims", "releaseRule"
  ].sort());
}
function mutated(change) {
  const clone = structuredClone(policy);
  change(clone);
  assert.throws(() => validate(clone));
}

function validateRaw(source) {
  // Byte identity is intentionally stronger than JSON structural equivalence:
  // it also blocks duplicate-key shadowing and unreviewed escaped spellings.
  assert.equal(source, APPROVED_SOURCE, "reviewed policy source bytes changed");
  validate(JSON.parse(source));
}

test("checked-in contract is immutable source-only policy, never guest proof", () => {
  validateRaw(checkedInText);
});

test("duplicate keys, reordered or appended source data cannot bypass reviewed bytes", () => {
  assert.throws(() => validateRaw(checkedInText.replace(
    '"hostTracingCollectorPossible": true,',
    '"hostTracingCollectorPossible": false, "hostTracingCollectorPossible": true,')));
  assert.throws(() => validateRaw(checkedInText + "\n"));
  assert.throws(() => validateRaw(checkedInText.replace(
    '"source-only-policy"', '"PASS_EXECUTED"')));
});

test("six backend identities and managed host collectors cannot be erased", () => {
  for (const name of Object.keys(EXPECTED)) {
    mutated(d => { delete d.backends[name]; });
    mutated(d => { d.backends[name].goal = "zero-process-gc-certified"; });
    mutated(d => { d.backends[name].hostTracingCollectorPossible =
      !d.backends[name].hostTracingCollectorPossible; });
    mutated(d => { d.backends[name].compiledGuestWorkloadVerified = true; });
    mutated(d => { d.backends[name].memorySubstrate = "invented-zero-GC"; });
  }
});

test("zero-step or unsupported certification cannot be smuggled through policy", () => {
  for (const key of [
    "compiledGuestWorkloadCertifiedBackends",
    "fullProcessZeroGcCertifiedBackends",
    "hardRealtimeCertifiedBackends"
  ]) mutated(d => { d[key].push("llvm"); });
  mutated(d => { d.evidenceLevel = "PASS_EXECUTED"; });
  mutated(d => { d.backends.java.processGcDisabled = true; });
  mutated(d => { d.releaseRule = "all backends are zero-GC"; });
  mutated(d => { d.releaseRule += " No proof needed."; });
});

test("all allocation, ownership, cancellation, artifact and runner oracles remain mandatory", () => {
  for (let i = 0; i < policy.requiredCases.length; i++)
    mutated(d => { d.requiredCases.splice(i, 1); });
  mutated(d => { d.requiredCases[1] = d.requiredCases[0]; });
  mutated(d => { d.requiredCases[1] += "-shortened-test"; });
  mutated(d => { d.observationsRequiredForExecutedClaims.pop(); });
  mutated(d => { d.observationsRequiredForExecutedClaims[5] = "synthetic-run"; });
});

console.log("SOURCE_ONLY_ZERO_GC_POLICY_V2__NO_GUEST_EXECUTION_OR_CERTIFICATION");
