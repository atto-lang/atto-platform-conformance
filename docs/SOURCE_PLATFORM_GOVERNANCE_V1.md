# AttoLang source/platform governance v1

The registry at contracts/source-platform-governance-v1.json is a closed,
versioned inventory of nine oreslang-source.* repositories and six
oreslang-platform.* repositories. The conformance repository is its contract
coordinator. This is **coordination and policy consistency, not a CI, runtime,
security or parity certificate**.

The older integration/repositories.json graph is a coordination-only snapshot
and is not a live provenance oracle. The six platform identities are checked
against contracts/platform-capabilities-v1.json. The graph provides declared
platform-to-source edges, not evidence that imports or executable integrations
exist.

Run 'node bin/check-source-platform-governance.mjs' and
'node --test test/source-platform-governance.test.mjs'. Both are host-only
contract checks. Even on success the verifier always returns attested:false.

## Mandatory boundaries

1. Canonical portable AttoLang core/std APIs and fixtures should be in shared,
   byte-identical .atto modules where independent of host ABI. Pin source blob
   and commit identities in consumers. This registry does not claim that the
   distribution or exact module hashes have been verified.
2. Classify runner admission, exact-head/tree, source preflight, compiler
   source checking, native link, guest execution, receipt authentication and
   merge governance separately. Zero-step Actions results mean NOT_EXECUTED.
3. Neither an offline validator nor a self-declared SHA, boolean exactHead,
   or executedSteps count independently attests a GitHub run. Verify job id,
   run attempt, actual steps, compiler build identity, target output and raw
   receipts against authoritative sources.
4. Host-only references, simulated toolchains, unsupported cases and ABI
   links do not equal real AttoLang guest execution. RTL reference programs
   are not hardware simulation; simulation is not physical FPGA/ASIC proof.
5. Platform capability promotion follows oreslang.platform-capability/1.
   Changes to platform/backend edges require synchronized updates to the
   central registry, capability contract and integration inventory.
6. CODEOWNERS is declarative without enforced branch protection. Verify
   independent review, required checks, unchanged head SHA and explicit
   source-export authorization. Never treat runner capacity as export consent.

## Existing collaboration and known gaps

Cranelift's missing CODEOWNERS is already staged in draft PR #13. Mobile
ownership/governance is staged in draft PR #17 and integration PR #20; do
not duplicate their changes. On inspected main, the Rust and HDL source
repositories have no top-level contracts/ directory. They require contract
locators/negative fixtures or a documented cross-repo contract authority.
The platform repositories use docs, profiles and tests instead of
top-level contracts/; align their substantive capabilities to the central
receipt policy before claiming higher evidence stages.

This proposal changes no private-source export rules, branch settings,
runtime implementations or compiler feature-status claims.
