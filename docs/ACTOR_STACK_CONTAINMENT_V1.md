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

## M1.5: stable ExecutionContext and actor-bound Task roots (2026-11-07)

Java [draft #2626](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2626)
now connects the live actor source-Task scheduling path to a bounded logical
Task root in `ActorGuestStack`. The root is authenticated against the exact
actor-stack object and incarnation on resume. Ordinary non-actor tasks retain
their own allocation identity; producer callbacks only wake the actor scheduler.
The source Task's `ExecutionContext` survives `Await` and `Cooperate`, while
the root is charged until *physical quiescence*, not Future settlement.

This is a **logical identity/accounting milestone**, not evidence of separately
allocated actor-private frame storage. Its authored JUnit scenarios are
unexecuted on hosted CI because the Java source workflows report zero-step
runner-admission failures. The current Java test also does **not** prove
migration to a distinct physical carrier thread. Five backend records remain
`NOT_EXECUTED`; no field should be promoted from host-only tests.

The additional pending conformance cases require executable `.atto` source
for actor A await / B carrier reuse / A resume, producer callback rejection,
cancellation with delayed physical retirement, stale supervisor-generation
resumption, and leak/quarantine before heap reclaim. Receipts need exact source
head/tree, executed steps, compiled guest output, and an independently verified
actor-store ownership identity. These are mandatory for Java, LLVM, NativeAOT,
Wasm, and Forge/Cranelift.
