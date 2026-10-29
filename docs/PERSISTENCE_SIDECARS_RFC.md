# Persistence v1: actor-local state, tenant-scoped batch sidecars

Status: **PROPOSED**. This extends [the virtual actors RFC](./VIRTUAL_ACTORS_VM_ISOLATES_RFC.md). The [SQLite reference engine](../reference/persistence-sidecar/README.md) is an executable host-side model, **not a production storage provider, Oreslang actor, VM-isolate implementation, or native parity proof**.

Relevant Orleans design: named persistent grain states and configurable providers; journaled grains and confirmation; timers vs durable reminders. Unlike an actor's identity, an activation, its in-memory arena and its durable state have different lifetimes.

## Persistence policies

Each actor type/instance may select persistence for separately named state slots. Semantics are configurable *at activation admission* rather than changed implicitly during a turn:

| Policy | Runtime behavior | Commit contract |
| --- | --- | --- |
| `ephemeral` | actor arena only; lost at passivation/crash | none |
| `snapshot` | owned serializable state checkpoint plus version/schema | provider-confirmed CAS |
| `journal` | append versioned events; rebuild from snapshot + events | provider-confirmed append; deterministic replay |
| `batched(snapshot)` | sidecar combines many independent snapshot writes | explicit admitted vs committed |
| `batched(journal)` | sidecar group-commits event writes | explicit admitted vs committed |
| `write_through` | guest reply waits for confirmed commit | provider-confirmed, or outcome-unknown on timeout |
| `replicated` | uses a provider offering quorum/replication guarantees | require actual configured provider receipt; not a label |
| `external` | explicit actor-controlled database adapter | host broker permissions and effect fencing |

`batched` is a transport/scheduling modifier, not a durability class. On each actor, `state_name` can choose a distinct provider. A write to state slot A is not automatically atomic with a write to slot B across different stores. Any cross-slot transaction requires an explicitly supported single transactional provider or workflow/saga.

## Logical API (future Oreslang syntax, not yet implemented)

```ores
// Illustrative only; the compiler must reject unsupported syntax, not silently reinterpret it.
define actor ShoppingCart extends DurableActor<CartState> as
  // Persistence policy belongs to runtime metadata, not mutable guest global state.
  // slot "cart": journal, provider: tenant_wal, writer: sidecar, ack: committed
  // slot "view": snapshot, provider: tenant_wal, writer: sidecar, ack: admitted

  add_item(Item item) : Result<void, Error> {
    return trap self.persist_event(item, #committed);
  }
end
```

The actual compiler API, syntax, annotations and type signatures must be ratified separately. Method names remain snake_case. Persisted writes carry `tenant_id, actor_type, actor_key, state_name, activation_epoch, expected_version, operation_id, schema_version, payload, policy`.

The guest actor always owns in-memory state; the sidecar owns only bounded serialized envelopes, transaction assembly and the provider connection. A trusted host chooses/authorizes the tenant and epoch; no guest may call `grant_epoch` or install its own fencing token.

## Sidecar architecture and scale

- **One sidecar per tenant shard, not one per actor.** Partition by hash of `(tenant_id, actor_id, state_name)` into a configurable fixed-size pool of persistence-sidecar actors; thousands of actors can share one sidecar connection pool. Avoid an unbounded single-sidecar bottleneck.
- **Each sidecar has its own actor arena and mailbox.** Request messages are bounded serialized owned data; nothing points into the initiating actor's arena. No actor mutable state escapes into sidecar state.
- **Quotas apply at each layer**: requesting actor outstanding writes, actor-local mailbox, sidecar queued entries/bytes, tenant in-flight bytes and IOPS, destination connection pool, storage capacity and WAL bytes. Zero-length messages consume nonzero credits.
- **Batch on the first bound**: `max_batch_entries`, `max_batch_bytes`, `max_wait_ms` or an explicit flush barrier; a committed/write-through request can force a batch without waiting for a long timer. Prefer configurable initial profile of 256 entries, 1 MiB and 5ms, measured on workload.
- **Fair scheduling**: per-actor FIFO and expected-version CAS; round-robin or deficit scheduling across actor IDs and tenant budgets so hot actors cannot starve thousands of cold actors. A rejected/conflicting actor update must not poison other actor writes in the same transaction.
- **Durable ACK after commit only.** `admitted` means queued locally and is lost on process failure unless explicitly journaled first. `committed` means the configured provider confirmed its durability contract; `replicated` means the named provider confirmed the advertised replica/quorum policy. On network/commit timeout report `OUTCOME_UNKNOWN`, then resolve by operation ID.
- **Sidecar crash**: recover durable state from provider, re-route in-flight requests, require new activation epoch where appropriate; client resends same operation ID and compares results. Never claim an automatic exactly-once external effect. A sidecar restart alone cannot fence external services unless they also check the epoch or use transactional outbox.
- **Batch atomicity is provider-scoped.** For a relational provider, a transaction may contain writes for many actors; CAS and idempotency records must commit alongside state. If the provider has a maximum transaction size or cannot atomically include them, split batches and acknowledge each committed subset. Never imply distributed transactions across shards.
- **Hot passivation**: writer must either await a `committed` barrier for all required state or deliberately use a documented weaker crash-loss policy. Snapshot state only after outstanding loans/async frames and sealed-state fences have resolved.
- **Migration**: old incarnation must be fenced against the durable provider *before* new incarnation commits. A directory update alone is insufficient.
- **Security boundary**: sidecar pooled writes cannot co-mingle tenants into a common unprotected VM memory domain. Cross-tenant shared storage demands provider row/namespace policy enforced independently of caller-supplied fields. `unsafe`, FFI and raw provider credentials never enter untrusted guest isolates.
- **Observability**: collect queue age/bytes, accepted vs committed counts, actual provider transaction batch size, fsync/commit latency, per-tenant fairness, CAS conflict rate, stale-epoch rejections, dedupe hits, journal replay time, timeout/unknown outcomes, and WAL/backlog growth.

## Restore, journals, snapshots and reminders

- On activation, get state and version from authoritative provider with an epoch-authorized read. Restore last snapshot plus events strictly after its version. Validate type/schema fingerprint and migrations before guest activation, and reconstruct only actor-owned allocations.
- Journaled state must use deterministic replay; side effects must not be rerun during replay. Snapshotting a journal changes the replay offset; compaction cannot delete entries before a confirmed snapshot and retention barrier.
- Support multiple named state objects per actor; the configuration may point each to distinct providers. Do not permit partial migration to masquerade as an atomic multi-provider commit.
- Activation-scoped timers are canceled on passivation. Durable reminders are persistent definitions that may reactivate an actor; ticks may be delayed or skipped by outage and must be replay-/retry-safe. They do not replace durable workflow queues.

## Node/SQLite executable reference scope

`reference/persistence-sidecar/sidecar.mjs` implements:
- One tenant per model instance; trusted activation epoch grants.
- Snapshot and journal writes with per-actor CAS versions and persisted operation-ID dedupe.
- Bounded admission and group commit in SQLite WAL `synchronous=FULL`, explicit `flush()`.
- Read/restore after reopening the same database; stale queued writes rejected.
- A regression test submitting **1,000 actor snapshots** to one transaction.

Limitations (DO NOT PROMOTE): `node:sqlite` synchronous calls block the JS thread; production Oreslang sidecar must suspend on async native I/O. The reference is single-process/single-tenant, lacks a network transport, background max-wait timer, distributed lease authority, actual guest code, provider plug-ins, failover under partition, fsync fault injection, replication, end-to-end authenticated capability validation and Oreslang compiler hooks. It is NOT a secure untrusted tenant sandbox or power-loss certification.

## Required backend gates

Add persistence cases to the VA conformance registry:
- **PS01** per-actor and named-slot isolation under 10k writes.
- **PS02** actual guest actor state serialized without raw heap/FFI handles.
- **PS03** admitted != committed under sidecar crash before flush.
- **PS04** 1k distinct actors' records in a bounded provider batch; measure actual commit count.
- **PS05** expected-version CAS, per-actor ordering and cross-actor conflict isolation.
- **PS06** persisted dedupe with payload fingerprint and operation ID.
- **PS07** old epoch rejected after migration and node restart; prove provider-side fencing.
- **PS08** snapshot + event replay, schema migration, journal compaction.
- **PS09** exact sidecar/tenant/actor resource accounting on admission, failure and stop.
- **PS10** tenant/role/capability authorization with malicious forged envelopes and raw-pointer denial.
- **PS11** provider commit/ack failure and outcome-unknown behavior under fault injection.
- **PS12** no guest callbacks outside actor-wide execution lease; no blocking on scheduler carrier.
- **PS13** cross-node sharding, failover and transactional outbox effect replay safety.
- **PS14** durable reminder activation, duplicate tick, missed tick and stop fencing.
- **PS15** exact-head native guest execution and test provenance for Java, LLVM, .NET, Wasm, Cranelift (and independently Forge).

All PS native runtime gates are **NOT_EXECUTED**. A passing host SQLite reference test proves only that narrow algorithm.

## Delivery plan

P0: shared persistence/wire/ack protocol and executable host reference tests (this PR).
P1: Java real source actor adapter; LLVM actor heap lowering and native async sidecar ABI; enforce trusted epoch control.
P2: async durable sidecar actors, per-tenant shard pool, provider SDKs, backpressure, 10k actor contention and fault-injection evidence.
P3: restore and passivation, snapshot/journal compaction, reminders, migration/fencing, transactional effects.
P4: .NET Native AOT, Wasm and Cranelift source actors; strict cross-backend native conformance, with Forge separately.
