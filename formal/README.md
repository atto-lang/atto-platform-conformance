# Owned Worker request lifecycle — bounded TLA+ model

`OwnedWorkerRequests.tla` specifies the host-owned reservation, publication,
reply verification, completion, rejection/timeout, termination, generation
restart and stale-reply drop transitions.

The normal model checks **two tickets, two physical generations**, and both
request/reply and shutdown interleavings using TLC. The `Unsafe=TRUE`
configuration inserts an intentionally invalid transition where a guessed
response completes a reserved request **before publication**. TLC must produce
a counterexample to `CompletionRequiresPublication`; CI must fail if it does
not.

This finite-state check is not a refinement proof of the JS Worker code and
does not prove fairness, eventual termination, unbounded mailbox behavior,
LLVM compiler lowering, or physical STOP receipt correctness. Connect these
model actions to executable implementation trace probes before asserting
conformance.

Run from this directory with a pinned `tla2tools.jar`:

```sh
java -cp /path/to/tla2tools.jar tlc2.TLC -deadlock -config OwnedWorkerRequests.cfg OwnedWorkerRequests.tla
java -cp /path/to/tla2tools.jar tlc2.TLC -deadlock -config OwnedWorkerRequestsUnsafe.cfg OwnedWorkerRequests.tla
# Second invocation MUST exit nonzero and identify the pre-publication invariant.
```
