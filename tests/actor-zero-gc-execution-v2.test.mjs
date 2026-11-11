import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const policy = JSON.parse(readFileSync(
  new URL("../contracts/actor_zero_gc_execution_v2.json", import.meta.url), "utf8"));

const EXPECTED = Object.freeze({
  java: ["near-zero-managed-hotpath", true],
  llvm: ["no-guest-tracing-gc", false],
  wasm: ["no-wasm-guest-tracing-gc", true],
  forge: ["no-guest-tracing-gc", false],
  net: ["near-zero-managed-hotpath", true],
  cranelift: ["unsupported-until-actor-object-lowering", false]
});
const REQUIRED_CASES = Object.freeze(Array.from({length: 12},
  (_, i) => "ZG-" + String(i + 1).padStart(3, "0") + "-"));
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
  for (const [name, [goal, collector]] of Object.entries(EXPECTED)) {
    const entry = document.backends[name];
    assert.equal(entry.goal, goal, name + " objective changed");
    assert.equal(entry.hostTracingCollectorPossible, collector,
      name + " host-GC reality must not be hidden");
    assert.equal(entry.compiledGuestWorkloadVerified, false,
      name + " has no compiled guest receipt in this source-only contract");
    assert.equal(typeof entry.memorySubstrate, "string");
    assert.ok(entry.memorySubstrate.length > 0);
    assert.deepEqual(Object.keys(entry).sort(),
      ["goal", "hostTracingCollectorPossible", "compiledGuestWorkloadVerified",
       "memorySubstrate"].sort(), "unknown backend claim field");
  }
  assert.equal(document.requiredCases.length, REQUIRED_CASES.length);
  assert.equal(new Set(document.requiredCases).size, REQUIRED_CASES.length);
  for (let i = 0; i < REQUIRED_CASES.length; ++i)
    assert.ok(document.requiredCases[i].startsWith(REQUIRED_CASES[i]),
      "required memory oracle missing or reordered at " + REQUIRED_CASES[i]);
  assert.deepEqual(document.observationsRequiredForExecutedClaims, REQUIRED_OBSERVATIONS);
  assert.match(document.releaseRule, /cannot certify whole-program zero-GC/);
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

test("checked-in contract is policy only, not fake executable proof", () => {
  validate(policy);
});

test("six backend identities and managed host collectors cannot be erased", () => {
  for (const name of Object.keys(EXPECTED)) {
    mutated(d => { delete d.backends[name]; });
    mutated(d => { d.backends[name].goal = "zero-process-gc-certified"; });
    mutated(d => { d.backends[name].hostTracingCollectorPossible =
      !d.backends[name].hostTracingCollectorPossible; });
    mutated(d => { d.backends[name].compiledGuestWorkloadVerified = true; });
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
});

test("all allocation, ownership, cancellation, artifact and runner oracles remain mandatory", () => {
  for (let i = 0; i < policy.requiredCases.length; i++)
    mutated(d => { d.requiredCases.splice(i, 1); });
  mutated(d => { d.requiredCases[1] = d.requiredCases[0]; });
  mutated(d => { d.observationsRequiredForExecutedClaims.pop(); });
  mutated(d => { d.observationsRequiredForExecutedClaims[5] = "synthetic-run"; });
});

console.log("SOURCE_ONLY_ZERO_GC_POLICY_V2__NO_GUEST_EXECUTION_OR_CERTIFICATION");
