# Oreslang roadmap wave 7 — tasks 31–35: integrate, verify, review

**Status: draft integration infrastructure.** Wave 1–6 implement 30 roadmap workstreams as source fixtures, reference models and verification scaffolds. They do **not** establish full production feature parity. This extension is a genuine six-repository-ref **test orchestration layer inside the same private GitHub repository**, not a new Oreslang compiler or release endorsement.

## Five concrete tasks

| Task | Implemented | Required remaining evidence |
| --- | --- | --- |
| **31. Pin six draft PR heads and detect integration conflicts** | `inventory.json` locks [#47](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/47), [#49](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/49), [#52](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/52), [#54](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/54), [#55](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/55), and [#56](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/56). It inventories **92 distinct changed paths** and **14 exact pinned Git test/manifest/source blobs**; detects duplicate/unexpected paths, removed manifests/tests, and golden scalar input drift. | Real review of overlapping *semantics* and non-overlapping dependency trees. A path-disjoint check is **not** a conflict-free merge guarantee. |
| **32. Execute all six in one private-repo CI job** | `.github/workflows/pinned-six-wave-host.yml` checks out each immutable PR head in a dedicated directory in the **same** private repository using its own read-only `GITHUB_TOKEN`; `persist-credentials:false`, no cross-org checkout/mirroring. Uses Node 22 and Clang for the Wave 5 control test. | Confirm GitHub Actions budget/runner policy and inspect actual execution steps. These six PRs remain drafts and their test code requires review before any runner executes it. |
| **33. Fail closed on source drift and test failures** | `src/run.mjs` validates each `git rev-parse HEAD`, tracked-tree cleanliness, source paths and symlinks, Git blob hashes, and every `.test.mjs` in each wave. It invokes Node with `shell:false`, a limited environment, bounded output and a 180-second timeout per suite, then generates explicit per-wave results. A test failure or missing checkout blocks host readiness. | Genuine six-wave suite execution on the exact reviewed heads. This tests Node host suites, not the Java/LLVM/.NET/Forge/Wasm compilers or guest actors. |
| **34. Diagnose stale and zero-step CI evidence** | `src/host-evidence.mjs` rejects missing jobs, stale run attempts, wrong SHAs, missing mandatory steps and unsuccessful steps; separately classifies no-step failures as **NO_EXECUTED_TEST_EVIDENCE**. | Independent GitHub API fetch of full run/job/step status by an approved reviewer, including source identity and actual logs. Caller JSON alone is not a trusted attestation. |
| **35. Produce a conservative merge-readiness decision** | `mergeReadiness` returns `BLOCKED` or `HOST_SUITES_PASSED_NEEDS_INDEPENDENT_CI`. Always returns `mergeApproved:false`, `backendCompilerParity:UNVERIFIED` and `releaseCertified:false`. | Port and test accepted semantics in the five actual compiler/runtime repos, verify artifact/source provenance, run real guest target tests, obtain independent security and merge approvals. |

## Exact pinned PR heads

| Wave | Original tasks | Source PR | Pinned Git commit |
| --- | --- | --- | --- |
| 1 | 1–5 | #47 | `4f5b723c9f55d21eb7a07631a41dd63fec0cffd1` |
| 2 | 6–10 | #49 | `4bb5e69efa871bee7829af4790dbd5bc0c2bbae4` |
| 3 | 11–15 | #52 | `7f614ac1128dabeb06ca6b67678c11a341fe973c` |
| 4 | 16–20 | #54 | `478292e8fa8ee08cbd1553d785aa83b327dd610a` |
| 5 | 21–25 | #55 | `178598885b1c9e5399a1ed05fa5c4a6e2c008184` |
| 6 | 26–30 | #56 | `938fade4961cd1432951d52fea98715b21c442f3` |

**Refreshing a PR** requires *reviewing* its new head and changed-file inventory and intentionally updating **both** the inventory and review-locked constants in `src/inventory.mjs`/workflow. Silent branch advancement never promotes evidence.

## Run

Node 22+, Git and Clang. To exercise the integration code without fetching private source:

```sh
node parity/integration/bin/validate.mjs
node --test parity/integration/tests/*.test.mjs
```

The **full six-wave run** requires six actual, individually checked out commits in `checkouts/wave1` through `checkouts/wave6`. The CI workflow provisions those from the **same private source repository**, without cross-org tokens or copies:

```sh
node parity/integration/src/run.mjs \
  --checkouts=/absolute/path/to/checkouts \
  --inventory=/absolute/path/to/inventory.json
```

The runner checks source identity and then executes the tests of each original wave. **Host suite PASS** means only that those exact pinned Node test files passed. It cannot be used to claim a compiler ran, a guest actor executed, or a target-specific binary was emitted. If any wave fails, the command exits nonzero.

The new tests exercise real ephemeral local Git commits and a small executed Node test, plus inventory tampering, step spoofing and bogus merge/attestation attempts. They do not substitute for the six upstream suites.

## Security and organizational runner constraints

The six checkouts point to the **existing private conformance repository only**; no source from `oreslang-source.java`, `.llvm`, `.net`, `.wasm`, or `.forge` is copied outside its approved location. A read-only `GITHUB_TOKEN` remains limited to source checkout, with `persist-credentials:false` to avoid leaving it in test directories. This reduces credential exposure but **does not provide a network egress sandbox**: review the pinned test code before scheduling private CI.

Earlier Actions failures with **zero job steps** are infrastructure/policy blockers, not compiler test failures or passing test evidence. An Actions job that cannot acquire a runner proves nothing about the host suite. This workflow cannot allocate GitHub Actions minutes or approve private CI mirrors.

## Order of next production work

First obtain actual CI execution of all six host suites at immutable PR heads; triage any genuine integration test failure. Then reconcile the ownership/actor/typed transport semantics onto the production Java/LLVM branches, and propagate implemented source/guest tests into .NET, Forge and Wasm with fail-closed unsupported markers. Keep platform-target requirements tied to real Android/iOS, Cortex-M/RTOS, IoT and desktop programs—not the host reference models. Require independent audit of provenance, ACL/actor-capability boundaries, AOT guest execution and source rollout before merging or certifying.

**This is a draft orchestration PR; do not merge all six unreviewed PRs or treat host suite compatibility as language parity.**
