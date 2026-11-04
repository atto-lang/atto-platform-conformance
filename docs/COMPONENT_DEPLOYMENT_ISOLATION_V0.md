# AttoLang deployment-independent components — security contract v0

**Status:** PROPOSAL / NOT_IMPLEMENTED. Design input: Service Weaver's
component/deployment separation, not a claim of Service Weaver equivalence.
This complements the Orleans-style virtual actor RFC and the OresVM silo
reference. It does not authorize production rollout or private-source export.

## Two distinct execution identities

1. `ActorRef<T>`: stable, tenant-scoped **logical actor identity**. A stateful
   writer has at most one authorized activation per persistent identity, with
   incarnation/epoch fencing. Actor state stays in an actor-owned arena.
2. `ComponentRef<I>`: a **versioned interface contract** for a replicated
   component. Each replica has an ephemeral instance ID and per-replica state;
   a component reference is not a durable actor identity or capability.

An ordinary explicit `spawn` remains explicit. Neither component routing
nor co-location implicitly virtualizes spawned actors.

## Separation of source and topology

A compiled application declares typed component dependencies and allowed
capabilities. A separately reviewed, immutable deployment manifest chooses
replicas, nodes, isolate placements, co-location, regions, resource budgets and
traffic-shift policy. A single-process configuration is an optimization, not a
distinct source program.

The runtime MUST reject unknown mandatory manifest fields and unsupported
backend capabilities **before** admitting traffic. There is no permissive
fallback from a requested tenant/actor security boundary to a weaker one.

## Routing, state and failure semantics

- Stateless component replica calls may be load balanced. Key affinity is
  **advisory**, never a write-ownership or durability guarantee. Any
  authoritative per-key mutable state must use an actor with a fenced writer,
  or an external transactional storage protocol.
- An interface method must declare whether a retry can duplicate effects.
  Transport timeout or node failure yields an **unknown outcome**, not an
  inferred rollback or automatic business-level exactly-once processing.
  Recover with a stable operation ID and a commit-aware provider.
- Component instance memory is disposable. Durable state, events and
  idempotency receipts live at explicit storage boundaries.
- Replicas carry immutable `(tenant_id, deployment_id, code_generation,
  interface_schema_hash, component_id, replica_incarnation)` identity.
  Server admission validates all six dimensions on every call. A serialized
  `ComponentRef` cannot grant tenant or method authority.
- No arbitrary function, method or closure crosses component, actor, channel,
  or pub-sub boundaries: transport contains typed, bounded, serializable owned
  data only. No lexical captures, mutable borrows or guest heap pointers.
- Co-location may eliminate a network hop, **never** the ownership, capability,
  audit or scheduler boundary. Any local fast path must match the remote path's
  cancellation, rejection, ordering and fault observable contract.
- Reject callbacks on actor carriers while backpressured. Async send/receive
  may suspend tasks, not block the carrier thread. Maintain tenant quotas and
  mailbox credits independently of component replica counts.
- RPC and lifecycle control planes require authenticated principals and
  exact protocol version; no caller-supplied tenant, deployment or replica
  descriptor constitutes evidence of authority.

## Version-isolated rollout and rollback

A deployment generation is pinned for a routed request and all of its
component-to-component calls unless an explicit, compatible cross-generation
bridge is authorized. New traffic may shift between generations; no request
silently joins a mixture of incompatible component implementations.

Version isolation does **not** automatically migrate durable actor state.
Actor state schemas, provider epochs and snapshot/journal replay contracts
require separate transactions and validation. Rolling back code cannot roll
back already committed effects. Each generation must define a supported
schema-read/write range, or be refused.

Do not garbage-collect a generation while it owns active calls, actor turns,
durable acknowledgements or transferred resource leases. A drained generation
can retire only after its outstanding ownership/quiescence accounting reaches
zero or a separately proven revocation protocol completes.

## Admission / adversarial acceptance matrix

| ID | Required behavior | Current evidence |
| --- | --- | --- |
| CD01 | Same source compiles for one process and distributed topology | NOT_EXECUTED |
| CD02 | Unknown, inherited, hidden and unsupported manifest constraints refused | NOT_EXECUTED |
| CD03 | Cross-tenant or cross-capability method dispatch refused before guest allocation | NOT_EXECUTED |
| CD04 | Co-located and remote calls preserve type/ownership/failure/cancel semantics | NOT_EXECUTED |
| CD05 | Replica crash and re-placement do not imply durable state or exactly-once | NOT_EXECUTED |
| CD06 | Retry after uncertain commit uses stable op ID and reports unknown outcome | NOT_EXECUTED |
| CD07 | Affinity changes do not permit two active actor state writers | NOT_EXECUTED |
| CD08 | Mixed deployment generations denied without explicit compatible bridge | NOT_EXECUTED |
| CD09 | Rollback respects committed effects and forward/backward state schemas | NOT_EXECUTED |
| CD10 | Backpressure/cancellation do not park actor carriers or leak quotas | NOT_EXECUTED |
| CD11 | Forged tenant/deployment/replica metadata and oversized messages fail closed | NOT_EXECUTED |
| CD12 | Java, LLVM, .NET, Wasm, Forge and Cranelift evidence is individually source-backed | NOT_EXECUTED |

The existing silo-directory Node tests cover **some related** hard admission
and stale-route logic (SI cases), not CD01–CD12 component execution. Do not
count reference-model tests as source-guest or cross-backend parity.

## Implementation staging

1. Define typed source AST/IR component declarations without creating a second
   mutable-actor identity model. Implement compile-time sendability checking.
2. Implement source-built Java/Graal component call and same-process fast path;
   demonstrate the same guest fixture through an actual remote transport.
3. Integrate generation-pinned request chains, async backpressure, authenticated
   admission and unknown-outcome receipts.
4. Implement LLVM native actor/component routing, then .NET NativeAOT, Wasm,
   Forge and independent Cranelift; preserve explicit UNSUPPORTED outcomes.
5. Check exact PR-head Git tree and compiler SHAs, nonzero executed steps,
   guest outputs, failure injection, and independent review. A source-free
   host model or zero-step GitHub Actions failure is not sufficient.

### Non-goals

This proposal does not ship Service Weaver, a cluster coordinator, a service
mesh, a new source keyword, a privileged network listener, a production
multi-tenant sandbox or reliable remote actor failover. No automatic native
hot-reload or cross-version database migration is implied.
