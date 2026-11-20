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

## Security hardening continuation (2026-10-28)

- The coordinator's live plan, snapshot storage and transition commit are
  private fields/methods, and admitted plan objects are deeply frozen. Caller
  mutation of a returned snapshot cannot alter live coordinator state.
- Run identity and node IDs are restricted to bounded, separator-safe strings,
  preventing ambiguous `run_id/node_id/attempt` intent keys.
- Identical completion receipts delivered under distinct inbox IDs consume their
  deliveries without manufacturing new workflow state transitions or events.
  Conflicting receipt/outcome/tag combinations remain rejected.
- Inbox admission rejects malformed task completions, signal envelopes, and
  cancellation requests before journaling them. Each message is size-bounded,
  the inbox has 256 slots, and the replay receipt ledger is capped at 1,024
  entries. Exhaustion fails closed and must be paired with an authenticated
  durable compaction/epoch protocol before production deployment.
- These are **host-only model safeguards**. The sample string `authority` and
  task `worker` fields do not authenticate an actual actor reference or a human.
  A real workflow engine must bind them to capability-scoped identities.

### Verification classification

- **Local semantic model:** 19/19 source-fetched test functions passed when
  executed in a strict-mode isolated V8 evaluator with deterministic surrogate
  hashing, JSON clone, and byte-length helpers. This is useful for control-flow
  regression checking but does **not** test the exact Node 22 crypto, cloning,
  Buffer or `node:test` runtime. It also does not certify the GitHub Actions
  workflow, actor execution, durable SQL, or backend parity.
- **Exact-head source-org Actions:** runs 40812685124 and 40812680099 both
  returned failed harness jobs with `steps=null`, which is **runner/pre-step
  evidence only**, not a test failure.
- **Alternate-org source-free canaries:** private `akrion-sim/akrion-sim-e2e`
  run 40812378019 and `voxletra/voxletra-e2e` run 40812432820 likewise
  have zero executed steps. No Oreslang source was mirrored.
- **Independent alternate runner admitted:** private
  `honeypot-r-us-test/hnpt-lib-core` run 40812623834 completed real
  source-free Node steps successfully, demonstrating that an alternative
  private runner *can* execute some jobs, not that it is authorized to receive
  this private Oreslang Git tree.

**Private source transfer policy:** the still-open
[`oreslang-platform-conformance#22`](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22)
requires independent review before resuming private-source exports. An exact
blob match and a verified PRIVATE destination are necessary but insufficient.
No cross-organization copy, test-branch source mirror, or protected-main change
was performed in this continuation.

## Native Node 22 exact-source regression gate (2026-10-28)

The same private source-model and test-file bytes now run in the local Node.js
22.16.0 `node --test` harness with the real `node:crypto` SHA-256 implementation
and `structuredClone` (without the earlier surrogate shims).

- Model Git blob: `c58554c865549d20f3539886193c09cbb433040a`.
- Test Git blob: `8091d8f424369a96ed4b9806d00fe93e35b66922`.
- Result: **20/20 host-only tests PASS** under native Node 22.16.0.
- New multi-tenant collision test ensures step/cancel outbox keys use
  `tenant_id/run_id/node_id/attempt`; identical `run_id` values across tenants
  cannot alias a dispatch key in the model.
- The Java source-workflow baseline is staged separately in
  `oreslang-source.java` branch
  `feat/actor-step-source-guest-baseline-20261028`: three sequential
  and two parallel native `.ores` step actors plus a JUnit polyglot executor.
  Java 21 syntax is checked with minimal interface stubs only;
  actual Oreslang guest compiler/runtime execution is **NOT_EXECUTED**.
- This local pass is **not** GitHub-hosted CI or a trusted build provenance
  attestation. Source-org CI has been failing before runner steps and
  cross-org exports still require independent security approval.
