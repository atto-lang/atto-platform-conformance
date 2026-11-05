import {validateRegistry} from "./ecosystem-contract.mjs";

export const SOURCE_REPOSITORIES = Object.freeze([
  "oreslang-source.cranelift",
  "oreslang-source.forge",
  "oreslang-source.hdl",
  "oreslang-source.java",
  "oreslang-source.js",
  "oreslang-source.llvm",
  "oreslang-source.net",
  "oreslang-source.rs",
  "oreslang-source.wasm"
]);
export const PLATFORM_TARGET_CLASSES = Object.freeze({
  asic: "asic",
  desktop: "desktop-native",
  embedded: "freestanding-mcu",
  fpga: "fpga",
  iot: "iot-gateway",
  mobile: "mobile-native"
});
const EXPECTED_STAGES = [
  "host-reference", "abi-link", "compiler-guest",
  "target-execution", "physical-hardware"
];
const EXPECTED_RULES = {
  all: ["exact-head", "executed-steps", "target-artifact-digest"],
  "abi-link": ["abi-linked"],
  "compiler-guest": [
    "abi-linked", "compiler-produced", "compiler-source-revision",
    "compiler-binary-digest", "not-host-reference-only"
  ],
  "target-execution": ["target-executed"],
  "physical-hardware": ["physical-hardware-evidence"]
};
const EXPECTED_NON_EVIDENCE = [
  "zero-step-workflow", "queued-workflow", "host-stub-for-compiler-guest",
  "declared-source-sha-without-binary-provenance", "documentation-only-claim"
];
const sorted = values => [...values].sort();
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const keysAre = (object, expected) => object && typeof object === "object" &&
  !Array.isArray(object) && same(sorted(Object.keys(object)), sorted(expected));
function deny(message) { throw new Error("source/platform governance: " + message); }

/**
 * Metadata-only check, deliberately incapable of promoting compiler support,
 * CI provenance, runtime correctness or physical hardware claims.
 */
export function validateSourcePlatformGovernance(registry, capabilities) {
  const {repositories: inventoryRepositories} = validateRegistry(registry);
  const sources = registry.repositories.filter(row => row.name.startsWith("oreslang-source."));
  const platforms = registry.repositories.filter(row => row.name.startsWith("oreslang-platform."));
  const expectedPlatforms = Object.keys(PLATFORM_TARGET_CLASSES)
    .map(name => "oreslang-platform." + name);

  if (!same(sorted(sources.map(row => row.name)), SOURCE_REPOSITORIES))
    deny("source family drift: expected nine explicitly reviewed backends");
  if (!same(sorted(platforms.map(row => row.name)), sorted(expectedPlatforms)))
    deny("platform family drift: expected six explicitly reviewed targets");

  for (const row of sources) {
    if (row.role !== "compiler") deny(row.name + " must have compiler role");
    if (!row.upstreams.includes("oreslang-target-profiles"))
      deny(row.name + " must declare target-profile coordination");
  }
  for (const row of platforms) {
    if (row.role !== "host") deny(row.name + " must have host role");
    if (!row.upstreams.some(dep => SOURCE_REPOSITORIES.includes(dep)))
      deny(row.name + " must declare a source-backend coordination edge");
  }

  if (!keysAre(capabilities, [
    "schemaVersion", "contract", "stageOrder", "platforms",
    "promotionRules", "nonEvidence"
  ]) || capabilities.schemaVersion !== 1 ||
      capabilities.contract !== "oreslang.platform-capability/1")
    deny("invalid platform capability contract header");
  if (!same(capabilities.stageOrder, EXPECTED_STAGES))
    deny("platform evidence stage order drift");
  if (!keysAre(capabilities.platforms, Object.keys(PLATFORM_TARGET_CLASSES)))
    deny("platform capability registry names drift");

  for (const [id, targetClass] of Object.entries(PLATFORM_TARGET_CLASSES)) {
    const entry = capabilities.platforms[id];
    if (!keysAre(entry, ["repository", "targetClass"]) ||
        entry.repository !== "ores-truffle-oreslang/oreslang-platform." + id ||
        entry.targetClass !== targetClass)
      deny("platform capability repository/target identity drift: " + id);
  }
  if (!keysAre(capabilities.promotionRules, Object.keys(EXPECTED_RULES)))
    deny("platform promotion-rule keys drift");
  for (const [stage, requirements] of Object.entries(EXPECTED_RULES)) {
    if (!same(capabilities.promotionRules[stage], requirements))
      deny("platform promotion requirements drift: " + stage);
  }
  if (!same(capabilities.nonEvidence, EXPECTED_NON_EVIDENCE))
    deny("platform non-evidence exclusions drift");

  return {
    schemaVersion: 1,
    kind: "oreslang-source-platform-governance-audit",
    evidence: "metadata-only",
    sourceRepositories: sources.length,
    platformRepositories: platforms.length,
    inventoryRepositories,
    verifiedBackendParity: false,
    verifiedTargetExecution: false,
    verifiedPhysicalHardware: false
  };
}
