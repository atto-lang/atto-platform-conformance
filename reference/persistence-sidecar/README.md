# Tenant batch persistence sidecar — executable reference model

This folder is a **host-side algorithm and storage reference**, not Oreslang source guest code, a production Oreslang actor, a secure tenant sandbox or five-backend parity proof.

Requirements: Node.js **22.16+** (built-in experimental `node:sqlite`) with SQLite support. No npm dependencies.

```sh
node --disable-warning=ExperimentalWarning --test reference/persistence-sidecar/*.test.mjs
```

The Node built-in `DatabaseSync` uses synchronous SQLite operations: **never run this implementation on an Oreslang actor scheduler carrier**. Production sidecars require async native I/O suspension and a provider interface, plus a trusted control-plane channel for epoch grants.

The [four symbol persistence modes and sealed-state contract](../../docs/PERSISTENCE_SYMBOL_MODES_V1.md) are modeled in `policy-modes.mjs`. Run all model and real SQLite host reference tests with `node --disable-warning=ExperimentalWarning --test reference/persistence-sidecar/*.test.mjs`. The policy adapter verifies persisted operation digest, current activation epoch and version before publishing state, refuses forged duplicate receipts and post-activation policy mutation, and rejects nested lexical mutations. These remain **host-only** results, not source-compiled Oreslang actor or VM-isolate tests.

## Data and isolation

One `BatchPersistenceSidecar` instance has a single configured tenant. An actor's bytes are copied on admission, not borrowed; the sidecar never obtains source actor heap pointers. The trusted directory/controller alone can invoke `grantEpoch`; the reference model does **not** expose a secure network endpoint or authenticate control-plane calls.

`enqueue` returns `{status:'admitted', durable:false}` until `flush` commits a SQLite transaction. `flush` returns `committed/durable:true` or a typed rejection. Payloads are capped, queue entries are capped, and each admitted message reserves at least a 128-byte envelope charge **plus** its payload bytes and UTF-8 actor/state/operation identifier bytes. This is a conservative lower-bound credit charge, not a measurement of every JavaScript heap allocation. An empty payload still consumes nonzero credits. Writes carry an expected state version and a durable operation ID.

SQLite is configured for WAL and `synchronous=FULL`. That is a provider-level commit contract, **not** proof of actual power-loss durability on all hardware, replicated consensus or distributed exactly-once effects. A commit exception is conservatively `OUTCOME_UNKNOWN`, to be resolved by retrying the same operation ID.

A snapshot updates a named state slot's snapshot and version. A journal event appends at the next version. `load` returns the latest snapshot and subsequent events for deterministic guest-level replay; it does not execute guest replay.


## Canonical logical identities (host integration)

`identity.mjs` defines a versioned typed `ActorId` wire format with explicit tenant, namespace, registered actor-type ID, and tagged key. `identity-sidecar.mjs` bridges canonical bytes to this SQLite reference's actor-key column, persisting a canonical-ID binding and rejecting hash/key mismatches. **This is trusted-host logic only, not a tenant authentication service or actor-runtime implementation.** A caller must already be authenticated and authorized by an external directory/host; `activate` must never be exposed as a guest API because it grants epochs.

For the host adapter, tenant and hash identity are computed from the **same serialized ActorId snapshot**, preventing mutable JS getters from changing the tenant or key between validation and use. This model validates its tenant field against a configured tenant, but it does not authenticate external principals, sign refs, implement protected VM isolation, prove hash-flood resistance, or integrate a real distributed fencing authority. The existing untyped `BatchPersistenceSidecar` remains separately usable for algorithm tests; production broker APIs must not expose its lower-level untrusted actor/epoch parameters.

The new `identity-sidecar.test.mjs` exercises typed key separation, cross-process reopen, tenant refusal, corruption/collision rejection, named state slots, getter-based TOCTOU and a **1,000 distinct typed-actor group commit**. These are host reference tests, not source guest/backend parity. [ActorId specification](../../docs/ACTOR_IDENTITY_V1.md).

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
## Security audit (2026-10-29)

- Epoch fences precede persisted op-id deduplication both during queue admission and SQLite transaction commit. A stale activation may not retrieve a previously committed success receipt.
- Tenant, actor, state and operation identifiers reject ASCII control characters, malformed Unicode surrogates and noncanonical NFC spellings.
- Local Node 22.16 host SQLite model: **11/11 tests passed**. GitHub Actions for this exact source head failed before any recorded job steps; that run is NOT_EXECUTED for test purposes.


## Command-index integrity and SIGKILL crash gates (November 2026)

**Status: source-committed draft only.** The host-only `enqueueCommand` / `verifyCommand` protocol commits multiple events and a durable command result in one SQLite transaction, independently of actor epoch. `checkpointAndCompact` writes an epoch-fenced, stream-CAS checkpoint and prunes committed events **atomically**, retaining immutable `command_commits` records. The policy and bank-account references can restore indexed checkpoints; legacy snapshots remain excluded.

A checkpoint now also writes a `checkpoint_index_manifests` row with stable SHA-256 of **all command identities and results through the checkpoint version**, their count and ordered version coverage. On recovery, the provider recomputes that digest and rejects a missing, truncated, altered or non-contiguous command index; both checkpoint and manifest were committed in the same SQLite transaction. SQLite `BEFORE UPDATE/DELETE` triggers prevent ordinary alteration or pruning of committed command records. This is integrity against accidental writes or missing rows, **not cryptographic authentication against a malicious database controller** who can drop the triggers and rewrite all tables.

Recovery has two independent bounds: `maxReplayEvents` (default 65,536) for the uncompacted journal suffix, and `maxIndexedCommands` (default 262,144) for the full retained command-history integrity scan. These bounds deliberately fail closed; a scalable production system will require a reviewed Merkle/incremental index or durable archive before those limits are exceeded. The manifest is not a replacement for an explicit durable dedupe-retention policy. Checkpoints written by earlier draft schema versions without a manifest fail `COMMAND_INDEX_MANIFEST_REQUIRED` pending a safe migration; do not manufacture one without verifying historical data.

**Required test command on an authorized exact-SHA runner:**

```sh
node --version
node --disable-warning=ExperimentalWarning --test reference/persistence-sidecar/*.test.mjs
```

The 7 new `event-sourcing-sigkill.sqlite.test.mjs` cases spawn actual Node child processes against the real SQLite WAL/FULL provider and kill them at admission-only, committed-before-ACK, checkpoint-committed, checkpoint-tail-committed-before-ACK, rollback-after-trigger-abort, second-event-insert rollback, and **inside an open checkpoint transaction** using a `node:sqlite` registered function called by an `events` DELETE trigger. The last scenario must leave neither an uncommitted checkpoint nor a manifest and must preserve the prior journal after SQLite recovery. This is **process termination, not electrical power-loss testing**.

As of this draft, targeted SQLite test files contain 21 checkpoint/manifest, 14 command transaction, 5 policy bridge, 7 bank, and 7 SIGKILL scenarios (**54 checked-in cases**), in addition to other existing host regression tests. **These 54 scenarios do not have an exact-head CI execution result.** The source-org Actions jobs fail before checkout/any job steps; this is not established as a test failure or proven billing exhaustion. A separate local Node 22.16 SQL probe independently verified 7 manifest/trigger/transaction assertions and 3 in-flight-SIGKILL SQLite rollback assertions, but did **not** execute these repository files. No compiled AttoLang code, trusted distributed fencing or async actor-lane I/O has been executed.

A full exact-commit runner log with positive job steps and recorded tree/blob identity is mandatory before merge. No cross-organization private-source mirror without explicit destination-bound approval and SHA receipts.
