# Ores LiveView v1 — five-backend RFC6455 conformance gate

**Candidate contract, not native execution evidence.** Source fixture:
`contracts/v1/ores-liveview-wire-v1.json`. It is byte-identical to
`oreslang-phoenix-server.ores` draft PR #14's 41-vector fixture,
Git blob `931f58c1acd40e4c7e1b0b061f1711a0afe3c9b8`.

The 41 vectors cover positive masking, UTF-8 across fragments, ping/pong/close,
negative reserved opcodes and control fragmentation, invalid close reasons,
non-minimal lengths, and immediate overflow rejection. A backend must process
**the same byte stream** and report the exact observed text/binary messages or
close error code; the fixture is independent of frontend Oreslang syntax.

Backend source targets:
- `oreslang-source.java` — Java/GraalVM / Native Image; RFC6455 host stack
  currently in draft PR #2061 and related hardening PRs, not guest-certified.
- `oreslang-source.llvm` — native LLVM / custom VM isolates, zero GC and hard
  real-time aspirations; no compiled WebSocket guest evidence.
- `oreslang-source.wasm` — browser/Node isolates and workers; no native WebSocket
  guest conformance receipt.
- `oreslang-source.forge` — independent Forge native backend; no compiled
  WebSocket guest conformance receipt.
- `oreslang-source.net` — full Native AOT; no compiled WebSocket guest conformance
  receipt.

The canonical portable source-side LiveView protocol is **not ratified**:
Phoenix PR #9 (`ores.live.v1`) differs from PR #11 (`ores-liveview-v1`).
Do not imply these applications are wire compatible. The frame contract is
transport-level only, not evidence for actor ownership, serialization, HTMX,
SSE, authentication, CSRF, replay, or WebSocket handshake correctness.

Run `node --test tests/liveview-wire-gate.test.mjs` for fixture and adversarial
source-only gate checks. `node bin/check-liveview-wire-v1.mjs` checks the
immutable registry, returns exit **3** after structural success by default
(never falsely green for parity); `--structural-only` returns 0 solely for a
content integrity inspection.

For an actual backend bundle, supply one JSON report with schema
`ores-liveview-wire-backend-receipt-v1`, exact five backend records and
41 case observations each. The validator demands recorded exact source SHA,
tree SHA, binary SHA-256, runner/job/run IDs, positive executed-step count,
and every expected wire observation. **All of these are untrusted report claims.**
It never asserts CI provenance or guest execution authentication, even for a
synthetic structurally complete report. Independently verify GitHub job steps,
pinned source + tree, source-to-binary provenance, compiled guest entrypoint,
real network/system calls, and cross-isolate lifecycle before parity promotion.

Follow source/private carrier security incident #22. Token-free Git-object
mirroring does not authorize private source transfer. Never use alternative
organization runners absent independently approved protected source/carrier
governance. Zero-step workflow runs are NOT_EXECUTED.

## Optional sixth backend: independent Cranelift stage-0

Cranelift is a **separate** `oreslang-source.cranelift` repository and must
never inherit Forge receipts, host decoder results, or compiler success.
Its current implemented source profile is a limited scalar native JIT:
WebSocket actors, network adapters, async I/O, connection ownership and
RFC6455 guest decoding are **unsupported**. It therefore cannot truthfully
produce a compiled WebSocket guest execution receipt today.

The original five-backend `ores-liveview-wire-backend-receipt-v1` schema
and `validateReceipt()` remain unchanged for existing callers. A separate
`ores-liveview-wire-six-backend-receipt-v1` contract is validated by
`validateSixBackendReceipt()`. It requires six distinct repositories:
Java, LLVM, WASM, Forge, .NET and Cranelift, all 41 exact vector
observations, a `cranelift-native` profile for Cranelift, its own runner
and native guest receipts. A Forge report cannot stand in for Cranelift.

**This validator intentionally never authenticates any user-supplied receipt**,
including syntactically complete six-backend examples. Every reported
`runner_provenance_authenticated`, `guest_execution_authenticated`, and
`backend_parity_certified` value is false. Only independently audited
actual compiler execution can lift those conclusions in a future system.
The explicit six-backend validator is a structural gate, NOT a claim that
the Oreslang source runs across six toolchains.
