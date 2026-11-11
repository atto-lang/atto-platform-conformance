# AttoLang event sourcing — transactional recovery and command identity (draft)

**Status: source-free Node/SQLite HOST MODEL; not a compiled AttoLang guest,
production async provider or backend-parity certification.**

## Integration context

This draft is stacked on conformance #666 (which is stacked on #231/#227).
It reconciles the bounded/fenced journal-safety requirements in #664 with
#666's independent atomic multi-event command transaction model. It does
**not** merge #664, modify its head, or claim either of the overlapping PRs
has executed on a source Actions runner.

AttoLang retains `define actor`, sealed actor `state {}`,
`handle_state(critical-read |s| -> ...)` /
`handle_state(critical-write |s| -> ...)`, and snake_case APIs. A typed
`EventSourcedActor<State,Command,Event>` stdlib base remains a proposal.
No additional `event actor` keyword is introduced.

## Storage protocol

1. A supervisor-authorized, stable logical actor ID and tenant are distinct
   from the monotonically increasing activation **epoch**. The epoch fences
   stale writers. Only the trusted host may grant an epoch.
2. One logical command has one stable `opId` and a canonical immutable
   `commandBytes` SHA-256 across restarts. A command may yield multiple
   ordered immutable events, but their append, stream head, command result,
   and durable command index must commit **atomically**.
3. The logical dedupe index `command_commits` outlives journal compaction.
   A duplicate under a *new* valid epoch returns the original result only
   after provider verification; an old epoch is rejected before any lookup.
   The epoch-bound legacy operation ID is **not** a replacement for this index.
4. A provider-confirmed ACK is not enough by itself. Before an actor
   publishes a candidate balance, the reference verifies command hash,
   stream/event-count/version consistency, event contents digest,
   result bytes digest, and a valid snapshot barrier where event payloads
   have been compacted.
5. Journal restore obtains the fence, snapshot, stream head, and bounded
   contiguous post-snapshot events in one SQLite read transaction. It validates
   both legacy `operations` evidence and newer `command_commits` records.
   Replay refuses orphan events, missing events, corrupt indexes, invalid
   BLOBs, schema mismatches and snapshot/journal gaps.
6. The bank actor maintains a private candidate state and publishes it only
   after trusted command evidence. Crashed/unacknowledged outcomes may be
   reconciled using the **same** logical command ID. Await cancellation
   removes a caller wait, never an ambiguous storage operation.

## Limits and schema compatibility

The host reference limits replay to 10,000 events, 16 MiB aggregate, and
1 MiB per event/snapshot. The command index also stores
`events_digest` and `result_digest` (SHA-256). Existing
`command_commits` tables are upgraded additively; pre-upgrade records
without these digests remain `UNVERIFIED_COMMAND_RECORD` and cannot be
returned as durable duplicates. **No automatic silent legacy backfill**:
a separate authenticated migration/verification design is needed to
reactivate any old logical command record safely.

The bank account host adapter is
`reference/persistence-sidecar/bank-account-transactional.mjs`. It uses
the **existing** sidecar `enqueueCommand` / `verifyCommand` API; it is
not a second database, actor runtime, or mutable state sharing mechanism.
The earlier `BankAccountCommandReference` intentionally remains as a
single-event compatibility regression and must not be marketed as the
canonical atomic multi-event implementation.

## Host regression commands (not certified until actually executed)

```sh
node --disable-warning=ExperimentalWarning --test reference/persistence-sidecar/*.test.mjs
```

New suites:
- `transactional-replay-hardening.sqlite.test.mjs`: mixed legacy + command
  replay, corrupt legacy / command ledger, version gap, BLOB limits, snapshot
  barrier, stale epoch, altered event/result hashes and safe compaction.
- `bank-account-transactional.sqlite.test.mjs`: multi-event append,
  commit-gated actor publication, lost ACK + epoch2 retry, forged receipt,
  second-event rollback, snapshot/compaction, corrupt replay, overdraft,
  cross-actor batch isolation and stale incarnation refusal.
- Updated `command-transactions.sqlite.test.mjs`: orphaned command records
  cannot claim durable success after *unauthenticated* event pruning.

**Static parsing of the changed JavaScript files is not a database test.**
The source-org job must run with nonzero executed steps on the exact head.
The separately verified source-free alternate-runner canary [#42903999229]
(https://github.com/atto-lang/atto-compilers-parity-testing/actions/runs/42903999229)
is evidence of the runner's health, **not** of this branch's tests.

## P0 missing integration and evidence

- Implement actual compiler-owned `EventSourcedActor` source lowering,
  borrow/critical-loan gates, pure deterministic reducers, sealed state,
  and compile-negative fixtures. Use typed owned event transfer; no raw
  host database handle or caller-supplied activation authority in guest code.
- Integrate the transactional command journal into Java ActorRuntime's
  asynchronous persistence continuation and fresh-arena recovery.
  Existing Java #2757 exposes an event append but not this atomic
  logical-command API. It remains host-only.
- Prove real guest SIGKILL-before-commit and after-commit/before-ACK;
  add supervisor tree recovery, stable actor identity, activation fences,
  snapshot migration, transactional outbox and fairness.
- Independently run canonical guest tests on Java/GraalVM, LLVM, .NET
  Native AOT, Wasm and Forge and record exact head/tree SHA, executed steps,
  raw results, and explicit PASS/FAIL/NOT_EXECUTED distinctions.
- No private-source copying to an alternate GitHub organization without
  destination-bound independently approved export policy, private visibility,
  source tree and per-blob verification, and protected-main governance.

## Security limitations (must not be hidden)

Node `DatabaseSync` is **synchronous** and only a trusted reference model.
It must never run on an AttoLang actor carrier. Even with WAL/FULL, SIGKILL
tests do not demonstrate power-loss proof against device failure. SHA-256
stored in the same untrusted database as the event is a corruption-detection
mechanism, **not authenticated protection against a compromised provider**.
Distributed coordinator/epoch authority and transactional external effects
are not implemented. Cross-epoch dedupe retention must follow a documented
policy and must not be pruned silently.


## 2026-11-10 snapshot and legacy event proof tightening

Recovery and duplicate receipt paths now demand evidence from the **durable
snapshot operation** before trusting a snapshot or acknowledging a command
whose events were pruned. `snapshots.payload_hash` stores the original
SHA-256 of snapshot bytes; `snapshots.operation_digest` binds the
checkpoint to the durable `operations.digest` entry; and the independent
`operations.payload_hash` must match the checkpoint's payload digest.
Both entries are written in the same SQLite transaction. `loadFenced`,
host `load` and `verifyCommand` read the evidence within their existing
atomic SQLite snapshot transaction.

The legacy single-event replay path also checks every event payload against
`operations.payload_hash`, rather than trusting only a matching op ID and
version. Modifying a syntactically valid event now fails closed before
publication.

An additive migration adds nullable checksum columns when old databases
lack them. **Old snapshots and legacy events without these proofs are
UNVERIFIED, not silently retroactively certified.** A separate separately
approved authenticated migration and negative tests are required before
releasing older persisted data. Treat this as a compatibility/release gate,
not a transparent no-op database migration.

Independent source-free local Node 22 SQLite experiment (5/5) validated
the SQL schema/row and cross-table checksum mechanism for original, changed
BLOB, recomputed payload checksum, missing operation record and Uint8Array
payload behavior. It did **not** execute the exact GitHub sidecar source.
Exact-head source-org Actions remain runner-admission blocked until a job
actually runs steps. The SHA-256 cross-checks help identify tampering or
corruption relative to an independent persisted record but **are not
cryptographically authenticated against an attacker able to rewrite all
database rows**; a trusted provider or authenticated append-only evidence
is required for that threat model.


## 2026-11-10 additional audit: receipts, mixed APIs and admission

The latest adversarial audit identified and patched two separate ways to
report unproven legacy durability:

- A matching legacy `operations` row alone **must never** justify either
  a duplicate response or `verifyCommit`. The reference now checks the
  actual immutable event BLOB + schema + operation ID, or the active
  snapshot's BLOB/schema/operation integrity. Deleted or rewritten event
  data rejects acknowledgement as `INCOMPLETE_OPERATION_LEDGER`.
- The legacy receipt's epoch fence, operation lookup and durable payload
  proof now execute inside one SQLite read transaction (and the duplicate
  path rechecks the epoch within the transaction), preventing a fence
  replacement between authorization and ACK evidence.

Operation IDs are shared across the legacy event/snapshot API and the
new atomic command API in one tenant/actor/stream. Reusing an existing
`opId` across these APIs is always `OP_ID_CONFLICT`; both directions
have negative tests. A payload-size configuration override may never
weaken the immutable 1 MiB per-event/snapshot replay cap or the 16 MiB
per-command event cap. New admission tests enforce that policy.

This round also corrected a static integration defect: the recovery
snapshot SELECT previously did not include `operation_digest` even
though the snapshot-proof helper required it. The field is now selected
in both replay and duplicate-proof queries. New source code passed a
JavaScript syntax parse and GitHub blob readback. The regression tests
remain **NOT_EXECUTED** in source CI; no claims of passing Node SQLite
source tests or compiled AttoLang guest are made.

**Further release blockers**: independently execute exact-source
SQLite/JDBC test suites, validate old-database upgrade/rejection paths,
instrument true process-loss after COMMIT-before-ACK, prove that replay
caps cannot be exceeded before an authenticated checkpoint, and run
compiler-lowered guest actor conformance. A source-free runner's passing
synthetic tests do not authorize private-source mirroring.


## 2026-11-10 P0: reject unrecoverable journals before COMMIT

The host reference now rejects event/command admissions that would push the
**post-checkpoint suffix** over 10,000 events or 16 MiB, regardless of the
configured batch capacity. Usage is counted inside the existing
`BEGIN IMMEDIATE` transaction, so earlier writes from the same batch are
included and an over-limit actor's nondurable
`REPLAY_LIMIT_EXCEEDED` outcome does not prevent an unrelated actor from
committing in the same batch.

A checkpoint is counted only after its original durable snapshot-operation
witness and BLOB/digest checks succeed. Corrupted or future-versioned
snapshots cannot reset event usage to create illusory capacity. A snapshot
write may establish a new barrier after the limit is reached; historical
command IDs are retained for exactly-once deduplication.

The 27-test transactional replay-hardening source file now includes
boundary-specific scenarios for 10,001 events, 16 MiB, mixed-actor batching,
recovery after an authenticated checkpoint and corrupted checkpoint
refusal. A separate two-test migration file seeds a real *old-schema*
database with pre-existing snapshot/command rows, checks the nullable
digest-column upgrades and refuses their uncertified durable receipts.
Neither file has been executed on the exact source head yet.

Independent Node 22 SQLite tests passed 7/7 locally, and the
source-free alternate private
[Actions run #42940311766](https://github.com/atto-lang/atto-compilers-parity-testing/actions/runs/42940311766)
passed seven job steps including the new seven-check replay-capacity probe.
The code was independently authored and does **not** contain, mirror, or
test private repository source. Do not claim full conformance or guest
execution from this result.

Release blockers remain: source-local Actions admission, real Node and
JDBC exact-head execution, historical-data migration protocol,
process-kill before/after COMMIT and before ACK, supervisor fencing,
compiled guest AttoLang actor execution and five-backend parity.


## Crash-boundary subprocess tests (2026-11-10)

The exact Node SQLite reference now includes
`reference/persistence-sidecar/crash-command-child.mjs` and
`crash-command-boundaries.sqlite.test.mjs`. The worker child executes the
**existing** `BatchPersistenceSidecar.flush()` code with deterministic
test-only SIGKILL injection:

1. **Before BEGIN:** no command was admitted to durable SQLite state;
   epoch-two recovery returns an empty stream, then the retry commits once.
2. **Immediately after the first event INSERT:** a connection-local TEMP
   SQLite trigger invokes a test-only native JS function that kills the
   process *before COMMIT*. On reopen, WAL rolls back the first INSERT; no
   partial event/head/command receipt survives; a retry commits once.
3. **After actual SQLite COMMIT, before returning from flush:** a test-only
   wrapper invokes the original `DatabaseSync.exec('COMMIT')`, waits for
   it to return successfully, and kills the child before the caller
   receives a receipt. On reopen under epoch two, the bank account's
   original two immutable events and result survive, the old command ID
   deduplicates without a second append, and an old activation is fenced.

The helper is never imported into production guest code. The parent
requires the child termination signal to equal `SIGKILL` and checks
the journal, head, operation ledger, event payloads, result bytes,
fresh-epoch deduplication and op-ID conflict. This is real **host Node
SQLite transaction-path** testing once executed, but **not** physical
power-loss durability, Java parity, an AOT guest run or cross-backend
conformance.

The exact Node test modules passed static JS syntax parsing. A separate
self-contained local Node 22 SQLite trigger/intercept crash probe executed
successfully: first-insert SIGKILL recovered zero rows; post-COMMIT
SIGKILL recovered both rows. These local probes do **not** constitute
execution of the GitHub source fixtures, which remain unverified until
source-owned Actions admission is restored.


## P0 follow-up: no journal-gap or checkpoint laundering (2026-11-10)

Audit found a subtle trust-boundary bug: `COUNT(*)` and byte totals alone
could make a truncated suffix look as though it still had replay capacity,
and a subsequent snapshot could hide that missing or altered history.
The Node SQLite reference now validates that the post-checkpoint journal
covers exactly `checkpoint+1 .. head`, including `MIN(version)`,
`MAX(version)`, count and byte bounds, before admission. A future event
beyond the state head is rejected; a missing middle row cannot create
artificial spare capacity. The checkpoint itself must match its durable
operation evidence before its version is used as a replay barrier.

Before writing a NEW snapshot, the provider also calls the full verified
legacy/command journal reader **inside the existing `BEGIN IMMEDIATE`**.
The transaction therefore refuses to checkpoint over missing legacy
events, same-length altered events or corrupt multi-event command
digests. New tests seed a fully witnessed 10,000-event journal before
proving a checkpoint reset, and reject replay gaps/altered BLOBs/future
events. The replay-hardening source file declares **30 tests**.

A verified, private **source-free** runner candidate is
`atto-lang/atto-compilers-parity-testing` (repo ID 1448719198).
[Run #42951516578](https://github.com/atto-lang/atto-compilers-parity-testing/actions/runs/42951516578)
and [run #42951509176](https://github.com/atto-lang/atto-compilers-parity-testing/actions/runs/42951509176)
each executed 8 successful no-checkout steps; their synthetic
checkpoint-laundering checks passed 6/6. These runs do **not**
execute the actual source, and never authenticate private-source
export. The source protection and independent review requirements
in security PR #2694 remain hard blocks; exact-source SQLite tests
and compiled guest tests are NOT_EXECUTED.
