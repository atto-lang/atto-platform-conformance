# Event-sourced actor: bank account v1 — source-free bridge and source-guest release gate

**Status:** DRAFT. This document and `reference/persistence-sidecar/bank-account-reference.mjs` model a typed *command adapter* using the existing `PolicyActorReference` and `BatchPersistenceSidecar`. They do not add a second persistence engine, an AttoLang compiler feature, an asynchronous runtime, or a production distributed durability service. A durable host-only command-index and indexed checkpoint protocol is now implemented in the reference, but is NOT guest-compiled or CI-verified. Source-compiled five-backend event sourcing is **NOT_IMPLEMENTED / NOT_EXECUTED**.

## Why this contract

An actor owns mutable state, yet per-turn isolation is not the same as durable correctness. Every accepted command must be transformed into immutable events, appended under **provider-side epoch fencing and expected stream version CAS**, then applied to actor-private state **only after verified commit**. A queue-admission receipt is never durable success. Crash recovery is `fence → load coherent snapshot/journal → check schema/sequence → replay deterministic reducer → admit commands`.

Use `define actor` and a generic typed base, **not** another `event actor` keyword. Honor snake_case API names and existing `#none`, `#snapshot`, `#event_sourced`, and `#batched_sidecar` selectors. `#batched_sidecar` is orthogonal to journal semantics and durability.

### Proposed guest program (NOT accepted/compiler-tested AttoLang syntax)

```ores
// The typed base, persistence metadata and callbacks still need compiler ratification.
define actor BankAccount extends EventSourcedActor<AccountState, AccountCommand, AccountEvent> as
  decide(rt borrow AccountState state, AccountCommand cmd) -> Result<Array<AccountEvent>, Error> ::
    return bank_decide(state, cmd);
  end
  apply_event(AccountState state, AccountEvent e) -> AccountState ::
    return bank_reduce(state, e);
  end
  get_balance() -> int ::
    return self.handle_state(critical-read |s| -> s.balance_cents);
  end
end
```

`decide` cannot perform external I/O or modify sealed state. `apply_event` cannot suspend, acquire cross-actor mutable loans, send messages, or perform I/O. The runtime owns `persist_events_async`, generation fencing, commit receipt verification, reducer execution and publication. Owned event bytes must survive a suspended continuation without borrowing the originating actor's arena.

## The source-free host command adapter

`BankAccountCommandReference` accepts strict commands `{kind:'deposit'|'withdraw',amount_cents:positive_safe_integer}` and a stable `opId`. It emits one immutable event per successful command with `command_hash` (canonical command SHA-256), uses the existing `PolicyActorReference.stage_event`/`apply_commit`/`resolve_pending`, and reads past committed op IDs from the fenced journal. It never calls `flush()` internally: the test/host owns the simulated asynchronous completion boundary. It rejects overdrafts, overflows, replay gaps, unknown events, forged ACKs and operation-ID reuse with different commands. `cancel_wait()` cancels only the caller wait and returns `OUTCOME_UNKNOWN`; it retains the pending write until trusted reconciliation, preventing a timeout/cancellation from silently authorizing another command.

**Host-reference retry guarantee (current):** the new SQLite `command_commits` record is durable across epochs and stores stable canonical command hash and result/version independent of an activation-specific `operations.digest`. Indexed `checkpointAndCompact` persists a fenced checkpoint, checks contiguous replay and command coverage, and prunes events in the **same transaction** without deleting command identities. The bank adapter accepts only provider-marked `command_checkpoint_v1` snapshots and rechecks the stored command operation before returning a durable duplicate. Legacy snapshots still fail closed. These are synchronous, trusted-host semantics; they do not establish native compiled AttoLang, distributed fencing, tamper-resistant storage, or indefinite operational retention guarantees.

Also note that rejected business commands are not persisted and so do **not** have a durable negative-result idempotency contract in v1.

## Production protocol gates (some now implemented in host reference only)

1. **Atomic multi-event append:** accept a list of typed events per command; guarantee an all-or-nothing journal transaction, contiguous versions and one command-result/op record. Current sidecar appends one event per operation.
2. **Cross-epoch dedup:** durable immutable `command_hash` independent of epoch/expected_version, plus authoritative result/version/receipt; distinguish original operation digest from stable command identity. Enforce tenant scope and stale-writer fencing *before* returning any committed duplicate receipt. Retain dedup for the advertised retry horizon even after snapshot/compaction.
3. **Async guest bridge:** no synchronous SQLite, network or unbounded replay on an actor scheduler carrier; staged owned bytes, released `critical-write` loans, and resumption only through the actor's existing single-flight execution lane.
4. **Fail-closed recovery:** consistent, provider-fenced read of head/snapshot/events; schema/version/upcaster validation, bounded replay and no partially public state. Stale activation must never publish.
5. **Supervision:** restart only after physical failure cleanup and fencing; `throw`/`raise`/`recover` preserve language semantics; panic/stack overflow goes to supervisor CONTROL. Recovery corruption escalates rather than silently truncating events.
6. **Reliable effects:** transactional outbox in same provider transaction as events and idempotent consumers. Actor turn isolation does not imply exactly-once payments/messages.
7. **Snapshot + compaction:** confirmed snapshot barrier; durable command dedup history independent of pruned events; schema fingerprint/version, atomic migration and retention contract.
8. **Isolation:** host-authenticated tenant, stable logical ActorId, separate epoch, state slot, and op ID; never serialize actor heap pointers, handles or mutable borrows. Maintain bounded entry/byte queues and fairness across thousands of actors.

## Canonical host event vectors

`reference/persistence-sidecar/bank-account-vectors.v1.json` records the command/event hashes and expected integer balances for deposit/withdraw replay, duplicate retry and conflict handling. This is a **host oracle and candidate compiler fixture**, not an accepted `.ores` program or evidence of guest execution. The accompanying Node test verifies the SHA-256 command binding.

## Exact-head evidence gates

| Gate | Requirement | Status at authoring |
| --- | --- | --- |
| ES01 | Real SQLite host `deposit → commit → restart → replay` | Added host test, including child SIGKILL after commit; independent CI execution pending |
| ES02 | Commit before ACK lost; same op ID after epoch2 causes no duplicate | Added host test; not guest proof |
| ES03 | Admission-only loss; pending reconciliation and forged ACK denial | Added host tests; not guest proof |
| ES04 | Overdraw, negative/malformed amount and safe-integer overflow | Added host tests; not guest proof |
| ES05 | Concurrent different actors share one bounded batch | Added SQLite host test; async carrier fairness NOT_EXECUTED |
| ES06 | Snapshot/compaction with durable cross-epoch command index | HOST_REFERENCE_IMPLEMENTED; 14 SQLite tests checked in but **not executed**; guest parity NOT_EXECUTED |
| ES07 | Multi-event atomic command append + per-stream CAS/fencing | HOST_REFERENCE_IMPLEMENTED; 14 command transaction tests checked in, **not executed**; guest parity NOT_EXECUTED |
| ES08 | Canonical `.ores` bank-account source parsed, typed and compiled on Java/Graal | NOT_EXECUTED |
| ES09 | Actual guest actor crash/restart with durable SQLite and supervisor | NOT_EXECUTED |
| ES10 | Same fixture on LLVM, .NET NativeAOT, Wasm and Forge independently | NOT_EXECUTED |
| ES11 | Independent runner logs, exact commit/tree/blobs and security review | NOT_EXECUTED |
| ES12 | No carrier blocking, outbox and snapshot schema migration fault injection | NOT_EXECUTED |

`node --disable-warning=ExperimentalWarning --test reference/persistence-sidecar/bank-account-reference*.test.mjs reference/persistence-sidecar/bank-account-vectors.test.mjs` tests the host reference. `node --disable-warning=ExperimentalWarning --test reference/persistence-sidecar/*.test.mjs` runs the existing broader reference suite. Neither command establishes `.ores` compiler execution. Status must be based on actual logs and commit SHA, not merely checked-in test files, zero-step workflow runs or sidecar host tests.

## Integration dependencies

- [Conformance #227](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/227): durable sidecar RFC and SQLite model.
- [Conformance #231](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/231): typed `#symbol` persistence policies; this change should stack on #231 and be reviewed after parent freshness is reconciled.
- [Java #2282](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2282) and [Java #2304](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2304): host bridge plus commit-gated publication, not source-compiled guest proof.
- [LLVM #1180](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1180): native host provider and actor-arena reference, not compiled guest proof.

**CI and private-source security:** no cross-organization copy of private source without independent exact-destination allowlist authorization, provenance verification, private visibility and cleanup protocol. A zero-step GitHub Actions failure proves neither budget exhaustion nor test success. Keep draft until independently reviewed and executable evidence is recorded.

## P0 provider-owned command transactions (November 10, 2026)

**Implemented as a synchronous host-only SQLite reference in `sidecar.mjs`; not yet integrated into `PolicyActorReference`, `BankAccountCommandReference`, an async carrier, or any compiled AttoLang backend.** The existing persistence sidecar now has `enqueueCommand` and `verifyCommand` in addition to its legacy single-write APIs. Both modes share the same provider database, bounded queue, batch transaction, tenant checks, actor/stateslot namespaces, epoch fencing, and stream-version CAS.

The new `command_commits` table atomically stores immutable canonical command hash, first/last committed event versions, event count, and serialized command result along with all events and the stream head. A command hash is independent of activation epoch and expected version, while the legacy write-attempt digest remains epoch-specific. A stale activation is rejected **before** lookup of a previous successful operation. An existing command ID with different bytes fails `OP_ID_CONFLICT`. `loadFenced` reads fence, head, snapshot and journal under a single `BEGIN IMMEDIATE` transaction.

The new `reference/persistence-sidecar/command-transactions.sqlite.test.mjs` contains 14 **checked-in** SQLite scenarios: all-or-nothing two-event append, lost-ACK cross-epoch dedupe, conflict/stale fencing, CAS denial, trigger-injected second-event rollback, cross-actor batching, queue byte-copy ownership, limits, command-index persistence after deliberately pruning events, legacy event behavior and same-actor ordering. These tests must run on the exact PR commit before they count as execution evidence. The test that deliberately deletes journal events demonstrates only command-index retention; it is **not** permission to replay incomplete history. An indexed snapshot/compaction host implementation is now checked in; independent exact-head tests, schema-upcasting and an authenticated state migration protocol remain pending.

**Release gates remain:** wire this API through sealed-state `EventSourcedActor` command transactions with commit-gated state publication and cross-epoch dedup; add actual provider snapshot retention and compaction; eliminate synchronous disk I/O from actor carriers; verify authoritative tenant/fencing; execute the tests on a trusted runner; compile and execute genuine guest actors on Java, LLVM, .NET, Wasm and Forge. The bank adapter rejects legacy snapshots; only provider-provenanced, command-indexed checkpoints can be restored.

## P0 bank/state bridge follow-up — 2026-11-10

The existing `PolicyActorReference` now stages a logical command with `stage_events(op_id, command_bytes, events, result_bytes)` using the SAME `BatchPersistenceSidecar.enqueueCommand` provider introduced above. It reduces owned event values into a private candidate, never exposes that candidate before a verified commit, and uses `verifyCommand` for both ACK and lost-ACK reconciliation. An already durable duplicate at the low-level policy API returns `RELOAD_REQUIRED`; this is intentional because applying the same events again would be incorrect. The higher-level `BankAccountCommandReference` instead verifies that the recovered actor version and committed journal identity already include the command before returning durable duplicate success.

The bank adapter now submits the canonical `[kind,amount_cents]` bytes as a stable command identity and publishes only after the policy's provider-backed commit check. Duplicate fast paths verify the **current activation epoch**; stale actor incarnations cannot return a cached positive ACK. Bank replay rejects events carrying a command SHA-256 that does not match the canonical operation implied by the event, not merely an arbitrary 64-character hex token. The existing memory-only fake remains for legacy host tests, but SQLite integration takes the new command path. Legacy snapshot restore remains fail closed; command-indexed checkpoints now have a host reference implementation, pending real SQLite and guest execution.

`policy-command-integration.sqlite.test.mjs` adds 5 checked-in, **not yet exact-head GitHub-executed** provider-policy tests: two-event commit-gated visibility, forged receipt, lost response reconciliation + epoch-2 recovery, reducer exception atomicity, and an actual bank adapter with stale-duplicate fencing. Combined with `command-transactions.sqlite.test.mjs`, this makes **17 new SQLite scenarios** checked into this PR. All source-level guest/async/supervisor gates remain unverified. An isolated in-memory host test double executed 6 smoke checks against the exact GitHub policy source successfully; this is not evidence that real SQLite, Actions CI, or guest compilation ran.

## P0 batch-byte budget hardening

The command path now counts **events + canonical command bytes + durable result bytes** against `maxBatchBytes` both at admission and when selecting a bounded flush. Two additional host SQLite tests reject a single over-budget command and require separate flushes when two individually admitted commands together exceed the aggregate bound. No async carrier or compiled guest validation is implied.


## Indexed checkpoint and compaction implementation — November 10, 2026

**Draft host-only implementation:** `BatchPersistenceSidecar.checkpointAndCompact`, `PolicyActorReference.checkpoint_and_compact`, and `BankAccountCommandReference.checkpoint_and_compact`. The provider uses the same underlying SQLite database and connection as command commits; it does **not** introduce a second storage engine or a new AttoLang actor keyword.

**Atomic correctness:** a single `BEGIN IMMEDIATE` transaction verifies the trusted tenant, activation epoch, exact stream-head CAS, absence of a legacy snapshot, previous checkpoint digest/schema, contiguous journal versions and per-event coverage by the durable `command_commits` table. It then writes a `checkpoints` record and prunes the covered events; a failure before `COMMIT` rolls back **both** operations. No checkpoint can be created from an actor with an unresolved write. Same-version checkpoint retries are permitted only for identical payload bytes.

**Recovery:** `loadFenced` validates the activation epoch, checkpoint version/schema/digest and journal suffix in a coherent provider transaction. The policy actor replays from that checkpoint through subsequent events. The bank adapter validates the snapshot's strict integer state and provenance, reconstructs recent command identities from the remaining journal, and recognizes older identities through provider-verified durable receipts behind the checkpoint barrier. Legacy snapshots remain excluded from this bank protocol.

**Boundedness:** `maxReplayEvents` defaults to 65,536, is configurable between 1 and 65,536, and applies to checkpoint scans and recovery reads. If an actor accumulates more uncheckpointed events than this limit, recovery and destructive compaction fail closed with `REPLAY_LIMIT_EXCEEDED`; operators must proactively checkpoint well before the limit. A checkpoint does not shrink the `command_commits` table. **A production dedup retention/archiving policy is still undefined**, and indiscriminate deletion of durable command identities remains unsafe.

**Security/trust limit:** the snapshot digest detects accidental corruption but is **not an authenticating MAC or external trust root**. The protocol assumes a trusted host-owned state reducer, trusted epoch grants, controlled SQLite writers, and durable SQLite operation records; it does not protect against a malicious database administrator who can rewrite a checkpoint and its digest, nor does it prove the checkpoint's semantic state independently of the trusted actor. A production multi-process/distributed service needs authenticated, monotonic fencing and an independently reviewed storage authority.

**New host SQLite tests:** `reference/persistence-sidecar/checkpoint-compaction.sqlite.test.mjs` contains **14 checked-in scenarios**, covering compaction → restart → old-command retry; repeated snapshots; lost acknowledgements and pending writes; stale epochs and stream CAS; unindexed legacy history; journal gaps; forced transaction rollback during delete; checkpoint digest corruption; schema migration refusal; multi-event state; replay limits; and recovery from a failed second checkpoint. The added SQL/JS files have passed syntax inspection. These exact-GitHub-head tests **have not executed** on Actions, and they do not establish JVM/LLVM guest correctness.

**Host-only supplementary execution:** 18 actor + bank checks executed against the exact committed policy/bank JavaScript with an isolated in-memory sidecar stub; all passed. A separate, locally authored Node 22.16.0 built-in-SQLite contract probe executed five SQL behavior checks, all passed, including durable checkpoint/reopen and rollback when pruning is aborted. Neither is an exact-head execution of `sidecar.mjs` + `checkpoint-compaction.sqlite.test.mjs`; do not count them toward ES06/ES07's GitHub test gate.

**Still required for merge:** true exact-head host-suite execution with positive job steps and logs, independently authorized private runner if appropriate; nonblocking async actor-lane completion; supervisor/epoch authority; stable retained dedup store across deployment upgrades; snapshot-schema migrations and secure persistence provenance; compiled `.ores` event-sourced actors on Java, LLVM, .NET AOT, Wasm and Forge. Keep PR draft.
