# AttoLang two-peer actor failure and stack parity v1

**SOURCE_AUTHORED_ONLY / NOT_EXECUTED / NOT_CERTIFIED.** A proposed compiler/runtime acceptance target, not a current parser-validated or compiled guest program.

## Single canonical source

Source: fixtures/actor-two-peer-failure-v1/two-peer-failure-matrix.atto
Git blob SHA-1: 003983eb9475d7fd680ea5b31804df02f1843f19

This fixture intentionally defines two **data-plane** actor types: FaultWorker (fresh child incarnation per case) and one long-lived Witness (whose reply is 42 after every case). Root is a separate supervisor CONTROL authority, not a third ordinary data actor. Preserve the exact bytes for Java/GraalVM, LLVM and .NET; do not port the guest program into host Java/C++/C# and claim language parity.

| Mode | Path | Fault output | Required recovery | Supervisor |
| --- | --- | --- | --- | --- |
| 0 | throw caught by typed catch | 100 | catch once, on_throw zero | no CONTROL |
| 1 | unhandled throw | 101 | on_throw once, next message remains healthy | no CONTROL |
| 2 | raise with nearest lexical recover | 202 | recover once; catch/on_raise zero | no CONTROL |
| 3 | unhandled raise | 203 | on_raise once, next message remains healthy | no CONTROL |
| 4 | panic | none | no actor-local callback and no guest teardown | exactly one authenticated PANIC CONTROL |
| 5 | 100,000 non-tail calls | none | guest logical-frame budget before native stack overflow | exactly one stack-budget CONTROL |

For modes 0–3 the same recovered FaultWorker answers 7 to a NEW subsequent message; neither the failed instruction nor the old mail is replayed. Modes 4–5 physically retire it and invalidate stale send authority. The other actor answers 42 later, including after both terminal failures. This demonstrates observable noninterference; independent native allocation-domain identifiers, bounds, live-accounting, scrub/reclamation and stale-ref telemetry are still required to establish actual heap isolation.

There is **no actor-local on_panic**: only the supervisor's on_panic(Failure) sees actual panic through reserved authenticated CONTROL. For raise, nearest lexical recover takes precedence; actor on_raise is a once-only fallback if no such recover handled the failure. Uncaught throw can invoke on_throw once. Panics and stack-budget exhaustion cannot be caught or rewritten as an ordinary Error. Do not recover by catching JVM/CLR StackOverflow exceptions or a SIGSEGV on a shared carrier.

## Known blocking source ABI decisions

The fixture proposes but does NOT demonstrate support for FaultError construction, FailureDisposition.recover, defer recover, structured source loop, supervised child spawn, Root.control_events and count, actor termination authority, message-failure semantics, typed supervisor notices and compiler-generated stack frame accounting. It must **fail closed** until these contracts are actually implemented and tested; a parser rejection is a feature gap, not a guest test pass.

The source may require joint syntax revision before first compilation. Every revision changes the canonical blob and must be pinned anew in all three backend branches. No backend may silently substitute a simpler fixture for the six-case test.

Current related work: Java PRs #2505 (early call-depth guard) and #2713 (source actor-state guest test candidate); LLVM #1620 (actor-state guest candidate), plus native supervisor substrates; .NET #432 (opaque actor declaration AST), #430 (source scalar plan to host-owned frame seam), and #437/#439 (native actor memory candidates). None constitutes a compiled six-case actor-fault guest proof.

## Shortest exact-head acceptance sequence

1. Source integrity only: run node --test tests/actor-two-peer-failure-v1.test.mjs. This verifies manifest/blob consistency and that every backend remains NOT_EXECUTED. **It is not an actor compiler test.**
2. Verify identical Git blob for canonical source in each backend, exact source HEAD/tree and compiler artifact. Run parser and type checker. Unexpected admission, generic syntax errors, missing diagnostics and unhandled hooks are all failures, not successes.
3. Implement production typed actor handler IR, effect checking, authenticated parent CONTROL, fail-stop panic, lexical recovery, exactly-once hook dispositions, typed logical guest frames and pre-native bounded recursion.
4. Compile the SAME source on Java JVM and GraalVM Native Image; native LLVM O0/O2 (ASan/UBSan where suitable); and .NET Linux+Windows NativeAOT. Execute actual guest binaries with bounded timeouts, deliberately small machine stacks, reused carriers, heap-domain telemetry, repeated restart/retirement cycles and saturated DATA mailboxes.
5. Independently verify each PR HEAD/tree, fixture blob, actual checked-out SHA, runner/run/job ID with **nonempty executed steps**, compiler binary digest, guest/native artifact digest, stdout/exit, per-case authenticated runtime event ledger, supervisor notices, actor generation and cleanup.
6. Promote only with independent reviewed receipts for ALL three backends. A source-free test, a successful host simulation, a static parser, zero-step Actions or self-reported PASS is **NOT_CERTIFIED**. Keep draft work unmerged until gates pass.

## CI security

Private source must not be copied to a different organization merely to use spare Actions minutes. Obtain source-side authorization, approved destination, exact commit/tree binding and independent security review first. No source transfer is authorized by this contract.
