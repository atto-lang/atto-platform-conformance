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

## Addendum: full actor-incarnation binding for request-owned I/O (2026-10-30)

An asynchronous operation's ordinary ticket (actor ID, operation generation,
operation ID) is NOT sufficient to authorize borrowing an HTTP request's
physical lease if it does not also establish the complete owning actor
incarnation. The host creates a trusted request-specific operation binding
with scheduler domain, actor slot, and actor generation, immutable for that
I/O gate's lifetime. Request physical lease admission checks all three
against the request context's trusted owner BEFORE reserving the operation
or retaining any request storage.

An I/O gate constructed only with the legacy operation ticket is still
usable for unrelated host I/O, but MUST NOT grant request-context lease
authority. Reject cross-actor requests even when domain and generation
match but actor slots differ, and reject restarted incarnations in the
same slot. A wrong full owner must leave the I/O binding state UNBOUND
and must not affect a request owned by another actor.

LLVM draft PR #1210 now stages this host-side full-owner binding and native
negative tests. Exact-head executable GCC/Clang/sanitizer verification and
actual NIO registration/callback integration remain separate mandatory gates.

## Addendum: transactional request-owned NIO watch admission (2026-10-30)

Attaching a physical request lease to an I/O operation is not the same
as successfully registering that operation with its physical broker.
The host must first reserve the exact I/O operation generation and retain
its request-context lease, then perform the actual nonparking watch
registration (or equivalent broker admission). Only a genuinely accepted
watch is eligible to PUBLISH the lease irreversibly. A rejected watch
must leave no broker with access to the request, revert its unpublished
reservation and release the temporary context lease.

The reservation prevents any ordinary operation retirement while watch
admission is in progress. A completion that occurs synchronously within
the successful registration call may settle the gate before publication;
the host MUST still publish the accepted request lease and then require
broker acknowledgment, scheduler-owned cleanup completion, and zero
outstanding loans before retirement. It must not invoke guest code inline
with the registering producer.

A host registration callback may return false only when physical watch
admission genuinely failed and the broker cannot touch any request memory.
It must not throw after a watch has been accepted, since rejection
cleanup cannot safely revoke an already-published kernel registration.
The native VM/NIO implementation must satisfy that postcondition and
bind the returned backend watch identity to the exact operation ticket.
A successful cancellation request alone is NOT broker-quiescence proof.

LLVM draft PR #1210 stages a host callback-based transactional
registration bridge and negative tests for rejected/throwing admission
and synchronous terminal settlement during watch setup. Source-level
NIO registration and compiled guest `await` remain unverified, and the
test source is not equivalent to an executed exact-head pass.

## Addendum: exact native VM/NIO watch identity and completion admission

A successful physical NIO watch registration must return an immutable
backend watch identity. The host keeps that watch (ticket and reactor) and
its associated descriptor together with the exact request-owned I/O
operation and physical request-context lease. An event for another watch
ticket, reactor, descriptor, operation or actor incarnation cannot settle
the request's continuation or authorize memory reclamation.

The trusted NIO registration path must use the transactional request-lease
reservation protocol: reserve, pin request, call the native watch-admission
API, and only PUBLISH the lease on a genuinely successful watch admission.
A rejected watch must roll back its unpublished reservation and release
its temporary pin, without inventing a broker completion. Host registration
callbacks must not throw; an exception after watch acceptance cannot
safely be mistaken for rejection.

After consuming a matching terminal watch record, the owning operation
may atomically settle its terminal result. READY, CANCELLED and STOPPED
map to success, cancellation and closed respectively. This result is
NOT proof that the broker can no longer touch its buffers. A separate
physical broker-quiescence acknowledgment plus scheduler-owned cleanup,
zero active loans and terminal operation retirement are still required
before releasing the request lease. Duplicate or mismatched completion
records must not settle another operation.

LLVM PR #1210 now stages NativeRequestNioWatch.hpp against the actual
NativeOresVMNio C ABI and a focused source-free stub-broker test.
The ABI stub does NOT run epoll, an authentic VM, a compiled Oreslang
HTTP actor, or physical callback/Task quiescence; exact-head CI execution
and full backend conformance remain pending.

## Addendum: real Linux VM + epoll physical-broker shutdown fixture

LLVM's host-only integration suite now additionally stages
`native_request_nio_epoll_integration_test.cpp`, which links the real
NativeOresVM (C), actor scheduler and future runtime (C), and real
NativeOresVMNio/NativeEpollReactorABI (C++) in a single native executable.
The test opens a native VM, enables a lazily started Linux epoll reactor,
spawns an actual native actor, binds an exact request-context exchange and
registered watch to that actor generation, and exercises two paths:
readiness on a nonblocking Linux pipe and explicit cancellation of a
different nonblocking watch.

The test requires the exact watch ticket, reactor and FD on terminal
completion; refuses foreign or repeated terminal settlement; closes the
request while the I/O operation is still physically retained; and
requires VM/backend teardown (which joins reactor workers) before
issuing the broker-quiescence ACK. It then requires a distinct completed
cleanup/resume handshake before the I/O request pin, exchange pin and
request slot can be reclaimed. The test runs a **trusted host-driven**
cleanup gate: it does NOT demonstrate compiled guest `await` or a
scheduler-delivered cleanup turn. A real VM shutdown must not be replaced
with a forged ACK in production.

This real-backend fixture differs from the earlier fake-broker ABI test,
which remains useful for rejected watch registration and deterministic
mismatched-completion probes. Both are committed in CMake/CTest and
the focused exact-head GCC/Clang/ASan+UBSan workflow. They remain
**NOT EXECUTED** until an authorized runner or local private checkout
builds the exact Git tree. No end-to-end source guest parity, WCET or
live-source Task lowering claim follows from checked-in test source.
