# Actor STOP / source-cleanup safety model

The bounded `ActorShutdown.tla` model covers one actor, up to two concurrent
host close callers, one suspended source finalizer, one native loan, a stale
Future completion and a cleanup deadline. It specifies the **target**
physical termination contract: a failed cleanup drain reports failure through
a separate shutdown outcome, never a completed physical-done ticket.

Run TLC against `ActorShutdown.cfg` and require no invariant violations.
Run it against `ActorShutdownUnsafe.cfg` and require the **specific**
`NoPrematurePhysicalDone` counterexample, not just an arbitrary error.

The unsafe action publishes physical completion while cleanup/loan/carrier
ownership remains live. The safe model excludes it.

**Important limits:** bounded model checking does not prove Java, Native Image
or LLVM refinement. The Java draft now distinguishes `get_shutdown_result()`
(failed-drain reporting) from `get_done()` (physical finalization). That new
revision still requires exact-source executed tests. The latest Java draft
now attempts to gate physical done on final native loan retirement, with a
nonblocking wakeup callback and failed-Arena-close observation; this is
**unverified** by funded JVM, Native Image or LLVM guest execution.

The additional `NativeReleaseWake.tla` model explores loan release before,
during or after actor memory retirement and the finalizer's pinned-byte
check. `NativeReleaseWakeUnsafe.cfg` must produce a specific
`NoLostWakeup` counterexample for an intentionally dropped callback.
These are bounded abstract models, not executable refinement proofs.

An uncooperative finalizer or FFM release failure is not guaranteed to
terminate. No unconditional liveness claim is made. This model is a release
gate, not a certificate for the production runtime implementation.
