# RFC: Orleans-inspired virtual actors with per-actor arenas and tenant VM-isolates

Status: **PROPOSED / NOT IMPLEMENTED** (2026-10-29). This is a cross-backend semantic and security contract; it is not a parity receipt, an implemented source feature, or evidence of native guest execution.

Target implementations: `oreslang-source.java`, `oreslang-source.llvm`, `oreslang-source.net`, `oreslang-source.wasm`, and `oreslang-source.cranelift`. The independent Forge backend is not Cranelift and requires a separate eventual parity tracking item. All five named targets must implement the *same observable semantics*; the currently supported subsets differ drastically.

Reference: Microsoft Orleans' virtual actor model, scheduling, placement, lifecycle, state persistence, reminders, and message-delivery documentation:
- https://dotnet.github.io/orleans/docs/overview/
- https://dotnet.github.io/orleans/docs/implementation/scheduler/
- https://dotnet.github.io/orleans/docs/implementation/messaging-delivery-guarantees/
- https://dotnet.github.io/orleans/docs/grains/grain-placement/
- https://dotnet.github.io/orleans/docs/grains/reminders/
- https://dotnet.github.io/orleans/docs/security/

## Decisions

1. **Keep explicit spawned actors distinct from virtual actors.** A spawned actor remains scoped to its supervisor and explicit lifecycle; a virtual actor has a stable logical identity and may activate, deactivate, recover, and move without changing the caller's logical reference. Do not silently virtualize existing `spawn` calls.
2. **Actor heap, tenant VM-isolate, and OS sandbox are three distinct concepts.** A tenant VM-isolate contains multiple actor activations, each with a private default allocation arena and ownership metadata. Tenant-isolate membership does not grant cross-actor mutable-heap access. An actor requesting *protected-actor* isolation retains the earlier stronger requirement of a separate protected address-space boundary; never regress Java's `docs/runtime/actor-physical-boundaries.md` semantics by silently co-hosting such actors.
3. **An actor is not a CPU thread.** Actor mailbox admission and exclusive execution lease serialize all guest callbacks (initialization, receive, futures, continuations, timers, cleanup and supervisor hooks). `await` yields a turn; resumption reacquires the actor lease. Selective interleaving must be opt-in and obey `critical-read`/`critical-write`, ownership, and borrow constraints. Never call guest code directly from host I/O callbacks.
4. **No raw cross-actor heap references.** Sendable messages are copied/encoded or transferred through a checked move of owner handles. Explicit frozen shared regions have separately validated lifetimes; sharing a VM-isolate does not allow pointer aliasing. 32-bit compressed actor-relative offsets are an optimization only after verified bounds, generation, and address-space identity checks; do not truncate 64-bit host addresses.
5. **Runtime placement is security-constrained before it is resource-optimized.** Enforce tenant identity, code version, permissions, security mode, data residency, and capacity hard filters, then balance memory/CPU/locality. A lack of compatible capacity is an admission error; never relax a hard isolation constraint.
6. **No magical exactly-once delivery.** Message routing and repair preserve logical operation IDs, but timeouts report unknown outcomes. Retry safety requires durable dedupe/operation keys and atomic effect fencing where needed. `send` admission receipts are distinct from completed effects. Durable state and accepted requests are separate unless explicitly committed atomically.
7. **Identity is tenant-scoped.** `ActorKey = (tenant_id, namespace, actor_type_id, actor_key)`. A client cannot forge tenant IDs by choosing an actor key. Authentication and authorization are enforced at ingress **and** every cross-isolate/cluster delivery boundary, with bounded immutable caller context. Logical references are not themselves proof of authorization.
8. **The tenant budget is authoritative.** Hierarchical tenant > isolate > actor accounting covers live arena bytes, mailbox bytes, continuations, active turns, CPU/fuel, timers, snapshot bytes, outgoing calls, descriptor/capability handles, and queued stream bytes. Reserve before admission, release exactly once, and preserve independent supervisor CONTROL/wake headroom under overload.
9. **Activation state is not durable state.** Hot/in-memory arenas, native pointers, VM handles, open FDs and outstanding borrows are not serialized. Snapshot only compiler-approved owned, serializable state and explicitly registered provider handles. Restore creates a new arena and validates schema, permissions and generation.
10. **Isolation claims require backend-specific native proof.** A Truffle context, JVM actor memory wrapper, C++ arena, Rust JIT, Node worker, .NET Native AOT build, or Wasm instance does not by itself establish OS-level tenant separation. Untrusted tenants require a documented process/OS or independently validated sandbox; `unsafe` and native extension capabilities must not be exposed to untrusted guest code.
11. **Ordinary actors preserve supervision.** Panic remains a supervisor-priority CONTROL notice, never intercepted by the panicking actor. Throw/raise semantics and `get_done()` remain unaffected. Virtual actor failure creates a new activation generation only after correct fencing; it does not implicitly retry effects from an uncertain request.
12. **Hard real-time is an explicit profile, not a default claim.** Dynamic activation, disk persistence, live migration, GC, JIT and unbounded distributed waits are excluded from hard-RT execution unless preallocated, bounded and separately proven. Native/LLVM may target hard RT; Java's primary profile remains soft RT.

## Architecture and trust levels

```text
cluster directory + membership + durable provider + authenticated transport
  node host / process broker
    tenant VM-isolate T (code generation, capabilities, quotas, actor scheduler)
      actor activation A (private arena, state seal, mailbox, execution lease)
      actor activation B (private arena, state seal, mailbox, execution lease)
      explicit frozen shared region (only if capability and lease authorize)
    tenant VM-isolate U (no mutable data or capabilities inherited from T)
  standalone protected-actor worker (separate address space when requested)
```

Isolation profiles:
- `actor-local`: separate actor arena; placement may share trusted tenant VM-isolate and process; memory safety enforced by borrow/ownership/runtime boundaries. Not an adversarial native-code sandbox.
- `tenant-protected`: multiple actors per tenant VM-isolate, separate tenants by a verified VM, sandbox or process appropriate to the threat model. Native-FFI/unsafe generally means require OS isolation.
- `actor-protected`: separate protected address space or equivalently proven boundary *per actor*; no co-hosting to reduce cost.
- `untrusted`: deny ambient host imports/FFI/unsafe and raw descriptors; use a verified OS sandbox, permission broker, resource limits, and bounded serialized messaging. Failed verification => reject activation.

An actor may move between tenant VM-isolates only within the same authenticated tenant and after full lease fencing and state transfer. Cross-tenant moves are forbidden. A tenant cannot override authorization by selecting a placement preference. The host/broker must not pass a tenant's secrets to untrusted actors merely because they share a node.

## Virtual actor control plane

A virtual actor uses a stable `ActorRef<T>` (conceptual API; **not currently parsed Oreslang syntax**). The directory stores `(key, activation_generation, owner_node, tenant_isolate_id, placement_epoch, lease_expiry, code_schema)`. Node clocks are not a substitute for monotonic storage fencing. Only an owner holding an unexpired and provider-validated epoch may commit state or admit externally visible effects that depend on single ownership.

Proposed lifecycle:
`ABSENT -> PLACING -> ACTIVATING -> ACTIVE -> DRAINING -> PASSIVATED`, with `FAILED` and `FENCED` transitions. A call to ABSENT requests placement; only the selected activation may execute. Acquire the tenant quota *before* allocating the actor arena. Restore durable state, initialize capability handles, then make ACTIVE visible. Deactivation seals admission, drains/cancels continuations under a deadline, checkpoints if configured, releases leases, runs cleanup and destroys the arena. Crashes fence the old generation before an alternate activation performs side effects. Releasing a directory lease without fencing storage side effects is not sufficient.

Placement hard filters (in order): tenant principal, isolation profile, code/ABI/schema compatibility, capability set, region/data-residency, capacity. Soft scoring: locality, per-tenant fair-share, CPU load, arena/memory pressure, mailbox congestion, affinity requirements. Use hysteresis and placement cooldowns to avoid churn. Disable live migration until safe serialization and external-effect handoff are proven.

## Memory & ownership contract

- Every activation owns an arena: `arena_id`, `actor_id`, `activation_generation`, `tenant_isolate_id`, committed/reserved bytes, loan count, and drop queue. No general heap object escapes as a bare address.
- Local allocations are fast bounded arena allocations; owned objects with nontrivial destructors require deterministic drop tracking. A temporary turn arena can reset after a turn only when no pinned continuation/borrow references it. Long-lived state uses the activation arena.
- A checked `rt take` may transfer an owned buffer to a different actor *only through a documented transfer mechanism*; when different arenas/processes cannot re-home the original region safely, serialize or copy instead. Never claim zero-copy for cross-process IPC by default.
- `rt share` uses immutable/frozen regions or explicit synchronized shared-domain APIs with generation-stamped handles; no unprotected writable aliases. `handle_state(critical-read ...)` and `handle_state(critical-write ...)` remain the only actor sealed-state access paths.
- Actor/passivation cleanup must handle outstanding I/O, queued messages, pinned async frames, and shared-region leases without use-after-free or double-free. Resource counters are reconciled after every failure path.
- An arena allocator is not a sandbox: protect native untrusted tenants with OS isolation, bound native memory use, and reject unsafe host primitives.

## Messaging & storage

Generate versioned actor method/message codecs at compile time, with schema fingerprint, tenant principal, actor key, request ID, activation epoch, deadline, payload length and permitted capability IDs. The codec must reject unknown mandatory fields, oversized/nested payloads, invalid ownership claims, stale generations and incompatible schema versions before guest allocation.

Envelope processing:
1. Authenticate source and tenant scope; validate target and permissions.
2. Reserve bounded mailbox/tenant credits and attach expiry, cancellation, tracing and operation identity.
3. Resolve the directory and validate activation epoch; repair stale routing **without creating a new application request**.
4. Dispatch through the exclusive actor lease. Return a distinct accepted/admitted receipt versus method result; on timeout surface `OutcomeUnknown`, never `FailedWithoutEffect`.
5. For retryable durable effects, use provider-side idempotency key + transaction/CAS + transactional outbox; do not promise exactly-once across arbitrary external services.
6. Release credits and message ownership deterministically on delivery, rejection, cancellation, expiry, crash, or finalization.

Persistence v1: explicit snapshot store with schema migration and compare-and-swap version; provider write must be acknowledged before durability is claimed. Add event sourcing and persistent streams later, with replay boundaries and replay-safe effects. Timers are activation-scoped; durable reminders are stored separately and may reactivate a virtual actor. A recurring reminder may deliver late or more than once after failure and is never a substitute for transactional state mutation.

## Backend implementation requirements

| Backend | Actual initial state | First implementation step | Isolation enforcement |
| --- | --- | --- | --- |
| Java / Truffle / GraalVM | Actor scheduler and bounded lanes exist; true protected source actor heaps and bootstrap remain pending (see Java actor physical boundaries). | Add stable virtual identity/directory adapter and activation generations *without weakening actor-wide leases*. Then make a real source guest enter a tenant isolation boundary. | Truffle contexts are not native-image isolates. Evaluate GraalVM Native Image isolate API if applicable; for adversarial native access prefer exec'd sandboxed workers. |
| LLVM | `OwnedHeap.hpp` and `EpochArena.hpp` are separately tested, but source-to-actor lowering and general heap objects are incomplete. | Lower actor-owned allocation to arenas; add generator-safe handles and a native tenant VM/sandbox executor. | Process isolation or audited memory-safe bytecode/VM; a native arena alone is not isolation. |
| .NET Native AOT | Currently a checked scalar subset; actors and async are not shipped. | Introduce actor IR contracts and Native AOT-compatible scheduler + region/arena accounting before virtual placement. | Native AOT forbids runtime JIT in release profile; process/OS broker for untrusted tenant isolation. |
| WebAssembly | Bounded one-shot core Wasm execution in Node workers; not a guest actor runtime. | Actor runtime + persistent instances/worker scheduler and per-activation actor regions; explicit host-call broker. | Wasm linear memory bounds are not an OS sandbox; Node workers are not process isolation. Use process/OS boundaries for hostile code. |
| Cranelift | Restricted Rust JIT scalar profile; no actor heap, actor semantics or sandbox. Separate from Forge. | Define common actor ABI/IR with parser fail-closed, then add ownership regions and scheduler before virtual actor activation. | Native Cranelift JIT is not a sandbox; execute untrusted code only through a verified sandbox or process broker. |

No backend is promoted because an interface, simulator, host stub, fake compiler, or design document passes tests. `forge` continues as an independent sixth source backend and should later receive its own row/acceptance evidence.

## Conformance and security gates (required, not currently passed)

- **VA01 stable identity**: same `(tenant,type,key)` resolves across deactivation and node movement; different tenants never alias.
- **VA02 one activation**: two nodes racing for same key cannot both commit effects; fencing epoch checked at the durable side-effect boundary.
- **VA03 arena ownership**: actor A cannot dereference B's heap; forged/stale/truncated actor-relative handles fail closed under ASan/UBSan or equivalent checks.
- **VA04 no guest callbacks outside lease**: receive, init, async resumption, timer, panic, and teardown never execute concurrently in one actor; every continuation is mailbox-admitted.
- **VA05 await loans**: invalid loan across suspension/migration fails at compile time or runtime; pinned frames remain alive until completion/cancel.
- **VA06 quotas**: per-actor, tenant and node mail/heap/CPU/reminder limits with no leaked credits after every rejection and crash.
- **VA07 stop headroom**: saturation cannot block or forge supervisor CONTROL/cancel; the actor cannot catch its own panic.
- **VA08 durability**: crash before and after checkpoint confirms exact visibility/version; no raw pointer, FD, unsafe capability or stale key survives restore.
- **VA09 unknown outcome**: dropped response or timeout is not reported as guaranteed failure; idempotent retry and dedupe behavior are deterministic.
- **VA10 cross-tenant security**: forged actor ref, caller identity, route, token, snapshot and manifest are denied even when tenants share a node.
- **VA11 migration fencing**: old activation is unable to commit after new lease owner begins; orphaned children and reminders are reconciled.
- **VA12 version skew**: incompatible old/new code schemas fail safely; compatible rolling upgrade preserves state and message semantics.
- **VA13 isolation**: untrusted tenant cannot import `unsafe`, read another tenant's mapped memory, acquire raw FD/host calls, or escape configured CPU/memory quotas in a native test.
- **VA14 policy before optimization**: pressure/placement changes never relax isolation or residency; no compatible node returns a typed refusal.
- **VA15 native execution evidence**: exact source/tree SHA, compiler/runner identity, nonzero executed steps, input hashes, raw logs, and actual guest runtime traces for **each** named backend.
- **VA16 cleanup**: high-rate activate/passivate loops with ownership/memory stats, leak checks, cancellation, deferred drop and mailbox drain.
- **VA17 RT boundary**: strict profile rejects unexpected JIT, heap growth, blocking persistence, unpredictable migration, and nonbounded scheduler actions.
- **VA18 reminders and streams**: reminder reactivation, duplicate ticks, capped subscriber fan-out, backpressure and cancellation.
- **VA19 provenance**: unsigned or unmatched snapshots/guest code/tenant host configurations rejected at the isolation boundary.
- **VA20 failure injection**: node kill, forced isolate shutdown, split membership, partial snapshot, network partition, stale directory entry, timer races and retry storms.

All gates are **NOT_EXECUTED** here. A shared spec/manifest schema check is not native behavioral evidence. First deliver a reference in-memory single-process implementation with explicit status `NOT_PROTECTED`, then validate separately in an actual tenant sandbox. Extend the existing platform conformance receipts with per-backend case IDs rather than promoting from code-review or queued CI alone.

## Implementation sequence

**P0 (spec and fail-closed):** adopt this RFC; freeze actor-key encoding, actor-ref wire envelopes, epoch/capability schema, quota ledger, and isolation-level names; add negative fixtures and receipts. Unimplemented feature syntax must fail closed.
**P1 (single-node correctness):** Java reference virtual directory + real source activation + arena generation and teardown; LLVM native actor arena and source guest lowering; implement contention, lease and borrow tests.
**P2 (isolation):** tenant VM-isolate broker with per-tenant account, per-actor arena, no unsafe access for untrusted guests, actual memory/budget instrumentation and native process/sandbox proof.
**P3 (distributed):** membership, placement, generation/epoch fencing, durable snapshots, failover, idempotency, timeouts/unknown outcomes, and durable reminders.
**P4 (parity):** port runtime semantics to .NET, Wasm and Cranelift after native scheduler/actor execution exists; verify exact-head guest runs; include independent Forge tracking but never relabel it Cranelift.
**P5 (optimized/optional):** safe live migration, zero-copy within proven sharing domains, streams/event sourcing, placement refinements, and only then hard-RT-specific certification.

The compatibility rule is **same guest-language semantics, different host isolation implementations and performance profiles**. An unavailable security guarantee is a typed admission failure, never a silent fallback.
