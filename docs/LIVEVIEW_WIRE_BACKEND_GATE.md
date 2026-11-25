# Ores LiveView v1 — five-backend transport parity gate

This is a **normative source-independent wire oracle**. The 14 masked
RFC 6455 client-frame vectors were copied from the exact private Phoenix
reference PR #11 blob pinned in `contracts/v1/liveview-wire-v1.json`.
A new dependency-free Python parser independently checks expected messages
and negative close codes. It never starts any backend, server or guest.

Run `python3 bin/verify_liveview_wire.py contracts/v1/liveview-wire-v1.json`
to get **HOST_WIRE_ORACLE_PASS; NATIVE_GUEST_NOT_EXECUTED**. The Node
adversarial harness also tests duplicate IDs, tampered payloads and changed
close-code expectations. Host-only success is not backend parity.

## Canonical wire and application boundaries

- WebSocket subprotocol: **`ores-liveview-v1`**, same-origin `/live` JSON.
  The earlier experimental `ores.live.v1` in Phoenix PR #9 is **NOT
  compatible**. Do not silently switch subprotocols or reinterpret frames.
  PR #11 must be the canonical consumer until a reviewed versioned migration.
- Strict RFC 6455 client masking, no extensions/compression, bounded 64 KiB
  reassembled message, UTF-8 validation after reassembly, bounded fragments,
  strict close codes, control-frame priority, input quotas and deadlines.
- Actor/guest source must not receive a Java object, native pointer, host FD,
  cookie or raw WebSocket frame. Source owns the typed session/reducer/render;
  transport owns framing, auth, lifecycle and physical socket closure.
- HTMX `/live/htmx` is separate escaped OOB HTML; SSE is a separate
  authenticated unidirectional transport, with HTTP POST for commands.

## Five backend execution criteria

| Backend | Required real implementation | Status at contract creation |
| --- | --- | --- |
| Java/GraalVM | Native NIO WebSocket + actor-bound guest handle, JDK25 and Native Image | **NOT_EXECUTED** |
| LLVM | Native reactor, compiled .ores guest, ASan/UBSan and wire oracle | **NOT_EXECUTED** |
| WASM | Browser/worker WebSocket host capability with equivalent messages and lifecycle | **NOT_EXECUTED** |
| Forge/Cranelift | Forge host adapter, native actor lifetime, typed guest path | **NOT_EXECUTED** |
| .NET | Socket transport with isolated actor owner and NativeAOT proof | **NOT_EXECUTED** |

The very same 14 raw frames must produce exact expected frames or close codes
in all five backends; a parser model or JavaScript reference is insufficient.
For WASM, test the applicable browser/worker capability boundary and explicitly
record where low-level masked client frame parsing is hosted rather than claim
that browser JavaScript can access raw WebSocket frames.

Per-backend receipts must include immutable source commit/tree and compiler
binary artifact hash, actual nonzero GitHub runner ID, executed job/steps,
guest compiler source and execution, observed vector ID+outcome, and target
(AOT/worker/native) details. Host-only checks, skipped, zero-step and
synthetic results cannot promote parity. Independently verify the receipts
against GitHub job/log and artifact evidence; self-reported JSON is not proof.

**Security:** private compiler/source may not be exported into alternate
GitHub organizations without approved, protected source+carrier controls.
Phoenix #8 and Java #1636 remain external blockers.
