# Supervisor host-effect runtime boundary: executed evidence

Status: **draft contract**, not a production-ready supervisor implementation.
This document complements the TLA+ supervision models, the schema-v2
`bin/verify-supervisor-trace.mjs` oracle, and the registry journal v1.
It is not a machine-checked proof that either compiler/runtime refines TLA+.

## One-shot source STOP host invocation

In the Java/GraalVM source STOP compiler's synchronous and awaiting paths, the
trusted ActorGroup now claims an exact `StopReservation` immediately before
entering the host lifecycle callback. The in-registry claim is keyed to the
one-use STOP nonce and original CONTROL turn. Duplicate, mismatched, stale and
post-UNCERTAIN invocation claims fail closed, without retrying the host effect.

The restricted native `install_source_supervisor_stop_verified` path calls
`claim_host_stop_invocation` at the equivalent real supervisor CONTROL boundary.
A native `StopReceipt.host_invoked` flag is set atomically under the registry
mutex, and the journal emits `stop.invoke-asserted`. This proves the trusted
call site claimed one entry; it does NOT prove the external host operation
completed or was durably applied. On a thrown sink outcome, the receipt remains
UNCERTAIN and RESTART is denied.

## Executed native end-to-end scenarios

**Funded source mirror**:
https://github.com/3fa-app-test/account-recovery-security/actions/runs/38192678679

The allocated Actions runner independently verified 22 exact Git blobs from
the Java, native, and conformance sources before building. The job passed:

- Actual Java 25 child registry: **21/21 original JUnit tests**, plus the
  isolated journal smoke check. Java's complete compiler/runtime was NOT
  mirrored or tested; the isolated scaffold substitutes only ActorRuntime IDs.
- Actual native child registry C++ test under GCC ASan and UBSan.
- Native **restricted source STOP**: compile the real Parser.cpp and
  OwnershipChecker.cpp; execute the real C actor scheduler, typed terminal
  PANIC callback, NativeSupervisorPanicBridge and SupervisorProcess; enter
  the compiled STOP host callback exactly once for both success and unknown
  outcome, with physical child DONE already observed by the scheduler.
- Native **admitted, unpublished RESTART interrupted by shutdown**: a real
  scheduler-issued replacement exists, is staged and admitted, but CONTROL
  closes before publication. Mail admission remains blocked. Aborting a live
  replacement is rejected; physical STOP and wait_done precede
  cleanup-verified and abort. An exact physical ActorRef is preserved in
  the abort journal. No `restart.commit` is recorded.
- The shared registry journal comparator passed **7/7** self-tests and
  accepted both runtime-emitted 11-action registry parity markers.

Recorded markers in funded CI:

```text
NATIVE_SUPERVISOR_STOP_OBSERVED_V1=successful reserved=1 invoked=1 uncertain=0 acknowledged=1
NATIVE_SUPERVISOR_STOP_OBSERVED_V1=uncertain reserved=1 invoked=1 uncertain=1 acknowledged=0
NATIVE_SUPERVISOR_RESTART_SHUTDOWN_E2E_PASS admitted=1 closed=1 cleaned=1 aborted=1 committed=0
SUPERVISOR_REGISTRY_PARITY_PASS {"ok":true,"scope":"trusted-host-registry-only","steps":11}
```

The audit found that the native scheduler's `poll_published()` API was
absent from the host header; declaring it, then matching the exact updated
`NativeActorScheduler.c` source blob, allowed the replacement publication
assertions to link and execute.

## Remaining refinement and release gates

1. The Java compiled-source sync and async STOP paths must run as part of the
   complete exact-head Maven/JDK25 + GraalVM Native Image suite, without an
   isolated ActorRuntime identity scaffold.
2. Independent host evidence must bind STOP effect identity, nonce, actor
   generation, and CONTROL turn. A Boolean callback or merely entering the
   host function is insufficient to prove external effect application.
3. The schema-v2 trace collector must merge independently observed scheduler
   and host events with registry-committed transitions, audit for missing
   events, and run the complete verifier on **real** Java and LLVM histories.
4. Bound shutdown/publication races in the complete execution contexts and
   run higher-volume concurrency/fault-injection tests. Model-level TLC
   invariants and synthetic comparator success remain separate evidence.
5. General typed guest `on_panic`, RESTART and ESCALATE lowering remains
   intentionally gated. The native source STOP fixture is a restricted
   compiled hook, not proof of general Oreslang supervisor execution.

Keep Java #657, LLVM #196, and conformance #13 **draft and unmerged**
until these source-level and implementation-refinement gates are satisfied.
