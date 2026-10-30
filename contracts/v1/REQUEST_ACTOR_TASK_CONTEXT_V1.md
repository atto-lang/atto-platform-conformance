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
