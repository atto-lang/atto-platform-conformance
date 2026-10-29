# Tenant batch persistence sidecar — executable reference model

This folder is a **host-side algorithm and storage reference**, not Oreslang source guest code, a production Oreslang actor, a secure tenant sandbox or five-backend parity proof.

Requirements: Node.js **22.16+** (built-in experimental `node:sqlite`) with SQLite support. No npm dependencies.

```sh
node --disable-warning=ExperimentalWarning --test reference/persistence-sidecar/sidecar.test.mjs
```

The Node built-in `DatabaseSync` uses synchronous SQLite operations: **never run this implementation on an Oreslang actor scheduler carrier**. Production sidecars require async native I/O suspension and a provider interface, plus a trusted control-plane channel for epoch grants.

## Data and isolation

One `BatchPersistenceSidecar` instance has a single configured tenant. An actor's bytes are copied on admission, not borrowed; the sidecar never obtains source actor heap pointers. The trusted directory/controller alone can invoke `grantEpoch`; the reference model does **not** expose a secure network endpoint or authenticate control-plane calls.

`enqueue` returns `{status:'admitted', durable:false}` until `flush` commits a SQLite transaction. `flush` returns `committed/durable:true` or a typed rejection. Payloads are capped, queue entries are capped, and each admitted message incurs nonzero quota even for an empty payload. Writes carry an expected state version and a durable operation ID.

SQLite is configured for WAL and `synchronous=FULL`. That is a provider-level commit contract, **not** proof of actual power-loss durability on all hardware, replicated consensus or distributed exactly-once effects. A commit exception is conservatively `OUTCOME_UNKNOWN`, to be resolved by retrying the same operation ID.

A snapshot updates a named state slot's snapshot and version. A journal event appends at the next version. `load` returns the latest snapshot and subsequent events for deterministic guest-level replay; it does not execute guest replay.

## Test assertions

- 1,000 distinct actor snapshots in one group commit, reopened and read.
- Idempotent duplicate retries and conflicting reuse of an operation ID.
- Epoch advancement invalidates pending stale writes and survives reopen.
- A CAS conflict for one actor does not prevent another actor committing.
- Snapshot + two journal events replay in version order.
- Admitted but unflushed data are not durable across closure.
- Tenant separation, queued-byte quota, payload quota, and copy-on-admission.
- Batch limits split writes without dropping them.
- Zero-byte message floods are bounded by a separate entry quota.

**Missing production requirements:** async provider, real Oreslang guest actors, journal pruning, snapshots across schema upgrades, distributed lease/epoch authority, signed/authenticated tenant envelope, shard routing and fairness, deadline-driven flushing, cross-process crash testing, faked storage failures, remote replica acknowledgments, transactional outbox, and exact-head five-backend guest execution.

See [the persistence RFC](../../docs/PERSISTENCE_SIDECARS_RFC.md) and [the virtual actor RFC](../../docs/VIRTUAL_ACTORS_VM_ISOLATES_RFC.md).