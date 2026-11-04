# MAILBOX_LINEARIZABILITY_V1 — candidate portable actor DATA mailbox contract

**Status:** DRAFT; source-free reference only (2026-10-30). This is not executable native parity.

## Scope

Provide a bounded linearizability test for a single actor incarnation's **DATA** mailbox, alongside (not replacing) the existing supervisor CONTROL-priority/epoch-fencing model, source Task physical-lifetime trace checks, and actor-state isolation rules. This model does not prove scheduler liveness, physical quiescence, shutdown correctness, hard-real-time WCET, or freedom from data races.

Literature motivating this work includes *The Complexity of Testing Message-Passing Concurrency* (2026, DOI 10.1145/3776643), recent Kotlin coroutine race and fair-abortable synchronization studies, and *Speak Now: Safe Actor Programming with Multiparty Session Types* (2026, DOI 10.1145/3798267). The rules below are **candidate Oreslang design decisions**, not claims that those papers verify Oreslang.

## Atomic operation projection

One mailbox has queue capacity 1–4; accepted messages carry unique logical tickets. A receive moves a FIFO queued message to **in-flight**; it must remain accountable until settlement. Both queued occupancy and in-flight work are tracked, but queue capacity counts only queued messages. All results are internal conformance trace vocabulary, **not new source keywords**.

| Operation | Possible response | Atomic effect |
| --- | --- | --- |
| send(ticket) | ACCEPTED, FULL, CLOSED | Reserve one queued DATA slot or reject before admission |
| receive() | MESSAGE:ticket, EMPTY, CLOSED | **Nonblocking try-receive** from the FIFO head into in-flight |
| cancel(ticket) | CANCELLED, ALREADY_CANCELLED, TOO_LATE, UNKNOWN | Withdraw only queued DATA; cancellation cannot silently erase in-flight work |
| settle(ticket) | SETTLED, INVALID | Complete one in-flight delivery at most once |
| close() | CLOSED, ALREADY_CLOSED | Fence admissions; settle queued deliveries as cancelled; keep in-flight leases outstanding |
| probe() | IDLE_OPEN, BUSY, MAILBOX_DRAINED | Snapshot this mailbox only, not an actor or Task completion signal |

An admission rejection is not an accepted-and-cancelled message. Public Oreslang send still returns Result. The probe is **never** equivalent to Task.get_done() or permission to destroy an actor arena. Suspended readch, await and select must have separate suspension/resumption tracing; they must never be recorded as eager EMPTY returns. Cancel here means a successful pending queue withdrawal; it is not general structured Task cancellation.

A new actor generation/epoch, supervisor CONTROL lane, physical Task descendants, arena loans/FFI pins, and actor panic escalation remain independently verified requirements in their existing shared contracts.

## History format

Source-free oracle input contains schema, capacity and 1–10 completed operation records. Each record has a unique operation id, operation, result, **unique ordinal invocation and response positions**, plus a ticket for send/cancel/settle.

    {
      "schema": "oreslang.mailbox_linearizability.v1",
      "capacity": 1,
      "events": [
        {"id":"send1","op":"send","ticket":"t1","invoke":1,"complete":4,"result":"ACCEPTED"},
        {"id":"close1","op":"close","invoke":2,"complete":3,"result":"CLOSED"}
      ]
    }

Invocation/response positions must be truly comparable event ordinals from a single actual trace capture, **not independent host wall clocks**. When operation A completes before B invokes, any witness must place A before B. Overlap allows either order if legal. Each operation in the projected history must be complete, and ticket IDs cannot repeat among send calls. The implementation uses exhaustive finite backtracking with memoization and a bounded search budget.

- **LINEARIZABLE:** a sequential witness exists for this bounded reference projection only.
- **NOT_LINEARIZABLE:** exhaustive bounded search found no witness.
- **INCONCLUSIVE:** search budget exceeded; do not claim success or implementation failure.
- **INVALID_MAILBOX_HISTORY:** malformed or injected fields, duplicate identifiers, noncanonical time positions, or out-of-range bounds.

Every returned verdict explicitly reports compiledGuestExecuted=false and nativeParityCertified=false. A synthetic witness, host simulation or shape-only CI receipt **cannot** upgrade these fields.

## Executable regression scope

From the repository root under Node.js 22+, run:

    node --test tests/mailbox-linearizability-v1.test.mjs
    node --test

The focused suite checks overflowing concurrent sends, FIFO delivery, close-vs-send, close-vs-receive, queued cancellation vs delivery, in-flight settlement after close, duplicate success prevention, invalid histories, and INCONCLUSIVE budget status. It additionally generates and checks 1,099 distinct short **sequential** reference histories. These are model tests, not Oreslang guest tests.

## Next five-backend evidence gates

1. For **Java/GraalVM, LLVM, Wasm, .NET Native AOT and Forge**, instrument actual compiled .ores guest sends, nonblocking try-receives, queued-ticket cancellations, delivery settlements and closes; record actor ID, incarnation, case ID, operation ID, ticket and bounded invocation/response ordinals. Do **not** capture raw message payloads, private source contents, pointers or credentials.
2. Provide an independently reviewed backend trace adapter matching actual Result and suspension semantics to this internal vocabulary. Fail closed on unsupported guest operations. Do not silently substitute hand-authored Java/C#/C++/JS host code for Oreslang compilation.
3. Verify overlapping send/close and cancel/receive, duplicate settle and false drain, then separately verify CONTROL priority under saturated DATA, epoch restart/stale deliveries, cancellation during suspension, physical task quiescence, and actor arena reclamation.
4. Pin the exact source Git tree and commit, fixture Git blob, backend compiler binary identity, execution mode, run/job/step metadata with **nonzero executed steps**, and independently authenticated native logs/results. Preserve PASS vs EXPECTED_REJECT vs UNSUPPORTED vs NOT_EXECUTED without promoting a source-free model or zero-step CI.
5. No private-source mirror to an alternate organization unless the destination is explicitly authorized and independently approved under the existing private-CI controls. Use native runners if available; a source-free carrier may validate the checker but cannot establish native guest parity.

**Current certification:** all five backends are NOT_EXECUTED for this new contract. This draft proposes new semantic obligations; it does not modify or certify the implementations.
