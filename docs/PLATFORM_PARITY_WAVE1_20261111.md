# Platform parity wave 1 — source fixture, not guest qualification (2026-11-11)

This is a **source-only coordination ledger**, not a release or execution receipt.
It does not override `contracts/platform-capabilities-v1.json` or any per-target
admission contract.

## Common baseline

All seven repositories carry byte-identical `tests/test_platform_portable_core_v1.ores`
and `tests/platform-portable-core-integrity.test.mjs`, pinned to the same source
blob. The former defines five deterministic arithmetic, signed-branch, boolean
and bounded-index assertions. The latter verifies exact fixture bytes, the
non-attesting `.oreslang/integration.json` identity and declared upstream edges,
and adversarial mutations. It does **not compile** the `.ores` source.

Canonical fixture SHA-256:
`a5cc72dcbc58f51f007ba956f6892b6485a9316d3ffa4410e157c95d7f3fe68a`

Canonical fixture Git blob SHA-1:
`f38143c4d3dae68e1fa846b950ca6206bfb8efbd`

## Target-specific execution lanes

| Platform | Common semantics lane | Required additional proof before promotion |
| --- | --- | --- |
| Mobile | Host-side source + native AOT guest | Android runtime execution, iOS static AOT/ABI on applicable signed target, actor ownership and lifecycle |
| Desktop | Host-side source + native AOT guest | LLVM/.NET/GraalVM guest linked to native host, event ownership, shutdown and OS matrix |
| Embedded | Freestanding LLVM AOT guest | Cortex-M/Zephyr QEMU and eventual device, bounded actor state/mailbox, no-GC allocator proof |
| IoT | Gateway-native AOT guest | Authenticated transport, replay/checkpoint crash durability, ownership and target integration |
| FPGA | HDL compiler artifact (not a general CPU runtime) | Compiler revision+RTL digest, simulation, synthesis, virtual timing/route, board I/O separately |
| ASIC | HDL compiler artifact (not a general CPU runtime) | Compiler revision+RTL digest, generic synthesis and formal equivalence, lawful PDK corner/timing/DRC/LVS signoff separately |

Do **not** demand JVM/Wasm/.NET runtime binaries inside freestanding RTL or
silicon targets to claim equivalent software backend coverage; those are
explicitly different capability classes. Conversely, common-source fixture
identity does not make any target compiler-compatible.

## Evidence gates and immediate blockers

1. Preserve the source-only integrity gate as advisory. A successful Git hash
   comparison cannot promote the stage beyond metadata/reference inspection.
2. Run a real compiler on each applicable source fixture and execute the guest,
   with source/compiler/artifact revisions and actual output bound to the job.
3. Run relevant emulator, OS, physical-board and process-corner checks independently,
   with negative controls and sanitizer/memory-budget tests where appropriate.
4. Reject queued, failed-before-start and zero-step Actions jobs as execution
   evidence. The seven PR-head host-fixture workflows checked on 2026-11-11 all
   reported `failure` with **zero executed steps**, not failed test assertions.
5. Any alternate CI mirror must be private, separately approved and allowlisted,
   checked for source/destination visibility **before copying**, and verified
   by exact Git tree/blob identity. A private source tree must never be copied
   into a public destination or treated as harmless because it is token-free.

## Coordinated draft PRs

- mobile #27, iot #34, asic #29, fpga #28
- desktop #38, embedded #46, conformance #694

All seven remain draft until independent exact-head executable evidence exists.
Do not merge solely on source-only CI or a locally passing reference model.
