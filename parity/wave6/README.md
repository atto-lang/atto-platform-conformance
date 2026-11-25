# Wave 6 — Oreslang parity roadmap tasks 26–30

**Release status: NOT CERTIFIED.** This is the final batch of the original 30-workstream roadmap, not evidence that all 30 compiler/platform features have shipped. All target profiles, all five compiler backends, and the three pinned Oreslang source cases remain unverified until actual target-device and exact-source compiler evidence exists.

This follows earlier draft batches [#47](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/47), [#49](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/49), [#52](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/52), [#54](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/54), [#55](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/55).

## Five scoped deliverables and real status

| Task | Target acceptance | Existing platform reality | This PR provides |
| --- | --- | --- | --- |
| **26 — Mobile Android/iOS** | Real Oreslang→LLVM AOT ARM64 libraries, JNI/Kotlin Android and Swift C-ABI iOS integration, actor lifecycle/cancellation/ownership, real device smoke, startup, static-AOT-only on iOS | [OresMobile](https://github.com/ores-truffle-oreslang/oreslang-platform.mobile) currently contains a portable **host C ABI bridge**, not an actual installed app or JNI/Swift actor host | Strict Android ARM64 and iOS ARM64 platform receipt checks; rejects missing device results, iOS JIT fallback, missing ownership/cancellation tests and OS signing proof |
| **27 — Embedded + RTOS** | Actor-to-actor source sends, bounded state/channels and supervisor, capability HAL, RV32, real firmware boot, RAM/stack/flash/WCET budgets | [OresEmbedded](https://github.com/ores-truffle-oreslang/oreslang-platform.embedded) already demonstrated a **limited real Cortex-M AOT Zephyr/QEMU scalar** app and restricted source-bootstrap actor handlers. Handler-to-handler sends, RV32, MPU and WCET remain missing. See [the real scalar verified run](https://github.com/canonical-cloud/canonical-docs/actions/runs/38646752678) and [static actor contract](https://github.com/ores-truffle-oreslang/oreslang-platform.embedded/blob/main/docs/STATIC_SOURCE_ACTORS.md) | Exact target profiles for Cortex-M3 and RV32 requiring bounded measured resources, source actor messaging and supervision tests before promotion |
| **28 — IoT MQTT/CoAP/OTA** | Authenticated TLS/DTLS transport with identity, provisioning, ACL, replay protection and bounded actor gateways; signed OTA, durable antirollback and simulated real power-loss recovery | [OresIoT](https://github.com/ores-truffle-oreslang/oreslang-platform.iot) has a defensive **framing-only C reference**, **no MQTT/CoAP/TLS/provisioning/OTA implementation** | A real Ed25519 verification and staging reference: signed release manifest, firmware digest, per-device target/version, expiry, nonce replay, separate signed device boot receipt, monotonic boot counter and stage-before-commit. No actual bootloader, persistence, MQTT/CoAP stack or authenticated socket claimed |
| **29 — Desktop packages** | AOT Windows/macOS/Linux apps with actors, permission/cancellation, native loop/UI interop, install/uninstall tests, signing/notarization and startup performance | [OresDesktop](https://github.com/ores-truffle-oreslang/oreslang-platform.desktop) now contains a small cross-platform host ABI plus an optional SDL3 adapter and LLVM-link smoke path; it is **not** a packaged production app and has no release signing/notarization proof | Windows Authenticode, Apple notarized and Linux verified-package policy receipts; requires real installed app launch and hash-verified artifact. No package files or OS sign-off produced |
| **30 — Five-backend certification** | Continuous executable guest differential tests across Java, LLVM, .NET, Forge, LLVM→Wasm, including diagnostics, causal actor traces, memory/failure/fuzz, exact source/guest provenance, sanitizer/AOT/CI | Existing conformance PRs have useful fixtures and CI gates, but many repo Actions jobs fail **before executing steps**. Approval of private Git-tree mirroring remains separate security work | Typed evidence validation, source SHA/compiled guest SHA policy, signed-observation parser, deterministic causal trace comparison, missing-backend/divergent/reject-all denial and a **non-promoting command-line evidence gate** |

## Files and usage

Run with **Node.js 22+**:

```sh
node --test parity/wave6/tests/wave6.test.mjs
node parity/wave6/bin/check.mjs
node parity/wave6/bin/differential.mjs --observations=/absolute/path/to/evidence.json
```

`bin/check.mjs` pins task identifiers 26–30, nine platform profiles, all five source backends, and exact Git blob/SHA-256 hashes of:
- `fixtures/scalar-42.ores` — shared signed-i64 source positive control;
- `fixtures/actor-state-read.ores` — actor safe source candidate;
- `fixtures/actor-state-loan-escape-reject.ores` — actor state-loan escape negative.

A successful manifest check prints **`PINNED_CONTRACT_ONLY`**, `releaseCertified:false` and `realCompilerExecuted:false`.

`bin/differential.mjs` accepts a bounded, regular, absolute-path JSON file with exactly `records` and `requiredCases`. Every observation is tied to a source hash, declared build and guest artifact hashes, backend, run ID and compile/execution step labels. It compares exact typed values, diagnostics, and causal actor events. It exits **3** for missing backend evidence, **1** for divergence, **2** for malformed input, and **4** even for an observed match, because self-reported steps or externally supplied keys **cannot establish trusted CI provenance**. A release workflow must get an independent approved attestation and successful actual compiled guest execution before converting a candidate to verified.

## IoT security model: strict limitations

`src/ota.mjs` uses real Node Ed25519 signature verification, not a fake signature flag. The release manifest binds device ID, Cortex-M3/RV32/Linux-ARM64 target, version, previous version, payload hash/byte length, expiry, key ID, and nonce. No active version upgrade occurs until a **separate, valid device-key-signed boot receipt** binds the staged firmware digest and increasing boot counter.

**This is an in-memory host reference only.** It does **not** implement persistent nonce storage, hardware monotonic fuses, secure boot, device key enrollment, flash atomicity, transport security, provisioning, MQTT or CoAP. Calling `abort()` demonstrates rollback in the reference state but does not demonstrate survival of a physical power cut. Public verification keys are supplied by the trusted caller; the module does not establish their provenance. A real OTA release must be separately tested against actual flash and power interruptions.

## Native/mobile/desktop evidence security

`src/platforms.mjs` checks a narrow receipt with an exact expected `oreslang-platform.*` repository + commit, the LLVM source repository + commit, a GitHub Actions run URL scoped to that same platform repository, executed-step list, artifact SHA/size and release signing identity, plus required domain-specific runtime tests. These are **caller-supplied assertions**; returning `requiredFieldsPass:true` NEVER sets `realDeviceVerified`, `compilerProvenanceVerified` or `distributionCertified` to true. This gate does not contact GitHub, code-signing authorities or platform stores. Real validation must verify actual job logs, immutable artifact identity, OS signatures, device logs and lifecycle results from approved roots.

`src/differential.mjs` optionally verifies Ed25519-signed canonical JSON observation records, but `trustRootIndependentlyApproved` and `certifiedParity` remain **false** even with a valid caller-key signature. The source and compiler trees, runner identities and materialized guest artifacts must be audited separately. Matching synthetic/mocked outcomes, negative-only source rejection, prior-head runs, and zero-step workflow failures do not establish Oreslang parity.

## CI and next production implementation

The isolated workflow `.github/workflows/wave6-parity.yml` runs the hardened wave-6 test suite on Node 22 with immutable action SHAs and checkout credentials disabled. This suite exercises actual Node crypto and subprocesses, not any real Oreslang production compiler. It does not request new secrets, private cross-org source copies or platform signing credentials.

Progress after this draft belongs in **the actual platform repositories** and five compiler backends, using existing integration branches. The blockers are real Android/iOS deployment, RV32 and actor-handler messaging, OTA flash durability/authenticated connectivity, an actual desktop app/package, and a trusted, executed five-backend matrix. Review + verified production CI must precede merging any release-enabling claim.
