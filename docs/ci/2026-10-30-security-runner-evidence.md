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

## Platform-family sweep — 2026-10-30 (seven repositories)

Read-only GitHub API inspection checked six `oreslang-platform.*` repositories
and `oreslang-platform-conformance`. Each `main` returned `protected=false`.
The following exact-head PR runs were completed with `failure` and each
sampled job's separate GitHub step lookup returned `steps=[]`. The empty
step evidence prevents treating these as source compile, model, host, device
or guest verdicts. This table does not claim to exhaust all matrix jobs.

| Repo | Main commit | Draft PR head | Sampled workflow run | Sampled job / executed steps |
|---|---|---|---|---|
| IoT | `4ec351809978296a9aaf6251062515fb90ea2c4c` | #17 `f6db5d71bc2ce4a0d2d919985ada8d021b56572c` | [40790398169](https://github.com/ores-truffle-oreslang/oreslang-platform.iot/actions/runs/40790398169) | sanitizers #123173912027 / 0 |
| Mobile | `9cbfdafe42e620ed2703f0ac7c7c27e5cd2556bf` | #18 `292677d91d165a6fe302810e1f709732270b8c87` | [40820091089](https://github.com/ores-truffle-oreslang/oreslang-platform.mobile/actions/runs/40820091089) | host (gcc) #123270278417 / 0 |
| ASIC | `a9a99edd11cb638ce59ab08bf3936ee54f06d246` | #12 `abbc0109d47c8b00535dc755d0824eb4c49adcd8` | [40790838120](https://github.com/ores-truffle-oreslang/oreslang-platform.asic/actions/runs/40790838120) | structural-proof #123175366671 / 0 |
| FPGA | `60947fb0494d0e5e1b54a9cb3d3f6679899bcf60` | #12 `dc8e0d8ddd2e079fd2b479f655a59bceeaeaacd7` | [40790751226](https://github.com/ores-truffle-oreslang/oreslang-platform.fpga/actions/runs/40790751226) | virtual-hx8k #123175071254 / 0 |
| Embedded | `974264bd6614ba33a02c7150c0e4cf64a75d3d8a` | #27 `c68075c7a60ec44860f291160ed81f9979c7ed6d` | [40441695595](https://github.com/ores-truffle-oreslang/oreslang-platform.embedded/actions/runs/40441695595) | host (gcc) #121983307229 / 0 |
| Desktop | `a263a6fd481ed2fad1382d267ae048735c1e01d6` | #17 `22cdc0abc119bec37be40e0a04d48d2dbdb47f86` | [41165671334](https://github.com/ores-truffle-oreslang/oreslang-platform.desktop/actions/runs/41165671334) | linux-gcc #124432584698 / 0 |
| Conformance | `bffe4a84f5d16a443cfaec80bac9e7661a273ef9` | #253 `326dd0403dd093fa6c87a481fe84d9075d59b3f0` | [41166276399](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/41166276399) | harness #124434426770 / 0 |

Priority: restore actual source-org runner admission, independently configure
protected branches/rulesets, then run exact-head native, sanitizer, JNI/iOS,
FPGA/ASIC synthesis model, device and compiled-guest tests *as applicable*.
Source-free runner capacity checks and syntax-only receipts must not be
promoted to evidence of physical-device execution or guest parity. Private
source stays inside its authorized organization until every open transfer
incident receives independent closure and source/destination approval.
