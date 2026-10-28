# Shared compiled actor-private heap guest acceptance v1

This is ONE canonical `.ores` source input, **not** a statement that every backend already compiles it. It is based on the existing LLVM source-actor owned-heap fixture, with B receiving another message after A's graceful STOP and physical join. Plain `stop` remains abortive and can abandon DATA; the graceful path is a new LLVM candidate, not yet demonstrated on other backends. Canonical Git blob: `016733b1fbc8bdfbde7414a15b877a190dd92806`.

## Observed guest contract

The exact same compiled `Worker` handler must execute under two same-kind actor identities with different physically owner-bound heaps. A receives 1,2,3,4 and produces **2,8,22,52**; B receives 5,6,7,8,9 and produces **10,32,78,172,362**. Real compiler-generated handler return values must reach an independently reviewed runtime observation hook. The guest's `main()` returns constant 43 as a **sentinel only**; successful exit alone cannot prove state isolation.

A separate runtime authority probe must deny foreign B→A reads and writes using otherwise-valid turn credentials. Acquire a genuine read-loan over A's compiled guest state; while live, A's write must fail and B must finish its fourth message (payload 8, resulting value 172). A requested graceful STOP must not physically free its arena while the loan remains held. A separate trusted probe must release the loan to unblock physical retirement; the synchronous guest `graceful_stop()` cannot release that loan itself. After A is physically reclaimed, the guest sends B its fifth message (payload 9) and must observe result 362. Finally, B must retire physically. These concurrent loan hooks remain **unsupported/unverified** until actual same-heap guest execution implements them. The probe must exercise the exact same actor heaps and generated field accesses as the compiled guest; a disjoint host memory model does not count.

## Evidence and admission

`tools/verify-compiled-actor-heap.mjs` verifies a bounded JSON trace against the pinned Git source blob, 23 strictly ordered events, distinct actor/heap identities, exact guest-derived values, foreign-access denials, write-loan exclusion and physical retirement ordering.

```sh
node --test tests/compiled-actor-heap.test.mjs
node tools/verify-compiled-actor-heap.mjs fixtures/actor-memory/compiled-guest-v1/two-same-kind-actors.ores /path/to/real-guest-observation.json
```

**IMPORTANT: output is always `CANDIDATE_TRACE_ONLY`, not a certified PASS.** The validator's tests are synthetic traces; neither that test run nor a well-formed trace proves compilation or execution. Independently verify exact source SHA/tree/blob, compiler executable SHA-256, guest executable/Wasm SHA-256, generated IR/IL, real guest execution, runner allocation with nonzero steps, result logs, source postflight, native/AOT mode and artifact identity. A trace can be fabricated or replayed. Do not allow candidate-owned ledgers to self-certify; do not promote zero-step or host-only regressions.

## Dependency order

1. Java/Graal: independently review and qualify #2012 → #2157 → #2200, then implement true compiled `ActorRef` and native arena field routing with JDK25/GraalVM Native Image guest proof. Keep draft stack unmerged until reviews and exact-head source admission pass.
2. LLVM: connect the already existing source actor two-heaps path to this pinned fixture and execute actual compiler-generated code with a real observation hook, native negative provenance probes, loan pinning and physical reclaim.
3. .NET: merged #188/#218 are host runtime evidence only. Implement `.ores` field lowering and executable Windows/Linux NativeAOT guest proof.
4. Wasm and Forge: the same guest fixture, heap isolation and independent real execution gates; neither can borrow JVM/LLVM host proof.
5. Only after synchronous compiled proof: a separate async/await/suspension/cancellation phase must preserve receiver/loan pins until **physical carrier quiescence**, not logical Future completion or cancellation.

All five backends are `UNSUPPORTED_OR_NOT_VERIFIED` for this complete **compiled** contract as of 2026-10-28. This proposal adds no private source mirror, carrier run, compiled-guest PASS, sandbox certification, hard-RT qualification or general zero-GC claim. Cross-organization publication requires separate exact-snapshot approvals and independent security review.
