# AttoLang actor stack M4 — source-task / scalar-frame integrated acceptance

**2026-11-07 · Draft conformance · 36 pending scenarios, zero verified guest
backend parity receipts.**

## Source change provenance

- Java [PR #2639](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2639) integrates the exact six changed file blobs of SourceTask
  [#2631](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2631)
  at head `3ac313ee2e79fbd4b36506525d0f367c4e42a12c` into a tree based on
  scalar M3 [#2633](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2633)
  head `12f6475be1690b857b26824d420a39ae9e74a239`.
- Existing Conformance [#562](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/562)
  contains physical stack safety requirements. M3 [#573](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/573)
  invents scalar call / return tests. M4 adds the exact combined-source integration
  checks without editing these other branches.

## Seven additional pending scenarios

1. One SourceTask reserves 64 managed bytes and one nested scalar invocation
   reserves a distinct 32 bytes, peak **96**; the scalar lease must unwind
   before await, leaving 64 charged and zero bytes after terminal quiescence.
2. The same logical SourceTask `ExecutionContext` must survive await while the
   next resumed scheduler dispatch gets a **new dispatch ID**.
3. Reject an open synchronous guest lease across an actor SourceTask await,
   fail actor and task before arming continuation and clear carrier TLS.
4. Reject the same leaked lease across `cooperate`, preventing a reused
   worker from inheriting stale call authority.
5. Real compiled `.atto` actor computes Fibonacci(8), cooperates, then
   computes 100,000 tail calls, expected `21|100000`. This exercises two
   separate synchronous call chains on either side of suspension; it does
   **not** prove in-flight scalar call-frame persistence.
6. Cancel waiting SourceTask after an already closed scalar invocation; the
   task's remaining 64 bytes must be released without poisoning siblings.
7. **Still unimplemented:** an `await` inside a recursive scalar call must
   store *every* active function frame, live operands, PCs and cleanup state
   in actor-owned persistent memory, resume with the same task execution ID
   on a different carrier, reject duplicate/stale-generation callbacks,
   preserve return value and release all bytes exactly once.

Each scenario needs exact-head compiler/actor or negative execution receipts
before it can be marked PASS. Keep last item `NOT_IMPLEMENTED` until a
typed stackless continuation instruction lowering exists.

## Evidence requirements

Capture immutable Java and conformance Git head+tree, exact `.atto` source
blobs, runner attempt/job IDs, **nonzero executed steps**, compiler version,
actual JUnit counts, guest stdout/stderr, native process exit, cleanup and
supervisor CONTROL acknowledgments. Source-free conformance V8/Node asserts
are **not** backend guest execution. A hosted workflow with
`steps=[]`, `steps=null`, or `runner_id=0` is a **runner-admission
failure**, even if its conclusion says `failure`.

**Promotion prohibited** without compiler-backed Java acceptance, low
native-stack process survival, actor A failure/B sibling recovery, cancel
and generation mutation tests, valid independent approval, and the same
fixtures executed under LLVM, .NET NativeAOT, Wasm and Forge/Cranelift.

The M4 SourceTask lease is a **64-byte bootstrap frame** only; active M3
return PCs and operand stacks are still host-managed, and in-flight
recursive call-frame suspension is not supported. Do not call this a
fully actor-owned or native-isolated execution stack.
