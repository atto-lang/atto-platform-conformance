# Resumable media streaming v1 — bounded replay, checkpointing and codec recovery

**Status: host reference and conformance contract only. No Oreslang video encoder/decoder, actor-lowered guest source, or five-backend execution is established by this change.** The runnable Node 22 reference lives in `lib/media-replay-v1.mjs`; the explicit test suite is `tests/media-replay-v1.test.mjs`. The machine-readable contract is `contracts/media-replay-v1.json`.

## Scope

A transport-owning actor retains at most **2,097,152 compressed-payload bytes per stream**, configurable at construction. A second bounded limit of 4,096 retained chunks protects metadata. It owns every retained byte buffer and copies both on admission and on replay; no mutable alias crosses an actor boundary. This is a *payload budget*, **not** a whole-process resident-set or end-to-end allocator limit. Admission controllers must separately account for per-tenant global memory, transfer clones, queue entries, encoder/decoder surfaces and FFIs.

The transport replay window is *not* a video decoder state snapshot. The encoder/decoder provider separately owns reference pictures, codec configuration/extradata, timestamps and hardware surfaces. Resetting a decoder requires an independently decodable random-access point with known codec configuration; a generic I-frame or arbitrary byte offset is **not** sufficient.

## Wire/actor contract (logical, not an established transport encoding)

- Each retained chunk is one complete compressed access unit or another codec-provider-certified independently replayable segment. Fields: monotonic `sequence` (starts at 0), monotonic byte `offset`, `endOffset`, owned `bytes`, `ptsUs`, `codecConfigId`, codec-verified `randomAccess`, and SHA-256 of the sealed payload. Native wire counters use checked `u64`; the JavaScript reference deliberately accepts only JS safe integers and rejects overflow.
- `ResumeRequest(streamId, generation, lastAppliedSequence, lastAppliedEndOffset, codecConfigId)` identifies the authenticated stream generation and the *highest contiguous fully applied* unit at the receiver, not merely bytes delivered by TCP. The initial checkpoint is sequence `-1` and offset `0`; a native wire format must assign an explicit start sentinel rather than unsigned -1.
- `Ack(streamId, generation, sequence, endOffset)` cumulatively frees retained chunks through the matching, actually emitted `sequence`. Matching duplicate ACKs are idempotent; out-of-range, forged-offset and stale-generation ACKs fail closed. The receiver must checkpoint its decode/application progress **before** publishing an ACK to avoid claiming data it could later lose.
- `append` accepts only contiguous sequence and offsets, complete immutable input, and a codec-config change at a verified random-access boundary. On full byte budget or max-chunk count, return `BACKPRESSURE`; **never silently evict unacknowledged data** or queue unbounded senders. Use the existing bounded channels/USER-mailbox credit rules. Control/restart signaling must not depend on saturated DATA credits.
- `resume` chooses (1) `continue` for an exact already-applied head, (2) `replay` from the first missing retained unit when byte offsets and codec config match, (3) `reset` at a retained, verified random-access unit after explicit decoder reset, or (4) `KEYFRAME_REQUIRED` if history cannot safely recover. It must never advertise a delta packet as independently decodable.
- `fence(nextGeneration)` atomically invalidates the old stream generation and clears retained buffers, credits and counters. Stale sender, receiver, ACK and resume messages never advance new state. Cross-actor migration needs a separately authenticated handoff; this prototype intentionally discards volatile history on actor restart.
- The receiver must discard duplicate `(streamId, generation, sequence)` deliveries, verify expected offset and payload integrity, and only release application-visible frames after dependency validation. SHA-256 here protects integrity evidence, **not** message authentication; use authenticated transport and identity-bound session capabilities. Restrict replay requests and buffer contents to the authorized stream and tenant.

### Network recovery example

1. The actor emits chunks 0–150, and the receiver has fully applied through 143. Its checkpoint is `(143, endOffsetOf143)`.
2. The transport disconnects. An authenticated reconnect provides `streamId`, `generation` and the checkpoint.
3. If chunks 144–150 are still retained and codec state matches, emit only 144–150 (same sequence, same bytes/hash) and resume forward transmission. Duplicate deliveries are harmless to an idempotent receiver.
4. If part of that history was evicted *after acknowledged application* but the reconnecting receiver has an older checkpoint, a suitable later random-access unit can provide `reset`; the decoder must explicitly drop its old reference state and initialize new codec config.
5. If no safe anchor remains, report `KEYFRAME_REQUIRED` and request a new keyframe or restart the segment/source. For on-demand video with a seekable origin, a separate range/seek path can reconstruct the lost frames.

## Error and supervisor policy

Return typed `Result<T, StreamError>` for expected conditions. `BACKPRESSURE` means await/propagate producer credit or drop the *stream session* according to an explicit policy; it does not panic. `KEYFRAME_REQUIRED` is a recoverable protocol-level resynchronization failure, not success. `CODEC_CONFIG_REQUIRES_RANDOM_ACCESS`, `CHECKPOINT_OFFSET_MISMATCH`, `STALE_STREAM_GENERATION`, authentication failure and invalid hash must fail closed. A codec worker crash terminates that incarnation and emits one supervisor CONTROL failure receipt; do not catch an actor panic as a stream error or reuse possibly corrupted decoder state.

Future strict `throws`, `raises` and `panics` effects must remain distinct across `Future<T>` continuations, actor mailbox boundaries, FFI and cancellation. The separately tracked checked-exceptional-effects v2 contract is not fully executable on all source backends. This reference uses explicit result envelopes instead of pretending `trap`/unwind is production-ready.

## Illustrative Oreslang actor API (NOT compiler-verified)

```ores
define actor ResumableVideoTransport as
    state {
        replay: ReplayBuffer<EncodedAccessUnit>,
        checkpoint: StreamCheckpoint
    }

    // Intended callable signatures; grammar / lowering TBD.
    on_chunk(unit: EncodedAccessUnit) -> Result<void, StreamError>
    on_ack(receipt: AppliedAck) -> Result<void, StreamError>
    on_resume(request: ResumeRequest) -> Result<ResumePlan, StreamError>
end
```

Only enter sealed `handle_state(critical-read ...)` / `handle_state(critical-write ...)` callbacks for short, synchronous state transactions. Never hold a mutable borrow or a writer lock across `await`, `select`, FFI, or a codec callback. Allocate and pin owned buffers in the actor's domain; for inter-actor forwarding use explicit move/share or bounded serialized data, never a `Stream<T>`, `Pointer<T>` or codec handle in a USER message.

## Backend admission and tests

The sender `ReplayWindow` and receiver `ReceiverLedger` host references, along with 32 deterministic tests (including six machine-readable cross-backend operation vectors), execute with `node --test tests/media-replay*.test.mjs`. Receiver `offer` validates a candidate without advancing state; the caller must invoke `commit` only after successful decode/application. `resetAt` requires an explicit codec reset and next verified random-access unit. They cover exact 2 MiB saturation/reclamation, 4,096-chunk guard, ownership copies, SHA-256 integrity evidence, cumulative and duplicate ACKs, stale generation fencing, malformed offsets, churn, keyframe reset, and codec config changes. The contract registry and host reference alone are **not** real guest compilation or video encoding/decoding evidence.

Each Java/Graal, LLVM, Wasm, Cranelift/Forge and .NET backend must independently pass the same behavioral cases at a pinned compiler SHA, and separately prove: sealed actor state and borrow checking across suspension; bounded channel/mailbox backpressure; nonblocking transport; exactly-once supervisor CONTROL on crash; actual codec provider availability and trusted random-access detection; negative corrupt/malformed-frame tests; live reconnection integration; and host/guest memory accounting. Wasm browser builds may use WebCodecs only when available and explicitly granted; native codec implementations can use vetted FFmpeg/platform APIs under a capability/ABI boundary. Unsupported providers must report a capability error, not fake parity.

**Not in v1:** persistence after process death, distributed consensus/duplicate-suppression across failover, unbounded catch-up, automatic FEC, RTP/RTSP/HLS/WebRTC integrations, actual FFmpeg/WebCodecs bindings, decoder/reference-frame snapshots, or precise wire serializer format. Those need separate admission and execution evidence.
