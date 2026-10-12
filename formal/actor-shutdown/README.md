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
or LLVM refinement; the current Java `get_done()` exceptional completion on
a failed drain is a known divergence from this stricter target contract.
An uncooperative finalizer is not guaranteed to terminate. No unconditional
liveness claim is made. Production enforcement needs tracked FFM loans and
explicit failed-drain observation. This model is a release gate, not a
certificate for the runtime implementation.
