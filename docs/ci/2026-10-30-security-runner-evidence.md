# Source-org CI and protected-main checkpoint — 2026-10-30 (UTC-5)

**Classification:** metadata-only; fail closed; **not transfer authorization**.
The GitHub PR head SHA is source evidence only; the runtime and the compiler have **not** been validated by these failed jobs.

## Verified exact-head runner admission samples

| Source | PR head SHA | Commit tree SHA | Workflow run / attempt | Job | Raw runner_id | Raw steps | Conclusion |
|---|---|---|---|---|---:|---:|---|
| Java `fast-ci` | `9ad0ae56991eb9d570f277af7c05796132d59862` | `3f5d8e36f8357dfc517c6ab6a6cf7f528099cd41` | [41157437156](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/41157437156), attempt 1 | `test` #124407223265 | 0 | 0 | failure |
| LLVM compiler/native | `9db73d78e39447bbe037582aac8aeda1324e121c` | `ebaa23171f155c0dd01e31d5c83a4f52154a92b3` | [41157446216](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/41157446216), attempt 1 | `llvm-smoke` #124407252072 | 0 | 0 | failure |

GitHub raw Actions job lists each reported exactly one job, `total_count=1`, no assigned runner and `steps=[]`. Do **not** call these Maven, JUnit, compiler, native or guest failures. A subsequent real execution will require fresh evidence for that exact new head.

## Main protection observations

Read-only GitHub `GET /repos/{owner}/{repo}/branches/main` responses reported `protected=false` for **all six** sampled source and conformance repositories:

| Repo | Observed main SHA |
|---|---|
| `oreslang-source.java` | `241bd67c39443cc2ef18df7e4ed456454af378c7` |
| `oreslang-source.llvm` | `31b2fff390adac994d270d6fcbf2f65beb980d2c` |
| `oreslang-source.net` | `276c157fd3e760184b9782d90d1b014276d9c1ef` |
| `oreslang-source.wasm` | `be268bee832956fb8ca399f9c6fbc495e3066b73` |
| `oreslang-source.forge` | `a98a5e0abec222862278a52e7aaadbb2c674ec97` |
| `oreslang-platform-conformance` | `bffe4a84f5d16a443cfaec80bac9e7661a273ef9` |

The GitHub integration's branch protection endpoint returned HTTP 403. Changing GitHub organization billing, rulesets, required CODEOWNER reviews, or runner groups is an administrative task; this document does not simulate it.

## Reviewed but still blocked source-local work

- [Conformance PR #251](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/251): exactly eight *open* private carrier incidents: #22, #77, #127, #171, #172, #198, #200, #252; each requires independent `ORESoftware` disposition. Historical refs removed or reset do **not** prove Git object/artifact cleanup.
- [Java PR #2306](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2306): incident disposition gate includes #252 and disallows author-spoofed approvals.
- [LLVM PR #1146](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1146): unsafe GET-then-name-only-DELETE forbidden; atomic lease-based cleanup implementation and tests are staged, but the private publisher remains fail-closed.
- [Java PR #2340](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2340): malformed duplicate YAML tail removed and immutable `ORESoftware` reviewer user ID 11139560 checked on draft branch at `445695d95b4d175d2b3b65aa7f4b7c1831efb4be`; no approved runner/JUnit run.
- [LLVM PR #1220](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1220): malformed duplicate YAML tail removed on draft branch at `83014e69d8e3564f55e9e31b0e63c6cdaad8976d`; no approved runner/native guest run.

**Administrative order:** independent incident review and containment; effective protected main and CODEOWNER policy; independent review of source-only gates; fresh source-free runner admission proof with nonzero steps; provision one-use source-org runner; execute reviewed exact-head guest/compiler tests; bind their logs and receipts to immutable SHAs.
No merge or export is authorized by this checkpoint.
