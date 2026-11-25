# Logical critical and borrow decisions — v1

**Status:** source-free oracle only. Not a production borrow checker, executed guest test, runtime mutex, backend parity claim, or security boundary. Maintained separately from the active critical/suspends implementation drafts.

Companion to docs/ASYNC_TASK_BORROW_SAFETY_V1.md and contracts/collection-ownership-sync-v1.json.

## Core rule

The compiler must identify the protected allocation and projection, the logical actor/Task authority, conflicting aliases and call effects, the suspension boundary, and the lifetime of the last *physically running* child. The OS carrier/thread identity must never authorize access. Two Tasks on one thread can conflict; two threads touching disjoint unique allocations do not need a lock.

Actor-owned heaps and stacks provide independent allocation domains, but an actor's spawned Task does not inherit self, state, actor-turn authority, mailbox authority, or guard tickets. Tasks spawning actors must pass explicit owned Send initialization data (consuming the sender). Actor references are message capabilities, not raw mutable heap aliases.

## Compile-time obligations

1. Canonicalize every place to allocation ID, generation/incarnation, field/range projection, mutable/immutable provenance, exact checked Program, CFG/NLL lifetime, and logical actor/Task/continuation identity. Unknown provenance, trait layout, aliases, AST forms, and indirect call effects fail closed.
2. **LOCK_FREE** only when an exclusive owner has no conflicting live loans, or when immutable Sync-backed sharing proves no possible writer. A readonly view does not freeze mutable backing. Arc, Rc, wrappers, generics and FFI handles cannot mint Send, Sync or exclusive permissions.
3. Ownership transfer happens at *spawn submission*, not await. A moved value requires compiler-derived transitive Send and cannot be used by parent or sibling afterward. Move and borrow checks apply through exceptional, canceled, and merged CFG paths.
4. Scoped immutable Task READ requires trusted exact lexical TaskScope, resolved Sync, source allocation/projection/generation, exact Task identity and physical-quiescence fencing. Cancellation requests and Future completion alone must not release loans. Scoped WRITE remains fail-closed pending disjoint-place and runtime authority proofs.
5. Mutable sharing must be explicitly synchronized per **resource**. Read/read may overlap, but read/write and write/write may not. Guard ownership attaches to the logical continuation and resource ticket, never OS thread, actor name alone, or carrier. Bare critical syntax does not grant protected-state access.
6. Protected state checks include aliases, nested callbacks, typed indirect calls, method receivers, foreign code, exceptions, defer/finally and serialization boundaries. Guard and state loans never escape via closures, Option/Result/Future, iterators or projection views.
7. Reject await, select, rt cooperate, implicit preemption, blocking I/O, generator yield, CPU/GPU handoff or any other suspension while a non-suspendable mutable/guard loan is live. No implicit yield inside a critical body. The runtime may suspend *before* entry to acquire a guard, not while executing the protected body.
8. Actor single-flight turns are independent scheduler reservations, retained across suspension with incarnation fencing. A lock-elision proof for actor state requires a currently admitted exclusive turn, no escaping alias, and no concurrent child authority. Tasks can access a distinct explicitly shared resource only through its own safety proof.
9. Guard grants must be cancelled/released exactly once on all completion paths; queue admission must be bounded, fair and non-parking. The reference oracle models only immediate acquisition, not queue ordering, lost wakeups, timeouts, or physical scheduling.
10. Reject reentrant acquisitions and read-to-write upgrade until an explicit sound, deadlock-aware policy is implemented; cross-resource lock ordering must be checked before enabling nested critical scopes.

## Abstract oracle and its limits

lib/logical-borrow-critical-oracle.mjs models explicit principal identities, allocation generations, owner moves, immutable Sync shares, guarded mutable shares, exclusive actor turns, live scoped-read loans, cancellation and physical retirement. tests/logical-borrow-critical-oracle.test.mjs exercises abstract decisions, not real guest source. Inputs such as principal(), share(), scopedRead(), region() and turnStart() are *hypothetical trusted compiler facts*; they are never safe as guest-authorized APIs. The oracle is not a sound trait solver, CFG borrow checker, scheduling runtime or implementation of unforgeable TaskScope proofs.

## Executable backend promotion gate

Java/Graal must lower this contract from real source through type-resolved Send/Sync, CFG/NLL checking, protected-state effect checking, transactional Task captures and exact program/epoch proof tickets. LLVM must reject invalid ownership before IR and then prove its native admission, cancellation and actor generations under ASan/UBSan. WASM, Forge and .NET must use identical source scenarios and diagnostics with their own backend scheduler and memory-domain enforcement.

Require both positive compiled-and-run guest fixtures (unique owned mutation, safe immutable reads, true protected mutable shared operation, actor turn state use, ownership transfer) and negative semantic compiler diagnostics (cross-actor state, use-after-move, guard escape, await/safepoint inside critical, invalid Send/Sync, mutation during scoped read, stale generation, illegal upgrade). Test OS carrier migration, child Task retirement after cancellation, reentrant actor turn, and shutdown cleanup. In each backend, pin exact SHA/tree and nonzero executed compiler/runtime steps; additionally run Java/Graal Native Image, .NET NativeAOT, Wasm Worker, and LLVM/Forge sanitizer execution. Parser-only rejections, zero-step CI and this source-free oracle count as **not executed**, never as parity.
