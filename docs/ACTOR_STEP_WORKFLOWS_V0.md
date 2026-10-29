# Actor-native step workflows v0 — source-free reference-model gate

**Status: proposed, host-only oracle; no Oreslang guest compiler/runtime execution.**
This builds upon `oreslang-common-source/docs/DURABLE_WORKFLOW_ACTORS_V0.md` and
`contracts/runtime/durable-actor-snapshot.v0.schema.json`. It does not amend
Oreslang grammar, introduce a `step` keyword, add a PostgreSQL transaction
adapter, or certify any of the five backends.

## Architecture

A `Workflow<In,Out>` actor owns a versioned execution graph. Each `task` node
requests admission of a *child step actor* through a durable outbox intent.
Pure `choice`/`succeed`/`fail` nodes stay within the coordinator; `parallel`
admits bounded child tasks and waits for a join; `wait` suspends until a trusted
signal is admitted. Actor state remains sealed and all external completion
notifications must be passed through a real authenticated actor transport.

This reference model exercises a strict declarative graph, with task workers,
`maxAttempts` (1..5), success/optional error edges, symbolic choice tags,
parallel task branches (2..8), wait signal + authority, and terminal nodes.
It rejects unknown nodes/fields, cycles, orphan nodes, shared branch entries,
invalid retries/targets and graphs beyond 64 nodes. Parallel branch tasks have
no outgoing edge; join emits the deterministic `joined` tag regardless of
completion order. Dynamic loops, typed value flow, compensations/sagas, external
connectors, timers and `map` are deliberately not implemented in v0.

## Evidence / boundary

The model runs entirely within one Node process. Its `enqueue`/`apply` operates
on an isolated copy and simulates one atomic state + inbox + intent commit,
including `crashBeforeCommit`. `activate` increments an epoch and invalidates
old-worker coordinator writes after `freeze`/restore. The snapshot hash detects
accidental mutations of its serialized model record but **is not storage
integrity authentication**; a production adapter must implement the v0
canonical snapshot digest, storage-enforced lease/epoch fencing, explicit
state-schema migration, transactional inbox/outbox/timer commits, and secret
handling. The oracle's simplified sorted-key JSON domain is not claimed as a
full general-purpose RFC 8785 implementation.

`spawn_step_actor` and `cancel_step_actor` are **intents, not executed actions**.
A completion with matching worker/intent/key/receipt is a simulated symbolic
receipt, not cryptographic caller authentication. Actor spawn and remote side
effects have at-least-once execution exposure; logical inbox deduplication
**does not** establish exactly-once third-party effects. The code neither
spawns actors nor guarantees cancellation quiescence. A review signal's string
`authority` is a model placeholder, never permission or credentials.

## Local gate

```sh
node --test tests/actor-step-workflow-model.test.mjs
```

This test covers sequential and branched execution, deterministic parallel
joins, retries and duplicate outcome conflicts, crash-before-commit replay,
lease expiry across restore, snapshot/plan mismatch, owner cancellation intent,
rejection of other tenants/prototype keys/unexpected secret-bearing fields,
and bounded graph admission. No actual backend is invoked.

## Promotion requirements

1. **G0** — review reference semantics + host tests, freeze this graph/envelope
   contract in shared common-source with a machine-readable fixture and an
   independent oracle implementation.
2. **G1** — Java/Graal source-library `Workflow` and `WorkflowStep` typed APIs;
   actual `.ores` actor fixtures compiled, with real actor spawn/supervisor and
   exact-head source/fixture/runtime provenance. Strict `critical-read` /
   `critical-write` state boundaries and Task/Future effect/ownership checks.
3. **G2** — executable transactional persistence (PostgreSQL or equivalent)
   with fencing at the storage layer, durable timer and inbox, outbox
   reconciliation, injected crashes around side effects, replay receipts,
   poison-message handling, authenticated approvals, capability-scoped
   connectors, redacted traces, quotas and compensations.
4. **G3** — common-source exact byte-identical guest fixture run on LLVM,
   .NET Native AOT, WASM and Forge, compared against Java semantics including
   typed errors, cancellation, ownership and supervisor CONTROL. Keep all
   unsupported backend results marked `NOT_EXECUTED` until independently run.

No cross-organization private-source mirroring is authorized by this patch;
source-free model tests do not grant private source transfer authority.
