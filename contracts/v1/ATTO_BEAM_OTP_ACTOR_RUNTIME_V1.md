# ATTO_BEAM_OTP_ACTOR_RUNTIME_V1

Status: **proposed, source-free reference model only**. No compiled guest, native scheduling or five-backend parity is established by these tests.

## Compatibility

This contract covers six areas: (1) reduction/time-budget scheduling; (2) typed actor state machines; (3) priority supervisor CONTROL and bounded selective-receive DATA; (4) per-actor ownership, arena and isolated logical stack; (5) local vs remote transport; (6) binary packet processing.

Keep AttoLang actor-first and .atto guest fixtures. Preserve sealed actor state, critical-read and critical-write, mailbox-first messaging, exclusive logical state mutation, uncatchable panic CONTROL delivered to supervisor, per-actor arenas and isolated stacks. JS oracle names are not new source language APIs. The existing MAILBOX_LINEARIZABILITY_V1 and actor-memory contracts remain independently mandatory.

## Scheduling

- Reductions count bounded guest work, not WCET or physical interruption. A budgeted model of already-resumable continuations is not real preemptive scheduling.
- Work-stealing/migration requires incarnation fencing and exclusive logical actor admission. Only optimizer-preserved, executable, verified yield-safe boundaries may release a carrier.
- No mutable state loan, held critical lock or unpinned FFI memory may cross an implicit suspension. Cancellation/panic cleanup must happen exactly once. Unbounded native FFI must be isolated or rejected from strict profiles.
- Actual fairness requires an unbounded compiled guest loop to be suspended/resumed while another actor progresses. Hard-real-time additionally requires WCET and target-specific OS, hardware, memory, and priority-inversion evidence.

## Typed state machines

Use finite deterministic state/event transition tables. Invalid or ambiguous transitions do not mutate state. All state events (including timer and cancellation events) must present the originating actor epoch: stale/future epochs return STALE_EPOCH without mutation, and a closed actor returns CLOSED. Restart must not permit events from earlier incarnations to affect the new actor. A new incarnation defaults to the actor's declared initial state rather than retaining mutable state from the retired generation; an explicit override must reference a declared valid state. Postponed event delivery and timers are future requirements, **not implemented by this oracle**. All actual guest state mutation still obeys the sealed critical gate.

## Mailboxes

- Bounded DATA admission and explicit FULL/CLOSED/STALE_EPOCH results. **Credits count queued plus dispatched-but-unsettled receipts, separately in DATA and CONTROL lanes; dequeue does not refund capacity.** Do not silently drop or turn failed admission into a successful acknowledgement. The source-free model now checks in-flight escrow saturation and only refunds a credit on settlement (or explicit close of queued DATA).
- Selective receive takes the earliest matching DATA ticket while leaving skipped DATA tickets available. Blocking receive must park the logical task rather than spin on EMPTY.
- Supervisor CONTROL takes dispatch priority independent of guest DATA selection. The source-free oracle now separates guest-style DATA dispatch from trusted CONTROL dispatch. While CONTROL is queued or unacknowledged, DATA dispatch returns CONTROL_PENDING; a matching DATA tag cannot consume a supervisor notice. The guest cannot consume or suppress its panic CONTROL. Runtime CONTROL dispatch must be capability-restricted by each backend; the source-free JavaScript model does not authenticate that caller. CONTROL overflow is an explicit failure, not successful delivery; runtime escalation must be independently designed and proven.
- Close withdraws queued DATA but preserves queued/in-flight CONTROL until supervisor settlement. Inflight DATA remains accountable after close. No double settlement. If multiple CONTROL notices exist, the model handles them one at a time in FIFO order and returns CONTROL_INFLIGHT until the previous notice is settled. Restart must fence old epochs and additionally require actual physical quiescence.
- Oracle dispatch represents trusted runtime selection, **not** a public guest-callable operation.

## Ownership and binary

Local actor ownership moves invalidate sender access and require no outstanding borrowed/pinned references. Raw arena pointers may not cross remote nodes: remote transport requires Serializable and a defined wire representation. No resource can be reclaimed until physical quiescence; a host-side ledger does not prove zero-GC native memory.

The reference packet is big-endian version u8=1, length u16, followed by exactly that many bytes. The returned payload aliases the input buffer. Native zero-copy additionally needs compiler, bounds, lifetime and pinning evidence; cross-host network transport is not zero-copy.

## Executable source-free checks

From the conformance repository root:

    node --test tests/actor-execution-oracle-v1.test.mjs
    node --test

The reference tests verify bounded round-robin continuation slices, CONTROL priority and delivery fencing, selective DATA receive order, DATA-tag spoofing isolation, capacity/backpressure, stale epochs, state machine transitions, borrows and ownership moves, remote serialization requirements, lifecycle fencing, and exact binary frame lengths.

The oracle always labels simulated scheduling as compiledGuestExecuted=false and nativePreemptionProven=false; the binary view is marked nativeZeroCopyProven=false. Restart and reclamation return MODEL_ONLY classifications.

## Five-backend release gates

For Java/GraalVM, LLVM, Wasm, .NET Native AOT, and Forge:

1. Compile real .atto pass/fail fixtures, pin fixture blob hashes, and reject control interception, state-loan-across-await, and raw remote pointers.
2. Demonstrate that compiled runaway code gives way to a runnable peer with actual carrier release and continuation resumption; unsupported targets must report UNSUPPORTED, never a synthesized PASS.
3. Exercise DATA/CONTROL capacity and overflow, supervisor panic under saturation and shutdown, selective receive preservation, stale generations, and in-flight settlement.
4. Verify actor reclamation after all physical task dispatches, FFI pins, loans and children retire, with sanitizer evidence where possible. Prove zero GC only on the target/profile that actually meets it.
5. Show native compiled binary pattern matching, wire interoperability, ownership fencing, endian correctness, malformed lengths and safe zero-copy views.
6. Pin source tree SHA, compiler executable hash, fixture blobs, run/job/step identities, real nonzero executed steps, exit codes, guest traces and sanitizer results. Model or host simulations cannot authenticate guest parity.
7. If source CI lacks minutes, only use an explicitly authorized private carrier; verify each blob and the complete mirrored tree. No cross-org checkout secrets or unauthorized private source exposure.

**Current V1 certification:** source-free reference only; all five compiled backends NOT_EXECUTED for this slice.
