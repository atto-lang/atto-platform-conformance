# REQUEST_ACTOR_TASK_CONTEXT_V1 — request-pinned logical context

Status: DRAFT portable semantics and bounded source-free host model, 2026-10-30.
This is not compiled guest execution or five-backend certification.

## Decision and four lifetimes

HTTP requests own a **logical request scope**, never an OS worker thread. A
generation-fenced RequestContextHandle travels in the HttpExchange and in the
Task/continuation record. Current-context lookup is constant-time slot +
generation validation. Do not use a process-wide lookup by trace ID, request
path, or untrusted client token.

- ThreadLocal/carrier-local: worker-local scheduler scratch and an ephemeral
  current-turn lookup hint only, removed on unwind, suspension or cancellation.
- ActorLocal: actor-incarnation-owned memory, including actor arenas and sealed
  mutable actor state; write access must use existing critical-write gates.
- TaskLocal: lexical/structured task bindings and cancellation/trace lineage,
  surviving continuation migration.
- RequestLocal: one HTTP request's immutable authenticated metadata, deadlines
  and resource leases until physical request/task cleanup is complete.

The request is lifetime-pinned to a slot, **not thread-pinned to a CPU**.
An actor serving 15 requests must never share mutable request-local state,
even though it shares its actor-owned heap among those requests.

## Proposed guest API (illustrative, not compiler-supported yet)

    define http actor Api as
      async on_request(HttpRequest req) -> HttpResponse {
        const ctx: RequestContext = req.context();
        const trace_id = ctx.trace_id();
        const user = ctx.principal();
        const result = await find_user(user.id());
        return HttpResponse.ok(result);
      }
    end

Prefer explicit req.context() over ambient lookup. An optional
RequestContext.current() -> Option<RequestContextView> returns None outside
a trusted admitted request turn. A context view is never permission to read
another actor's sealed mutable state; storing raw borrowed header/body views
across await is rejected. Immutable owned metadata may live in the suspended
task frame. ActorLocal<T> is actor-incarnation-owned and mutable only through
handle_state critical-read/critical-write. TaskLocal<T> uses lexical immutable
bindings with LIFO shadowing. Raw ThreadLocal<T> stays host/runtime-only in
strict actor and real-time profiles.

## Ingress and logical propagation

1. Reactor parses bounded request bytes and runtime-mints request identity.
   Validate traceparent input but do not trust any incoming header for tenant,
   principal, permissions or actor identity. Resolve authentication at a
   trusted boundary; use an absolute monotonic deadline.
2. Allocate a bounded request slot with nonzero, nonwrapping generation,
   immutable metadata, and physically accounted leases. Exhaustion returns
   an explicit overload/admission error, not another request's context.
3. Attach request slot and generation to the HttpExchange generation and exact
   actor scheduler domain/slot/incarnation. The current scheduler turn is
   authenticated *independently*. A copied handle or callback trace carries
   no guest execution authority.
4. On await/select, persist the handle in the owned continuation and remove
   the physical carrier hint. On resume, reauthenticate actor/exchange/task
   identity, then bind the same request handle on the newly admitted carrier.
5. Structured children retain physical leases. Response completion, timeout,
   cancellation or socket close revokes new access immediately, but cannot
   recycle storage while already-running child tasks, callbacks or borrows
   remain physically active. A late callback may release its pin, never
   resurrect a cancelled request.
6. When sending to another actor, propagate a bounded **sanitized immutable
   metadata snapshot** (trace correlation), never a resource owner token,
   ambient permissions, pointer, mutable hash map, or producer TLS address.
   The receiver establishes independent actor/task authority.
7. Detached tasks do not implicitly inherit request resource authority;
   guest code must explicitly transfer an allowed owned, sanitized snapshot.

## Security requirements

- Fail closed on stale request slot generations, actor restart/incarnation,
  wrong runtime domain, tenant confusion, duplicate live request IDs,
  detached callback forgery, stale TLS hints and double release.
- A carrier hint is never permission: only the scheduler's currently
  authenticated active turn authorizes any actor/heap/permission access.
- Never run guest code directly on an HTTP reactor or foreign completion
  thread. Host callback provenance is tracing data only.
- Hard-real-time profiles use preallocated bounded tables and nonparking
  admission; do not embed dynamic unbounded maps or network auth calls in
  hard-RT turns.
- Distinguish 3–15 concurrently scheduled requests across carriers from
  actor-wide simultaneous DATA turns: the existing serial actor remains
  single-writer unless explicit multi-turn borrow/safety rules are proven.
- Request identifiers and trace IDs are correlation, not authentication
  secrets. Avoid retaining raw headers, request body, or credentials in
  ambient logging context.

## Source-free executable model and boundaries

src/request-actor-task-context-v1.mjs models generation-fenced slots,
LIFO carrier hints, actor incarnation checks, immutable metadata,
pin-before-use, close-before-recycle and physical child lifetime leases.
tests/request-actor-task-context-v1.test.mjs includes 3/8/15 simulated
concurrently bound carriers, migration between carrier identities, nested
restoration on exception, stale owner/generation, request collision,
bounded exhaustion, late child release and malformed input.

The model's trusted-admitted boolean is a host **assumption**, not
cryptographic authority. Simulated carrier interleavings are not OS threads,
and a passing Node test proves no real compiler/runtime implementation.

## Native backend gates

1. Compile identical Oreslang HTTP actor/Task guest fixtures with each backend.
   Unsupported compiler surfaces must fail closed before execution.
2. Exercise independently authenticated request identities through a reusable
   actor, 3/8/15 physical carriers and suspended/resumed Task continuations.
3. Check pre/post-await/select/callback context equality and zero TLS bleed,
   including concurrent requests on the same actor, cancellation and hot reload.
4. Prove wrong tenant, request slot, exchange/actor generation, detached task
   and stale callback cannot acquire authority.
5. Integrate Java HTTP exchange/trace work and LLVM NativeExecutionContext +
   RequestSlotTable instead of inventing a second physical ownership subsystem.
6. Pin exact source/compiler/tree blobs and run/job/step metadata; require
   nonzero executed steps, raw authenticated guest receipts, sanitizer and
   deadline/latency evidence. No zero-step CI or source-free check is a PASS.

Related drafts: Java #2240 (HTTP dispatch attestation), #529 (pooled-actor
request lifetime), #2315/#2321 (callback trace authority); LLVM #1019
(exchange incarnation fencing), #1202 (callback provenance). This extends
docs/EXECUTION_CONTEXT_QUANTUM_V1.md and the callback conformance work (#245).

Research and industry design references:
- Swift TaskLocal: https://developer.apple.com/documentation/swift/tasklocal
- Kotlin CoroutineContext: https://kotlinlang.org/docs/coroutine-context-and-dispatchers.html
- Java 25 ScopedValue: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html
- Orleans RequestContext: https://learn.microsoft.com/en-us/dotnet/orleans/grains/request-context


## Addendum: exact DATA-envelope identity and physical pin fencing (2026-10-30)

Actor incarnation authorization is **necessary but insufficient** when multiple
HTTP requests share a reusable actor. A trusted ingress/dispatch bridge MUST
assign a nonzero, nonwrapping, runtime-minted per-request DATA dispatch ticket,
bind it to the exchange generation, request registry domain/slot generation,
and actor domain/slot/incarnation, and submit that ticket as the *actual* actor
scheduler mailbox payload. The context lookup implementation MUST compare
that ticket against the scheduler's current authenticated DATA callback.
A caller that merely knows a second request's handle or exchange token must
not select that request from another DATA callback in the same actor.

A DATA callback with the wrong envelope, a CONTROL/wake/panic callback,
a producer/foreign thread, and a retired actor all have **no request context**.
A suspended request may resume only on a fresh, authenticated owning
scheduler turn, using its own durable continuation lease, and the same
request's dispatch identity until a dedicated per-continuation resume ticket
is available. A terminal continuation is one-shot: a second resume rejects
even if the message ticket is repeated. Detached tasks and HTTP headers
must not mint dispatch tickets.

The physical exchange pin must prohibit exchange reuse *even after* the
exchange has returned to the reactor phase, until its exact-generation
context/body pin has retired. Request metadata and transport buffers must
not recycle until all active actor turns, source Task descendants, I/O
callbacks, and read loans have physically exited or released leases.

LLVM draft #1210 implements a host-only current-DATA-payload check and
a pinned native exchange/RequestSlotTable reference; its native CTest
proposes two queued requests on one serial actor, wrong ticket/replay
rejection, cancellation, same-actor cross-buffer checks, and 3/8/15
carrier regressions. **No source-level HTTP actor dispatch or native
exact-head CTest PASS is claimed by this addendum.** Native scheduler
message payload identity is host-private and is not a guest authorization
token. Compiled source must be unable to call the scheduler's host-only
send/turn-control functions directly.

The Java/GraalVM, LLVM, Wasm, .NET Native AOT and Forge parity gates must
require the same wrong-envelope and one-shot-continuation fixtures,
not only matching trace_id across await. For true hard real-time use, the
host's current mutex-based substrate requires separate WCET/priority
inversion and allocation evidence.


## Addendum: initial DATA claim, replay, and abandoned admission (2026-10-30)

A request-bearing HTTP exchange MUST NOT transition from QUEUED to ACTOR
on the ingress/reactor thread. The transition may be claimed only by the
authentic scheduler DATA callback whose actual delivered payload matches
the exchange's nonwrapping dispatch ticket and whose actor identity
matches the complete scheduler-domain/slot/incarnation tuple. Host APIs
that provide a legacy owner-only claim MUST reject request-bearing
tokens, including forged tokens with the correct actor tuple.

An authenticated initial request delivery is consumable ONCE per
exchange generation. Repeating the same DATA message later is replay,
not a new handler invocation. An actual suspended continuation may
execute on a subsequent scheduler turn only via a separately
registry-constructed, one-shot continuation lease and exact matching
request identity. A continuation may be declined or canceled, but it
must never become a second initial handler invocation.

Trusted ingress admission first binds and physically pins context +
request body, then submits the exchange's exact ticket to the actor
scheduler. A rejected admission must roll back QUEUED->REACTOR
before the producer releases physical pins and closes the request/body
slots. This includes MAILBOX_FULL and TERMINATED refusals.

An accepted but abandoned queued DATA message (e.g., actor stop)
must be distinguished from a completed callback and a rejected send.
The host may roll back this exchange only after the scheduler attests
the relevant actor's terminal, physically drained state; then context
and buffer handles may be closed and their pins released. No claimed
handler execution is inferred from an accepted mailbox receipt.

The LLVM host-only draft adds corresponding regressions for claim from
reactor, spoofed DATA payload, repeated initial dispatch, two different
queued requests within one serial actor, wrong borrowed body, full
mailbox, terminated actor and accepted-but-abandoned drain. These are
source tests awaiting exact-head CTest execution, not backend
conformance certification. Runtime-priority ceilings and quiescence
checks remain separately required for deterministic real-time use.

## Addendum: cancellation-after-acceptance and two-phase physical drainage

An HTTP DATA message with a successful mailbox ACCEPTED receipt is not
guaranteed to run guest code. The request may be cancelled after mailbox
admission but before its scheduled turn. The runtime must still consume or
abandon the exact mailbox ticket, reject guest context/body lookup, and
eventually complete or terminally roll back the exchange without leaking
physical context/buffer pins.

Request-owned memory remains physically pinned by each independently active
source Task/continuation and asynchronous I/O completion. Closing the request
revokes new lookups immediately but must NOT free the slot while any lease
remains. In the adversarial fixture, hold two physical leases, cancel,
release the child Task lease first (slot still unavailable), then release
the I/O callback lease (slot becomes reusable with a new generation).
This test must use real physical thread/worker cleanup on native backends,
not merely logical Task completion or scheduler queue drainage.

LLVM draft #1210 now contains host-only source tests for these conditions.
Those committed tests have not been executed successfully at exact head.
Actual source Task lowering, I/O callback ownership and hard-real-time
latency proofs remain independent, mandatory promotion gates.


## Addendum: one-time mailbox admission reservation (2026-10-30)

An exchange generation is eligible for at most ONE initial DATA-mailbox
submission, even when two trusted ingress threads race with the same
BoundExchange. The initial producer must claim a generation-scoped atomic
admission reservation before invoking the scheduler try-send operation.

A losing duplicate producer returns an admission error and MUST NOT
roll back, close, replace, or otherwise invalidate the winning producer's
exchange or context/body pins. A winning producer whose scheduler
admission is rejected rolls back its own queued exchange exactly once.
The reservation remains consumed for that generation, even on rejection.

Reusing the same physical exchange after terminal completion, reactor
reclamation and physical pin release increments its generation and allows
one fresh submission with a newly minted dispatch identity. Stale DATA
tickets cannot claim the new generation. A raw mailbox send that bypasses
the reserved submission bridge is never authorization to claim a
request-bearing exchange or access request metadata.

LLVM draft PR #1210 now contains host-only implementation and regression
sources for concurrent duplicate submission, raw-ticket bypass and
generation reuse, plus a focused source-org GCC/Clang/ASan+UBSan workflow.
The workflow has failed before runner assignment: no exact-head pass or
real five-backend parity claim is supported yet.


## Addendum: last-lease fence before exchange reuse (2026-10-30)

Closing a request revokes new access but does not make an HTTP exchange
eligible for a new request. After terminal completion or a rejected/
abandoned admission returns the exchange to REACTOR, the original
exchange owner may retire its generation only when the request is in
CLOSING state and its own exchange lease is the **sole remaining**
physical request-context lease. All independently retained child Task,
continuation and asynchronous I/O leases must have been relinquished
by their physical owners. A logical done flag, message dequeue, or
closed handle is not sufficient.

The host must release the last request-context lease **before**
clearing the exchange's generation reuse pin, so a new ingress
cannot race with the old owner's context lease destructor. The
retirement predicate must be checked against the exact slot generation
under the registry's synchronization mechanism. In a fail-closed
runtime, attempting to destroy a pinned exchange before physical
quiescence is a fatal lifecycle violation, not silent recycling.

Required adversarial execution fixture: two real concurrent workers
retain child and I/O leases; close the request and roll back the
unsubmitted exchange; after child completion, reuse is still denied;
after I/O completion the exchange owner alone remains, so final owner
release makes the slot and exchange reusable under a NEW generation.
Assert stale handle and ticket denial. LLVM draft #1210 now contains
the host-only gate and source regression. This is **not** evidence of
compiled Oreslang Task/I/O lowering or a successful exact-head
native/sanitizer test. No hard real-time latency claim is implied.

## Addendum: native Task and I/O physical ownership bridge (2026-10-30)

A source Task's request-context lease MUST be acquired while its exact
structured parent, cancellation state and retirement state are validated
under one Task-graph admission boundary. A child from an unrelated parent
or an already-cancelled/retired Task must not acquire a request physical
lease. Checking the parent first and retaining the request in a separate
unsynchronized operation is insufficient because adoption/cancellation
could race between those operations.

A Task's lease must remain held through physically completed execution
and rejection of retirement while structured descendants are still live.
Cancellation is logical revocation and is NOT physical Task exit. A
TaskCancellation retirement acknowledgement releases this lease only
when the trusted owner certifies that the worker has exited all source
code and no structured descendants remain.

For asynchronous I/O, the lease belongs to the exact already-minted
operation ticket (actor/operation generation). Cancellation, timeout or
success is only *terminal arbitration*. The request physical lease may
retire only after: the broker can no longer access request memory or
call back; broker quiescence is acknowledged; the scheduler-owned
continuation/cleanup turn has finished; all read/write loans have
been returned; and the operation's retirement gate succeeds. A wrong
ticket or foreign actor request authority fails closed.

LLVM draft PR #1210 now contains a host-only bridge
NativeRequestPhysicalWork.hpp, parent-checked TaskCancellation admission,
and physical-work regressions using actual TaskCancellation and
PinnedContinuationGate objects. The focused native CI workflow also
includes their independent test targets. This is NOT native source
Task/await lowering, proof of external broker teardown wiring, evidence
of an exact-head executable pass, or a hard real-time WCET guarantee.
Backends must not claim guest parity until the compiler invokes these
gates on actual Task creation, suspension, callback, cancellation,
physical completion and memory-reclamation paths.

## Addendum: atomic I/O request-bind vs retirement race (2026-10-30)

A physical request lease must not be attached to an asynchronous I/O
operation that has already retired, nor may that operation retire while
the request lease is being attached. A read of the I/O terminal flag
followed by an unrelated request-registry retain is insufficient.

The existing operation's exact actor/generation/operation identity must
authorize one atomic four-state handoff:

- UNBOUND: no request registration exists; ordinary physical retirement
  may atomically seal this state only after broker quiescence, all loans
  released, and scheduler cleanup turn finished.
- RESERVED: one producer owns exclusive, unpublished registration while
  pinning the request context. A failed registry lookup or terminal state
  change may revert this state to UNBOUND. Ordinary retirement must fail.
- PUBLISHED: a retained request-context lease is owned by the I/O frame.
  Publication is irreversible: an admission-abort path must not discard
  a published lease or permit duplicate registration. Ordinary retirement
  must fail; only the bound request owner may retire after the full I/O
  physical-quiescence proof.
- RETIRED: neither reservation, publication, unbinding, nor any second
  retirement may succeed.

The UNBOUND-to-RESERVED and UNBOUND-to-RETIRED CAS operations share the
same atomic word. Reservation is then committed to PUBLISHED only after
request-registry pin acquisition; on completion, the owner performs
PUBLISHED-to-RETIRED before dropping the physical request lease.
Cancellation alone never implies broker quiescence. All transitions
must reject wrong operation generations and duplicate request owners.

Required test: race two threads registering a request vs cancellation,
broker quiescence and final retirement; if registration wins, ordinary
retirement is denied and bound-owner retirement must succeed; if terminal
retirement wins, binding must fail; both terminal outcomes prohibit later
binding, double retirement and aborting a PUBLISHED request. Run the
same cases under sanitizer instrumentation.

LLVM PR #1210 contains host-only source for these transitions and
regressions; **no exact-head native compiler, CTest or sanitizer PASS
has been demonstrated** while source-org workflow jobs fail before
runner assignment. Compiler source-Task and native NIO callback wiring
remain required before Oreslang language parity or hard-real-time
guarantees may be claimed.
