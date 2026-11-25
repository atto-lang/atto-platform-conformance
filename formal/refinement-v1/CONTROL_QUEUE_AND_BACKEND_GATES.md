# CONTROL queue and guest-compiler verification gates (2026-11-07)

This is a **bounded design trace**, not actual compiler or runtime verification.

## CONTROL queue hardening

`panic-control` must now include `data_enqueue` with a unique, bounded message ID
before any `deliver_data`. A DATA delivery consumes the head of that actor's
FIFO queue. After panic the actor is dead: no DATA delivery or enqueue is allowed,
the single `control_notice` must occur, and every remaining queued DATA entry
must be explicitly accounted via `discard_data`, after CONTROL notification.
The bounded scenario deliberately covers one delivery *before* panic and one
post-notice discard. It is not proof of actual CONTROL priority in a scheduler,
a bounded carrier pool, sibling-actor survival, physical stack isolation, or
the precise wall-clock order of concurrent callbacks.

## Guest trace intake

`node formal/refinement-v1/guest-trace-intake.mjs --trace-file trace.json`
checks an untrusted, bounded JSON trace bundle containing all three replay
scenarios and pins the *candidate* pub-sub `.atto` fixture Git blob. It
returns `UNAUTHENTICATED_TRACE_SHAPE_ONLY` and false for all provenance,
guest execution, parity, and merge-readiness flags. **Passing it does not
mean a compiler or guest ran**: the JSON can be fabricated and the candidate
program is not yet able to generate CONTROL/critical instrumentation.
Only separately authenticated source-org job read-back and matching runtime
receipts can promote a backend.

## Executable backend targets (not yet receipts)

- Java/GraalVM: [source.java PR #2440](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2440) contains `SourceActorPubSubExecutionTest`
  and actual `Context.eval` expectations for a prior `.atto` fixture; that
  fixture still uses retired `pub async routine`. Admit the new canonical
  `pub suspends fnc` fixture explicitly, then instrument real runtime events.
  Repeating the old test is not proof of this new source.
- LLVM: [source.llvm PR #1296](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1296) currently uses an explicit
  negative source gate for ActorGroup/Topic. Implement parser/HIR/MIR/backend
  lowering before a positive guest trace can exist. Do not treat native host
  registry tests as `.atto` guest evidence.
- .NET NativeAOT: [source.net PR #327](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/327) has host infrastructure
  and source admission but requires compiled Topic source and real NativeAOT
  execution.
- Wasm: [source.wasm PR #263](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/263) currently has host JS pub-sub
  and fail-closed unsupported source constructs, not guest WebAssembly parity.
- Forge/Cranelift: no compiler-backed guest execution receipt verified in this
  audit; keep NOT_EXECUTED pending a pinned and observed backend run.

All five backends remain **NOT_EXECUTED**. Before release, require exact
program/backend Git blobs and trees, compiler/runtime/artifact digests,
actual hosted runner ID/job ID/run attempt and positive executed steps,
guest stdout, negative rejection diagnostics and an authentic runtime trace.
An ordinary model pass, any self-reported JSON, and a zero-step job are
never valid substitutes.

## P0 external dependency

[Platform conformance issue #315](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/315)
records an authoritative GitHub Actions annotation refusing runner admission
for a payment/spending-limit condition. Only the authorized organization billing
owner can repair that setting. The reference PRs remain draft; independent
review, protected main, and separate private-source governance hold.
