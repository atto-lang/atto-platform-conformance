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

## Java M3 SourceTask scalar snapshot integration (2026-11-07)

New stacked draft [Java #2638](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2638)
semantically merges typed invocation-frame draft #2630 with actor source task
lease draft #2631. Both feed one per-incarnation actor-frame arena and ID
allocator. Nested scalar invocation frames still reserve one charged
`max(32,16 + 9 * argumentCount)` frame; the source task holds a separate
64-byte lease across `Await` and `Cooperate`. These share the quota,
rather than allocating a second invocation descriptor frame.

The **new bridge** can explicitly save up to six pointer-free typed scalars
in the precharged task lease, then restore them after authenticated resume.
A four-byte length header plus 9-byte typed slots fit within that lease;
overwrites clear stale bytes, unsupported references and larger state are
rejected before storing, and cancellation/restart retain existing generation
and physical-quiescence fences. Producer threads cannot use a waiting
task's storage capability. This is trusted host/runtime ABI only and does
not automatically lower source `.atto` local variables, objects,
continuation return PCs or recursive evaluator frames.

Five additional host/runtime JUnit methods are **authored, NOT_EXECUTED**:
mixed synchronous/task quota and non-aliasing across await, independent
suspended task charges, cancellation after scalar invocation, explicit
scalar snapshot across await with foreign-caller denial, and incompatible
reference/oversized state rejected before `cooperate`. No exact-head
nonzero-step Maven/JUnit result, canonical guest actor receive
non-reentrancy or native low-stack process survival receipt has been
verified. The two pending M3 scenarios bring the contract to **27** cases.
Every backend's `compilerGuest`, `suspendedFrameOwnership`,
`actorStackStorage` and supervisor/native evidence stays `NOT_EXECUTED`.

Next: actually run the integrated Java branch at its exact head and tree,
lower typed compiler locals/program counters in an iterative interpreter,
then prove source actor handler non-reentrancy, A-fails/B-survives,
supervisor restart generation fencing and native low-stack process survival
before any stack parity claim.

## Java M3.1 automatic scalar SourceTask formal argument binding

Draft [Java #2642](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2642)
is stacked on #2638 and changes the actual Java `SourceTask` evaluator
parameter-binding path. For supported all-primitive formal arguments up to
six slots, the actor source task writes a typed image into its *already
charged* 64-byte task lease and decodes the **actual values from actor-owned
bytes** before calling `bindCallableArguments`. On each ordinary task
resume it validates that the original typed arguments match the arena image
before continuing. The frame region is compiler-owned and cannot be
overwritten by an unrelated host snapshot. A foreign producer cannot read or
mutate it. Unsupported objects/captures or wider arities **do not** become
guest-pointer serializations; those calls retain an explicit JVM fallback.

This is a **restricted automatic formal-parameter bridge**, not a generic
source Env/lexical local lowering, not compiler-owned return PCs, not an
iterative stackless evaluator, and not a separately switched native stack.
Canonical guest actor fixture
`source-task-typed-args-cooperate.atto` is authored with an expected output
`before|42|second`, testing a suspending two-integer function and mailbox
nonreentrancy. Three additional Java host JUnit methods check actor-frame
binding across await, unsupported argument fallback and fail-stop mismatch
with sibling survival. **All four tests are AUTHORED_NOT_EXECUTED**, until
real exact-head Java/GraalVM JUnit/guest execution actually completes.

The M3.1 conformance child adds two pending cases, now **29** scenarios,
and forbids promoting a parser acceptance or a host-only source mirror to
canonical compiler-backed .atto proof. All five backend evidence statuses
remain NOT_EXECUTED. Missing `steps` or no runner admission is not a
compiler failure. See the source PR's M3.1 document and tracking issue #341
for outstanding true stackless guest/frame/supervisor/low-stack gates.

## Java M3.2 bounded scalar lexical slots and return-record ABI

The new draft [Java PR #2643](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2643)
stacks on #2642 and changes the real `Evaluator.Env` lexical scalar
definition, initialization, lookup and `let` reassignment path to use
**actor-owned SourceTask frame bytes** for a bounded subset. The six 9-byte
typed slots remain shared with automatically bound scalar formals inside
the same 64-byte actor task lease. Shadowed names are distinguished by
lexical scope epoch; managed scalar reads decode from the actor arena
after await/cooperate. Foreign task/carrier access or a changed primitive
tag fails closed. An unlowered JVM `Slot.value` compatibility shadow still
exists and lexical scopes do not independently reclaim scalar slots.

A separate 48-byte `ActorGuestReturnRecord` ABI models callee index,
call-site/return program counters, operand depth, actor generation, owner
and execution number with generation-fenced actor quota and zeroizing
retirement. **The evaluator does not yet consume this descriptor.**
Actual non-tail guest calls still use recursive JVM frames, so it is
prohibited to claim stackless guest dispatch, return-PC lowering,
low-native-stack safety, independent process-stack isolation or full
five-backend parity from this ABI alone.

Evidence added to the manifest: six newly authored Java host/runtime
scalar lexical JUnit methods, four host/runtime call/return record JUnit
methods, and one **canonical .atto actor source JUnit/fixture** expecting
`before|42|second` from a mutable `let int` across two
`rt cooperate` suspensions with a second user mail queued. These
are **AUTHORED_NOT_EXECUTED** until actual admitted exact-head Java/Graal
CI produces nonzero executed steps and JUnit artifacts. Four pending
conformance cases bring the total to **33**. The contract's negative
mutation tests explicitly reject fake JVM-shadow removal, arbitrary
reference-root lowering, return-PC dispatch, full lexical scope reclaim,
native stack survival or guest PASS. All backend proof lanes remain
`NOT_EXECUTED`.
