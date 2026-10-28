# Shared compiled actor ownership fixture v2 (draft)

This is a **single canonical guest-source contract** shared by Java/GraalVM, LLVM, .NET, Wasm and Forge. It is **not** a green guest result or certification of physical heap isolation. Run the *same hashed source bytes* on each backend; never rewrite per backend to make a check pass.

- `peer-owned-state.ores`: two `Counter` instances of the same type. A receives two messages, B receives one, A completes `done`, and only then B receives its second message. The output multiset must be exactly `1,1,2,2` regardless of scheduling order. The `done` await must be bound to physical quiescence before asserting reclamation; output alone does not show bytes actually freed.
- `foreign-state-reject.ores`: attempting `a.state.count` outside A must be rejected **for foreign actor state authority**, with no emitted runnable artifact. Rejection for unsupported actor syntax or an unrelated parser error is `UNSUPPORTED_LOWERING`, not a passing safety test.
- `read-loan-write-reject.ores`: a write with only `state.read` effect must be rejected **for missing write authority**. Again, parser rejection does not count.

There is no currently portable source-level API to intentionally hold A's read loan across STOP and assert B's heap charges or A's physical allocator release. Each backend needs a compiler-linked runtime probe, using this fixture's identities, with proof of A's pinned loan, A mutation/refund denied while pinned, B progress during A's pending retirement, exactly-once refund after release and B progress after A's *physical* destruction. This is a separate required gate, not implied by guest stdout.

Suspension/cancellation is a later required variant: receiver and state loans remain pinned across await, cancellation, callback and FFI retirement until execution is physically quiescent. Neither logical Future settlement nor `done` without physical evidence suffices.

## Evidence classification

- `NOT_EXECUTED`: no compiler actually built and executed this fixture (all five backends initially).
- `UNSUPPORTED_LOWERING`: real compiler lacks a needed guest construct; record its diagnostic and exact source head.
- `HOST_ONLY`: arena/FFI/NativeAOT host probes ran but not compiled source actor.
- `GUEST_CORE`: independently authenticated positive and negative *compiled guest* tests; physical lifetime still unproven.
- `PHYSICAL_OWNERSHIP`: in addition, native allocator, loan/quiescence, and post-reclaim B progress receipts independently verified.
- `SUSPEND_CANCEL`: in addition, execution/FFI/timer callback retirement across suspension/cancellation verified.

`node fixtures/actor-memory/v2/verify.mjs <receipt.json>` checks only report **consistency**. Even a consistent report stays `independentlyAttested=false` and `publiclyPromotable=false` until an authorized reviewer inspects immutable workflow run/job/step provenance, compiler artifact origin, source head/tree and backend receipts. It cannot establish execution itself. `node --test fixtures/actor-memory/v2/verify.test.mjs` covers nine source-free gate tests only.

Prerequisites and sources: Java #2012→#2157→#2200→#2207, with main-based #2205 reconciliation; LLVM #1115 and #1119 merged; .NET #225's functionality was incorporated by merged #193. All Java draft/security publication checks still apply. Wasm #160 remains draft; Forge source actor/heap lowering must be probed and recorded unsupported where appropriate. No private-tree CI mirrors may bypass mandatory publisher admission.
