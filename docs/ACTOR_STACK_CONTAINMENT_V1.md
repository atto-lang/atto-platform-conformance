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
