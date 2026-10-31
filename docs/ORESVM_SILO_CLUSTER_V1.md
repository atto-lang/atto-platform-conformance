# OresVM silos and per-tenant VM-isolates — cluster v1

**Status: PROPOSED; HOST-REFERENCE ONLY; NOT a production cluster or backend parity proof.**

This RFC is a stacked extension of `VIRTUAL_ACTORS_VM_ISOLATES_RFC.md` and
`ACTOR_IDENTITY_V1.md`, not a second actor identity or lifecycle design.

## Ownership and hosting hierarchy

```
OresCluster (control-plane directory / membership / provider fencing)
  OresVM node A (process, Orleans-style "silo")
    Tenant A VM-isolate (one tenant-execution boundary on this node)
      actor A1 (private arena, sealed state, mailbox, exclusive execution lease)
      actor A2 (private arena, sealed state, mailbox, exclusive execution lease)
    Tenant B VM-isolate
      actor B1 (private arena, sealed state, mailbox, exclusive execution lease)
  OresVM node B (process, another silo)
    Tenant A VM-isolate (distinct isolate from node A, same tenant principal)
      actor A3 (private arena, sealed state, mailbox, exclusive execution lease)
```

- An OresVM node/silo is a **process-level actor host**, not one VM-isolate per actor.
- **At most one default tenant VM-isolate per `(node_incarnation, tenant_id)`** in the
  first implementation. A tenant may span many OresVM nodes; each node's isolate
  is separate, independently owned, and quota-accounted. There is no global
  shared tenant heap or cross-node zero-copy pointer claim.
- A default actor activation has a **private actor-owned arena** inside that
  tenant VM-isolate. Tenant co-location never permits mutable cross-actor
  aliases. Ordinary `spawn` stays explicit/scoped and is not silently virtual.
- Stronger `actor-protected` and `untrusted` isolation require separately
  verified protection (for example an OS process/sandbox, if needed). A
  descriptor's `tenant-protected` label is **not** independent sandbox proof.
  A missing security boundary is a typed admission failure.
- The directory has one route per canonical ActorId; the route includes the
  node incarnation, the concrete tenant-isolate ID, and a generation/epoch.
  A stable ActorRef carries **logical identity only**, not authority or a node.

## Control plane and fencing

The real implementation must authenticate both host controls (join, drain,
quarantine, membership revocation) and caller-to-tenant routing. Never trust a
client-supplied tenant ID, node report, route, or `ActorRef` token as a credential.
Each cross-node delivery checks tenant authorization, route incarnation,
activation epoch, schema, capability set, deadlines, size and mailbox credits.
The receiving node must re-check all authority before allocating guest memory.
No network callback may run guest actor code outside the exclusive actor lease.

A node's immutable `node_incarnation` is not reused after process restart.
Membership statuses: `READY`, `DRAINING` (no new placements), `DOWN`
(invalidated local routes). Heartbeat expiry may start a *suspected* transition,
but a wall clock or failed heartbeat never proves the old owner cannot write.
To recover an activation on another node, authoritative storage/effect providers
must atomically advance their monotonic epoch and reject stale owners at the
side-effect commit boundary. Lease expiry or in-memory directory invalidation
alone is insufficient. On uncertain acknowledgement: report `OutcomeUnknown`
and preserve operation IDs for idempotent retry; do not promise exactly-once.

Placement: first enforce tenant identity, isolation, code/ABI/schema version,
permissions/capabilities, residency/region, CPU/accelerator requirements and
capacity as **hard filters**. Only then apply deterministic balancing or
locality hints. No suitable isolate => typed refusal. A tenant VM-isolate may
host actors from multiple compiler backends only after independently verified
safe loader/ABI and protection compatibility; the first reference uses exactly
one declared backend per OresVM node.

Dynamic cluster activation/migration, live disk persistence and unbounded
network waits are forbidden inside the LLVM hard-real-time execution profile
unless separately admitted as bounded offline/preallocated operations.

## Executable in-memory reference

`reference/silo/directory.mjs` exercises **directory-only** operations using
canonical ActorId from the earlier persistence-sidecar reference:
`register_node`, `make_trusted_tenant_context`, `activate_actor`,
`route_actor`, `validate_delivery`, `drain_node`, `fail_node`, and
`passivate_actor`. Methods are underscore/snake_case consistently.

The reference rejects duplicate tenant isolates and shared isolate IDs across
tenants, wrong-tenant contexts, stale routes, unsafe mode claims, inconsistent
backend/region/capability placement, node incarnation reuse, actor/global quotas,
and hard-RT dynamic activation. It snapshots canonical ActorId once, retains
hash-collision bindings and increases in-memory activation epochs on restart.
**Host-side code is a model, not a network broker.** Its trusted-context factory
and node-registration methods must never be exposed to guest code or clients.
The epoch counter is reset if the reference process loses its memory. Thus,
`fail_node` + reactivation only demonstrate *directory route invalidation*;
they do **not** establish durable leader election, remote node termination,
or externally fenced commits. No source actors, VM-isolate creation, IO,
multinode transport, runtime permission checks or secure host authentication
are implemented by this reference.

Run with the existing reference code in the parent PR:

```sh
node --test reference/silo/directory.test.mjs
```

## Required promotion gates

| Gate | Requirement | Current evidence |
|---|---|---|
| SI01–SI04 | Isolate-per-tenant node mapping, canonical routes, isolation and quota refusal | Host model only |
| SI05–SI07 | Immutable node incarnation, stale route invalidation, drain | Host model only |
| SI08–SI10 | Provider-signed/validated fencing, partition/failover, side-effect sink CAS | NOT_EXECUTED |
| SI11–SI13 | Authenticated network ingress, transport backpressure, schema/capability rejection | NOT_EXECUTED |
| SI14–SI16 | Source guest actor + actual isolate protection and arena teardown in Java/LLVM | NOT_EXECUTED |
| SI17–SI19 | .NET, Wasm, and Forge guest parity; exact SHA and executed CI evidence | NOT_EXECUTED |
| SI20 | Hard real-time negative effect gate plus WCET/latency evidence on hardware | NOT_EXECUTED |

Next implementation should bind this contract to the **Java OresVM reference**
and separately native LLVM, then bring .NET/Wasm/Forge to the same observable
semantics. Keep Forge distinct from the independent Cranelift backend.
No private source is authorized to be copied across organizations for this RFC.
