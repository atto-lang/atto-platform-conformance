# Scoped runtime retirement evidence — 2026-11-27 (Lima)

**Host/reference scope only; no guest, production scheduler, NativeAOT or cross-backend parity certification.** These are independently implemented runtime primitives or models. This inventory does not modify the shared runtime contract or existing executable evidence gates. See [five-backend runtime evidence](FIVE_BACKEND_RUNTIME_EVIDENCE.md) and [async runtime receipts](ASYNC_RUNTIME_RECEIPTS.md).

Public repositories were confirmed via GitHub metadata; anonymous HTTPS fetch of immutable source commits verified the complete root tree before scoped tests. No private source export, tokens, or required-check substitution. Carrier repository numeric ID 1466958702. Source-free admission [46090017983](https://github.com/ores-dummy-org-rust-wasm-2/atto-exact-tree-carrier/actions/runs/46090017983) is NOT semantic evidence. All ten jobs below completed with four successful steps, including exact public checkout and actual test command, and their logs were checked for the source commit/tree and scope PASS markers. A main-snapshot receipt is not evidence for any other PR head or integration tree.

| Source snapshot | Source head | Root Git tree | Hosted job / runner | Executed scope |
|---|---|---|---|---|
| LLVM #1114 (PR) | `eb7147303a59de2d3e9d24e60a110a1ab3a67cb2` | `fd793f62ef1c6ff63173d87533d0dc3ed5ffc42a` | [46090177176/140809009480](https://github.com/ores-dummy-org-rust-wasm-2/atto-exact-tree-carrier/actions/runs/46090177176/job/140809009480), runner 1000000163 | 40,000 admission/retirement + 1,000 settlement races per GCC and ASan/UBSan build |
| LLVM #1112 (PR) | `bcfaece095dd76779e738a91f46abec34d1e7714` | `a120db6db7dd03d4b5c4927173b55b391d60af9c` | [46090177176/140809009472](https://github.com/ores-dummy-org-rust-wasm-2/atto-exact-tree-carrier/actions/runs/46090177176/job/140809009472), runner 1000000162 | Real native execution/continuation stores, competing claim and finish |
| Java #2024 (PR) | `0876031e6e94a2be665a5a78da49de96739a3d0c` | `764ce01fd5a21f6fd22799f3c4144995a0daa9ea` | [46090177176/140809009497](https://github.com/ores-dummy-org-rust-wasm-2/atto-exact-tree-carrier/actions/runs/46090177176/job/140809009497), runner 1000000164 | 640 independent owner settlements (320 successful, 320 quarantined); standalone ledger |
| Cranelift #214 (PR) | `8024cbbe8e0d8ec7bc380db6737f5dde18ffba4f` | `d8bde9fcb1d382bfc35c813423b72e53b59cefc2` | [46090177176/140809009230](https://github.com/ores-dummy-org-rust-wasm-2/atto-exact-tree-carrier/actions/runs/46090177176/job/140809009230), runner 1000000167 | 8/8 host tests; 640 owners; 100,000 races; million-generation reuse |
| JS #316 (PR) | `438d0cca82b0646b4b5e32a2d2320b3362543abd` | `015a406c9630a4481c5f4ae87f477258c46dcbf1` | [46090177176/140809009436](https://github.com/ores-dummy-org-rust-wasm-2/atto-exact-tree-carrier/actions/runs/46090177176/job/140809009436), runner 1000000169 | 23/23 event-loop tests; no multithreaded claim |
| Conformance #738 (PR) | `2d970e680a9f14665fe139718f292e8ac9728074` | `9a6a7bdf9c2e9c669c5cdaddf01cd850e88e7465` | [46090177176/140809009476](https://github.com/ores-dummy-org-rust-wasm-2/atto-exact-tree-carrier/actions/runs/46090177176/job/140809009476), runner 1000000170 | 15/15 cooperation reference model tests |
| LLVM #1115 (stacked PR) | `8bb2a37e68c538ece9bac6c8f56b5e7b3dda9b54` | `9d7aea3bd6043a8049a577e64c6c152e9037d01a` | [46090543585/140810166696](https://github.com/ores-dummy-org-rust-wasm-2/atto-exact-tree-carrier/actions/runs/46090543585/job/140810166696), runner 1000000175 | Real Linux socketpair/epoll operation and native continuation integration; 256 cancellation/rearm races per GCC and ASan/UBSan build |
| Forge (main snapshot) | `a8144438b2de27759f74699b54fc1dc8ea5e5609` | `8ba058826a96ec9f58b09b4981142c617e50627e` | [46090610433/140810383673](https://github.com/ores-dummy-org-rust-wasm-2/atto-exact-tree-carrier/actions/runs/46090610433/job/140810383673), runner 1000000181 | 100,000 claim/cancel races and 640 owner settlements per GCC and ASan/UBSan configuration; million-generation lease test |
| .NET (main snapshot) | `c36d2c6996942c2868dbcceef2fc67df0253a2bb` | `d116d07e89e369ba4e2cd5eae10f061c9655b932` | [46090610433/140810383594](https://github.com/ores-dummy-org-rust-wasm-2/atto-exact-tree-carrier/actions/runs/46090610433/job/140810383594), runner 1000000180 | CLR Release standalone project using exact runtime and self-test source; 64 owners and million-generation churn |
| Wasm (main snapshot) | `0cf1b3dc192ee023e275d45d383e5570b31e9991` | `d18f0949090e2c8b5bb553a769ef07edd06555fd` | [46090610433/140810383374](https://github.com/ores-dummy-org-rust-wasm-2/atto-exact-tree-carrier/actions/runs/46090610433/job/140810383374), runner 1000000179 | 3/3 Node host-ledger tests; no Wasm guest execution |

## Carrier workflow provenance

| Run | Workflow head | Workflow root tree |
|---|---|---|
| 46090177176 | `a6731a95214ab9cf982f96cfab5e39b11780bf95` | `d12815284c0015c47b483cd9c3d476659f27e5fa` |
| 46090543585 | `cd3af6018768908196aac09b2ba8f54911285342` | `490a7804ce3bed3dccf38328aedc1695bace0298` |
| 46090610433 | `e1b6a65977f85881706af9beab52bd90077b9259` | `12749056b499d386c5c972d472ecf2ba3b256716` |

## Remaining evidence boundaries

- Java and LLVM full runtime integration, guest-generated nested continuations and scheduler-owned timers: NOT VERIFIED by these runs.
- LLVM real epoll test covers a scoped host socketpair path, not the production reactor, kernel DEL failure handling or full Spin.
- Forge, Cranelift, JS and .NET are isolated host primitives; Wasm is a Node ledger without actual guest memory or Worker execution. Rust compiler has no new qualification in this inventory.
- No full compiler suite, compiler binary provenance, identical compiled positive/negative guest, application-specific GraalVM/NativeAOT, zero-GC soak or production throughput claim is established.
- No merge or review is implied; exact integration head, all-Ready overlap review, independent approval and enforced protection remain mandatory.
