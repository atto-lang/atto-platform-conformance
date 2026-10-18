# Wave 30 engineering follow-through — October 18, 2026

**DRAFT; none merged or production certified.** This document is a review queue, not a source-export authorization.

## Source-local draft pull requests

| Repository / issue | Draft PR | Current evidence | Still required |
| --- | --- | --- | --- |
| oreslang-common-source #79 | [#87](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/87) | 9/9 exact-blob CPython ledger/stress tests; 15,000 additional seeded streams checked; source-side IPC workflow has zero executed steps | Native transport, Java/LLVM integration, authenticated control frames, executed CI |
| oreslang-platform.embedded #19 | [#22](https://github.com/ores-truffle-oreslang/oreslang-platform.embedded/pull/22) | 6/6 exact-blob CPython tests for ARM ELF descriptor admission, missing symbols, symlink/FIFO paths | Trusted pinned nm provenance, Cortex-M target, allocator/IR proof, CI |
| oreslang-source.hdl #6/#7 | [#14](https://github.com/ores-truffle-oreslang/oreslang-source.hdl/pull/14) | 13/13 exact-blob CPython manifest/regression tests (7 baseline + 6 new) | Actual HLS compiler, synthesis/equivalence, executed CI |
| oreslang-data-science #9 | [#12](https://github.com/ores-truffle-oreslang/oreslang-data-science/pull/12) | 10/10 prior reference unit tests and randomized bounds checking | Real NdArray<T> compiler ABI and Java/LLVM parity |
| rx-ores #10 | [#16](https://github.com/ores-truffle-oreslang/rx-ores/pull/16) | Reference-only demand, termination and cancellation model | Separate fourth real ReadableStream/WritableStream Oreslang prototype |
| oreslang-proof-of-concepts #6 | [#13](https://github.com/ores-truffle-oreslang/oreslang-proof-of-concepts/pull/13) | Bounded mailbox source model with local finite-state checks | Runtime/scheduler fault injection and formal state-space extension |
| oreslang-source.wasm #88 | [#101](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/101) | 10/10 isolated V8 SIMD admission checks; current-main diff | Real SIMD opcode emission, benchmark parity and source-backed Wasm receipts |

## Reconciliation outcome

- Current-main refreshes succeeded for IPC, embedded, and Wasm: exact changed Git blobs were retained, and new draft branches were created **inside their original source repositories**.
- HDL reconciliation preserved newer main branch identifier and bank checks and added hardened manifest admission.
- ASIC and FPGA validator `main` already has stricter, independently developed duplicate-member/NaN, bounded regular-file, symlink and FIFO defenses. The earlier wave30 validator edits are **obsolete** and must NOT be applied over newer `main`.
- Other repositories and remaining issues continue in their initial wave30 draft branches or acceptance-plan state. Seven PRs are reviewable, not seven complete issues.

## CI and security state

- Funded `sagitta-stack/sagitta-infra` has executed an approved source-free CI workload with 21 successful steps ([run 39151702062](https://github.com/sagitta-stack/sagitta-infra/actions/runs/39151702062)).
- Source-repo IPC Actions [run 39156366671](https://github.com/ores-truffle-oreslang/oreslang-common-source/actions/runs/39156366671) failed with **zero steps**. This cannot be used as a test-failure claim or a passing exact-source check.
- No unapproved cross-organization private source/tree/blob mirroring was attempted. Private export is denied pending protected-main, independent review, destination numeric repo ID and exact source commit/root-tree approvals: [#57](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/57), [#69](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/69), [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77).
- The local results here are **reference-only**, not real compiler or native/hardware backend parity, and no PR should leave draft solely because a local test passed.

## Next independent work

1. Restore source-local runner allocation and record actual test steps.
2. Obtain independent review for private-CI policy; do not authorize exports until explicit protected-main proofs.
3. Wire issue #79 into authenticated native actor proxies and deterministic crash/receipt integration tests.
4. Wire issue #9 into unique-owner NdArray storage and Java/LLVM guest tests.
5. Keep stream-native Rx prototype separate; measure against native channels/callback/pull implementations.
6. Run physical FPGA/ASIC verification from current validators without downgrading the latest main.
