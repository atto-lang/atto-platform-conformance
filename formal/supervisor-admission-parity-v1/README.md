# AttoLang five-backend supervisor admission/recovery parity — v1

**Scope:** Java/GraalVM, LLVM, .NET NativeAOT, Wasm and Forge.
**Status:** `UNVERIFIED_IMPLEMENTATION_CANDIDATES`. This folder does not certify compiler-backed guest behavior.

## Candidate draft PRs

| Backend | Draft PR | Source test boundary |
| --- | --- | --- |
| Java | [#2785](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2785) | Host escrow permits, ancestor fence, pending tickets, incomplete nested child publish |
| LLVM | [#1697](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1697) | NativeActorGroup/PriorityActorInbox close vs DATA and physical loan release |
| .NET | [#485](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/485) | CLR ActorRuntime send vs STOP, sibling and native budget |
| Wasm | [#475](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/475) | Real synthetic Wasm Worker supervisor STOP vs DATA, old handle and sibling |
| Forge | [#266](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/266) | Real C++ actor incarnation owner send vs STOP, heap/frame cleanup and restart |

The `manifest.json` records exact PR heads and **eight** parity cases with explicit `UNIMPLEMENTED`, `AUTHORED_HOST`, `ACTOR_LOCAL_HOST_ONLY`, or `NOT_EXECUTED` labels as appropriate. A coverage label means source is authored, **not** that actual compiled code ran. The `check.mjs` validator rejects missing backends/scenarios and false execution or physical-cleanup receipts.

### What the new gates test

- LLVM: 128 additional raced native bound inbox/close iterations, alongside 400 existing sender/STOP races; GCC/Clang optimized + ASan/UBSan test lane.
- .NET: 6,144 real CLR host sends raced with actor STOP; one healthy sibling and physical arena allocation returned to zero. NativeAOT guest compilation is not verified.
- Wasm: 48 real synthetic-Wasm Worker sends raced with explicit supervisor STOP; unrelated sibling, no unexpected restart, stale DATA/STOP denied.
- Forge: 6,144 native actor owner send/STOP races; native heap/frame budget refund, sibling, stale generation, fresh restart.
- Java: previously authored 65,536-attempt standalone ledger race harness and 10 real ActorRuntime JUnit tests; note Java remains the only branch with a draft **hierarchical ancestor escrow**, and supervised child spawn is deliberately denied until registration is transactional.

**The above new native host regressions are `AUTHORED_NOT_EXECUTED` on their exact PR heads.** All five org source workflows currently fail with **zero recorded steps**, not compiler diagnostics. No GitHub Actions PASS is claimed.

### Full parity promotion criteria

1. Repair source-org runner admission or obtain independently authorized private CI carrier approval. Never transfer private Git source to an unapproved organization.
2. Stepfully execute each exact-head native runtime test suite and compare test inventories/results, without counts inferred from source alone.
3. Implement **one authoritative supervisor CONTROL ledger per backend**, with pre-reserved unforgeable terminal events and group/ancestor admission fencing—not merely per-actor STOP.
4. Implement atomic supervised child terminal-slot reservation → runtime actor publish → rollback. A guest child must never escape a failed parent's CONTROL ownership.
5. Restart requires supervisor policy commit and independently authenticated physical lease/arena/stack/FFI reclamation. A Java Future, .NET Task or synthetic boolean is never enough.
6. Execute a common compiled `.atto` guest with nested supervisors, actor stack exhaustion, panic/raise/uncaught throw, concurrent send-vs-fence, and a healthy sibling. Compare trace keys (actor identity, generation, terminal kind, pre-fence seq, physical receipt, policy decision, restart epoch) across all five.
7. Run actual TLA+ TLC and backend trace refinement, exact HEAD and immutable tree/blobs. Keep source/guest/AOT evidence distinguished from model or host-only outcomes.

**No merge recommendation until those conditions are satisfied.** Do not interpret these draft additions as parity certification.
