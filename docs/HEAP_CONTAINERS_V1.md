# Heap owners, Arc/Weak, and resizable vectors — v1 conformance gate

**Status:** source-free reference and contract tests only. No claim of
six-backend guest execution, compiler lowering, true atomic concurrency,
or Rust-equivalent borrow checking. The machine-readable contract
deliberately marks all toolchains unverified.

## Language and safety contract

The canonical Oreslang source remains pointerless: rt take, rt copy,
rt borrow, rt mut borrow, rt share, and type positions borrow T /
borrow mut T. Do not add public address-of, dereference or raw pointer
syntax as a shortcut.

**Box<T>** uniquely owns one heap allocation. Moving it transfers
ownership; copying must not produce a second unique owner. Borrow
checking must track the heap referent, not just a stack/local handle.
All normal, exceptional and cancellation exits must deterministically
drop an owned payload once. A live borrow prevents owner retirement.

**Arc<T>** provides atomic shared ownership. Cloning a handle must
not clone T. Ordinary dereference is immutable. Shared mutation needs
a compiler-recognized Mutex, RwLock, atomic or capability-guarded mutable
state container. Arc is not an authorization to share a mutable class.
Arc across actors/tasks requires T's appropriate Send/Sync proofs
**and** shared-region/Share authority; a JVM-host object being reachable
does not establish those proofs. Count overflow, concurrent retain/
close, weak upgrade/last drop, and exception-safe handle allocation
are mandatory native runtime tests. Weak<T> does not keep T alive;
upgrade can succeed only while a strong owner exists. Use Weak for
graph back-edges to avoid cycles. Rc<T> and RefCell<T> are local-only
and cannot be laundered into Send/Sync/Share.

**Vector[T]** is the existing canonical resizable owning sequence,
with Array[T] and List[T] already in the runtime-extent family.
A possible Vec<T> would be a convenience alias, not a second collection
implementation. It is *not* assumed to compile today. Preserve
Vector's heterogeneous repeating-shape behavior. Vector growth,
reserve, insert, remove, compaction and relocation need exclusive
backing-storage permission, checked bounds, safe capacity overflow
handling and allocation failure. Moving elements or reallocating
invalidates outstanding element views; the borrow checker must
end such loans first. Track allocation epochs and logical places.
Do not assume a vector borrow refers only to the stack handle.

**Shared mutable state:** injected state containers, singletons and
actor-owned allocations use the same heap place/loan rules.
critical-read and critical-write must not let a borrowed projection
escape a callback, return value, await, task, channel, cancellation
or actor boundary. Logical transaction races and deadlocks still
require separate reasoning beyond memory/data-race safety.

## What is implemented in this pull request

The immutable contract in contracts/heap-containers-v1.json pins
39 positive and negative reference cases, five immutable .ores
source fixtures (two positive, three negative), and six independently
unverified backends. The five fixtures are exact Git-blob-SHA1 pinned; they
have NOT been compiled or executed by any backend. src/heap-containers-v1-reference.mjs is a deliberately
bounded, scalar-only semantic oracle for Box owner/loan/drop,
Vector grow/bounds/epoch, Arc strong/Weak lifecycle and guarded
synchronous shared mutation. tests/heap-containers-v1.test.mjs
runs each case and refuses fabricated guest/backend evidence.

The reference deliberately rejects arbitrary mutable objects instead
of claiming to prove deep immutability. A Node single-event-loop
simulation proves neither true atomicity nor concurrent actor safety.
These are source-free reference tests; no .ores fixture is executed.

Run with Node 22+:

    node --test tests/heap-containers-v1.test.mjs
    npm test

## Required compiler and runtime promotion gate

Next add identical, SHA-pinned .ores positive and negative fixtures
for all cases. Cover nested heap projection borrows, Vector
reallocation while borrowed, Box use-after-move/drop, Arc mutable
alias rejection, Arc<Mutex<T>> guarded writes, weak expiration,
refcount overflow, cancellation and unwind, and cross-actor moves.
Positive cases must compile and execute; negative ones must fail
at the compiler ownership boundary with no executable unsafe IR.
An explicitly unsupported feature is a fail-closed result, **not**
positive parity. Track actual compiler, guest, native-image and
sanitizer results per exact source SHA separately.

- Java/Graal: real parser/typechecker, JUnit plus guest execution,
  Native Image, deterministic drops and region permission checks.
- LLVM: HIR/MIR borrow and drop lowering, actual native binary,
  ASan/UBSan plus suitable concurrency stress, zero tracing GC.
- Wasm: guest compiler, linear-memory growth, worker isolation,
  no retained stale vector views.
- Forge: independent typed/JIT/AOT ownership and drop tests.
- .NET: shared .ores guest source through CIL and Native AOT,
  not standalone C# reference tests.
- Cranelift: independent JIT/AOT guest tests, not LLVM results
  relabeled as Cranelift.

If source CI jobs have zero execution steps, they are runner failures,
not test passes. A funded private alternate-org runner may execute
an exactly verified source tree via token-free mirroring; require
per-blob SHA equality and never expose private code.

## Current independent backend follow-up PRs

The targeted five-backend work is tracked separately, each behind real execution:

- Java/Graal: [#2431](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2431), source parser/typechecker/ownership and guest List JUnit cases.
- LLVM: [#1285](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1285), four extra real compiler/native binary borrow-matrix cases.
- Wasm: [#254](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/254), fail-closed source-bridge heap ABI preflight.
- Cranelift: [#65](https://github.com/ores-truffle-oreslang/oreslang-source.cranelift/pull/65), scalar-JIT source rejection and scalar-positive CLI tests.
- .NET: [#318](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/318), parser-to-typed-IR heap rejection tests.

Source-org exact-head workflows on these PRs had zero recorded steps in sampled
runs on November 1, 2026, so they do **not** constitute test execution.
Negative feature rejection is important safety, but not positive runtime parity.

## November 1 strong-exception-safety follow-up

The bounded reference model now validates a Vector element **before**
reserving or changing its storage relocation epoch. Three new accepted
regressions require rejected pushes and over-budget reservations to preserve
length, capacity, contents, and view epoch. The current reference inventory
is **39 cases / 44 isolated V8 checks** (not Node tests or guest compilations).
The Java [source compiler PR #2431](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2431)
also rejects oversized resizable sequence **literal initializers** and
contradictory inline/max capacity metadata; this is distinct from enforcing
quotas after runtime mutation, which remains unverified.

## Additional reference-model security findings

- Callback-retained write guards previously allowed access after lock scope
  ended. The model now revokes guards on success and exception.
- Read callbacks now admit overlapping read-only access while denying writes;
  write guards are exclusive.
- A saved Arc view previously returned a raw mutable referent; it now provides
  a handle-checked guard facade. A live guard blocks that handle from dropping,
  and a saved facade refuses use after the originating Arc is dropped.
- These are bounded JS **models**, not claims of OS-thread atomicity, deep
  immutable payload admission, or native allocator correctness. An external JS
  reference held before creating Arc is outside this oracle's ownership proof.

## Existing work to integrate rather than duplicate

Java OresSmartPointers and hardening draft #2041 provide a runtime
Box/Rc/Arc/Weak substrate, not yet proof of guest lowering.
Java issue #1434/draft #1433 track shared-state source semantics.
Java draft #2385 tracks guarded rt mut share with SharedMutex.
LLVM issue #659 tracks native Arc, Mutex and RwLock parity.
The common-source ownership and memory-performance contracts remain
normative for these obligations. Keep all affected drafts behind
their own real, exact-head test gates.
