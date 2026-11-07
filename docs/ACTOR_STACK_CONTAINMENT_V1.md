# AttoLang actor stack containment — five-backend v1

**Status: contract and fixtures only; no backend certified.** The canonical new
source extension is `.atto`; legacy `.ores` compiler support and repository
filenames are separate migration concerns.

## The guarantee to build

An actor's heap allocation domain does **not** own the native stack of the
carrier executing its turn. Unchecked synchronous recursion on a shared carrier
can exhaust a native stack, threatening the process even if each actor has a
separate heap. AttoLang's portable execution contract therefore requires
compiler-enforced guest call/frame budgets checked before the unsafe host/native
stack boundary, and a controlled actor failure under supervisor ownership.

Java reference draft: [PR #2505](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2505)
adds a conservative carrier-thread-local 64-call guard at `Evaluator.invoke`,
which is only M0 defence in depth. It does **not** prove logical per-actor stack
allocation, JNI/FFI fault containment, actual VM stack-overflow recovery, or
process survival under arbitrary native recursion.

## Acceptance order

1. Admit the same four versioned `.atto` sources through each backend parser,
   type checker and linker. The sources are authored, not executed.
2. Prove 100,000 proper tail calls remain bounded; shallow calls return `42`.
3. Prove non-tail direct and mutual recursion fail with a typed guest-budget
   error before native stack overflow, rather than signal death or OOM.
4. Add real two-actor `.atto` acceptance: actor A exceeds its guest stack
   budget; B receives a later mailbox turn on a carrier reused after A's
   complete exit; the process remains alive. Verify actor A's termination
   reason is retained and cannot be swallowed by `trap`/`catch`.
5. Prove deferred cleanup, critical lock release, pending continuations,
   supervisor restart generation fences, timer/mailbox quotas and no
   uncommitted message replay.
6. Execute low-stack builds in actual native deployments: JVM/GraalVM, LLVM,
   .NET NativeAOT, Wasm engine, and Cranelift. Keep compiler-generated frames
   and host/native interop paths under budgets. **For Wasmtime**, setting
   `max_wasm_stack` bounds Wasm frames but does not prove that the embedding
   carrier thread has that much native stack available. Host callbacks can
   still exhaust the carrier, causing a process abort. Reserve for host frames,
   check `max_wasm_stack` against actual carrier/async stack capacity, and
   run low-stack hostcall/reentrant-Wasm failure tests. See
   https://docs.wasmtime.dev/api/wasmtime/struct.Config.html .
   Untrusted native/JIT guest code whose execution is not bounded must be
   inside a killable worker process or equivalent OS-level fault containment.

**Never** resume a shared carrier by catching Java `StackOverflowError`,
CLR `StackOverflowException`, SIGSEGV/SIGBUS or arbitrary native faults.

## Evidence requirements

For each backend record: immutable source tree SHA, compiler SHA and executable
digest, actual source fixture execution, non-empty runner steps tied to the
same head/attempt, observed failure classification, second actor response,
process exit status, and supervisor generation/cleanup receipts. Host-only
models and source-free canaries must remain separate. Missing or zero-step
Actions means `NOT_EXECUTED`, never `PASS`.

The `test/actor-stack-containment-v1.test.mjs` tests only contract integrity and
fixture presence. Its successful execution is not compiler-backed guest
execution, physical stack safety, or five-backend parity.

## M1 partial implementation and physical-isolation promotion gate (2026-11-07)

Java [stacked M1 PR #2624](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2624)
introduces an actor-incarnation-scoped logical frame budget and
carrier-local native recursion admission. This is useful runtime hardening
but **does not yet allocate execution frames in per-actor stacks**. It
must not populate the `actorStackStorage` receipt as PASS.

The five-backend manifest now separates these pending proof dimensions:

* `actorStackStorage`: local variables, return continuations and guest
  interpreter/compiler frames are held in actor-owned bounded frame storage,
  or independently allocated, safely switchable segmented stacks. No
  unchecked recursive path may consume shared-carrier stack space.
* `suspendedFrameOwnership`: a suspended guest call retains its frame-byte
  charge and exactly one actor-generation owner across scheduler migration;
  cancellation, timeout and teardown release those charges once.
* `actorStackGeneration`: restart, code reload and actor-slot reuse cannot
  bind or resume a predecessor's frame stack. An exhausted incarnation cannot
  regain guest call admission by trapping or swallowing the typed failure.

A passing host-only quota test is insufficient for any of these three.
Require compiler-backed guest A/B delivery with exact-head source and output,
low native-stack process-survival checks, supervisor CONTROL receipts, and
negative corruption/mutation tests before marking corresponding backend
evidence anything but `NOT_EXECUTED`.

New pending scenarios track independent actor quotas, suspension and carrier
migration, stale-incarnation fences, swallowed guest budget errors, and low
native-stack interoperability. They intentionally have no invented `.atto`
guest fixture or execution receipt yet. Each backend must provide a real
source fixture when its compiler accepts the construct.

## Java M1.5 bounded byte-frame arena — not compiler-lowered frames

Draft [Java PR #2627](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2627)
adds a host-only `ActorFrameArena` owned by each `ActorCell`, with managed
byte-frame allocations, 64-frame / 64 KiB bootstrap quota, opaque frame leases,
typed `ExecutionContext` allocation-domain identity, suspend/resume checks,
per-task cancellation zeroization, and actor finalization after physical
quiescence. Java host tests cover these paths.

This is an *allocated frame-storage primitive*, not yet AttoLang execution
frames. The source compiler has not lowered guest locals, return continuations,
nested expressions, or suspended `SourceTask` frames into that storage. The
suspension API itself does not create a scheduler-owned await ticket or prevent
mailbox reentrancy: its future compiler/scheduler adapter must integrate with
existing `sourceReceiveSuspended` and task continuation fences rather than
calling the arena directly as a substitute for await.

The contract's `frameStorageBootstrap` block explicitly records
`MANAGED_BYTES_ONLY`; actual compiler-lowered frames, full suspended source
tasks, NativeAOT execution, and native-stack process isolation are
`NOT_EXECUTED`. Five additional pending cases require evidence of exact
frame-byte quota behavior, foreign frame-token denial, retained suspension
charges, cancellation zeroization, and stale post-retirement resume rejection
on each backend. There are no fabricated `.atto` fixture receipts.

The *next smallest real-guest acceptance* is a pair of compiled `.atto`
actors: A recursively exhausts a compiler-managed frame-byte budget; its
supervisor observes a typed CONTROL failure after cleanup; B responds on the
same carrier with the whole process still alive. A separate low-native-stack
run must prove that stack guards, host callbacks and interop cannot consume
unsafe carrier frames. This is still a missing test, not a passing claim.

## M1.6 Java guarded byte reservations (2026-11-07)

Java PR #2627 now also links `GuestCallDepthGuard.enter/leave` to
`ActorFrameArena`: guarded synchronous guest calls reserve and release a
32-byte placeholder in an actor-incarnation-owned managed frame store. The
synchronous guard scope mints a fresh execution identity, and an exhausted
or invalid guard poisons the actor arena even if a trusted host callback
swallows the exception. Authored JUnit tests now total 20 in
`ActorFrameArenaTest`; none have a passing hosted exact-head receipt.

This adds an enforceable runtime accounting seam but **does not** save
compiled guest locals, root references, return continuations or await state.
The JVM interpreter still consumes its carrier native stack. It remains a
host/runtime partial implementation, not proof for
`actorStackStorage`, `suspendedFrameOwnership`, or native low-stack safety.
The new pending `synchronous-guest-guard-byte-reservations` scenario requires
actual compiler-backed guest proof before any of those statuses can advance.

The Java branch additionally authors one real compiler-backed *legacy* `.ores`
GraalVM polyglot actor A recursion / actor B survival JUnit case. It has not
run on the exact PR head, and it does not yet establish canonical `.atto`
parity, independent guest-frame layout, or native low-stack safety. Host model
tests (20) and this unexecuted compiler-backed test (1) are separately
classified in the conformance manifest.

## Java source-task scheduler frame integration (M1.7)

Draft [Java #2631](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2631),
stacked on #2627, explicitly binds each source actor's
`OresScheduler.runtimeOwned` to that actor incarnation's frame arena. A
source task receives an actor-domain `ExecutionContext` that survives
`await` and `cooperate`. A **64-byte bootstrap managed frame lease** is
charged when the task first enters its owning actor carrier, remains
allocated during suspension, and is released only after physically quiescent
scheduler retirement. Actor-owned scheduler parallelism must remain one;
foreign carrier/actor execution and generation mismatches are rejected.

**Not proven:** these bytes are NOT actual compiler-lowered `.atto` locals,
return addresses, operand roots, lexical unwind state, or a native stack.
`SourceTask` lowering remains independent of these bootstrap bytes, and
actor mailbox non-reentrancy still needs a compiler-backed integrated receipt.
The scheduler host tests have been authored but not run on an admitted
exact-head GitHub Actions worker.

The matrix now includes five additional explicitly pending cases for:
await frame retention, cooperate without frame reassignment, concurrent
suspended tasks, physically quiescent cancel/zeroization, and rejection of
wrong-carrier/generation resume. Their `source` fields remain `null` until
canonical compiled `.atto` actor fixtures and reproducible executed receipts
exist. The host bridge cannot promote any of the five backend matrices from
`NOT_EXECUTED`.

## Java M2.1 typed scalar actor frames (2026-11-07)

Draft [Java PR #2630](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2630),
stacked on M2 invocation-descriptor PR #2628, uses the same single
generation-scoped actor-owned frame to record *actual*, exactly typed
primitive-wrapper guest call arguments. Its evaluator decodes those bytes
before the invocation binds its arguments. The frame now reserves
`max(32, 16 + 9*arity)` managed bytes when all arguments are supported;
zero extra frame allocations are made. Byte/Short/Integer/Long/Float/Double/
Boolean/Character, including raw IEEE NaN payloads, are supported. Reference
values, closures, collections and arbitrary Java object identity remain
on the legacy JVM path and are **never persisted as pointers in frame bytes**.

Tail calls rewrite in-place. If arity grows beyond the existing allocation,
the call safely falls back to original JVM arguments rather than allocating
another active frame or misrepresenting owned stack storage. The tests
cover malformed tags, generation poison when invalid frame layout is
swallowed, actor byte quota before native call limit, foreign-carrier access,
and sibling survival.

This introduces *limited typed call-data* lowering, not lowering for guest
locals, reference roots, operands, return addresses, source `SourceTask`
continuations, nested expression recursion, or physical native stacks.
Its 7 Java host/runtime JUnit methods and 1 legacy `.ores` compiler/evaluator
JUnit method are **authored, NOT_EXECUTED** until stepful exact-head CI passes.
The new `typed-scalar-invocation-actor-owned-data` pending scenario raises the
contract to **20** scenarios and prohibits upgrading any backend's
`actorStackStorage`, `compilerGuest` or process-survival evidence without
the actual canonical `.atto` and low-native-stack receipts. This is
not five-backend parity and must not be merged as a certification.
