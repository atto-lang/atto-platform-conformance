# BankAccount event sourcing: canonical guest acceptance v1

Status: **DRAFT / UNEXECUTED native guest.** Stacked on
[persistence modes #231](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/231),
and transitively on [persistence sidecar RFC #227](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/227).

## Deliverables

- `fixtures/event-sourcing/bank-account.atto`: proposed **source guest**
  with typed domain commands and immutable events, explicit
  `EventSourcedActor`, sealed `state { }`, pure decide/apply hooks and
  `match ... over / on / default` syntax. **NOT currently executable**; no
  compiler should pretend to accept unsupported operations.
- `reference/persistence-sidecar/bank-account.sqlite.test.mjs`: real Node 22
  SQLite HOST reference tests for event decisions, commit visibility, replay,
  lost ACK on same epoch, stale epoch and conflicting op ID on fresh epoch,
  multiple actors in one storage batch, and corrupted journal. This tests
  the persistence algorithm, not compiler-generated actor code.
- `contracts/event-sourcing-bank-account-v1.json`: 20 named acceptance gates
  and five independent backend statuses. Every native guest gate remains
  `NOT_EXECUTED`; a checked-in case is not a passing run.
- `reference/persistence-sidecar/bank-account-manifest.test.mjs`:
  source/manifest integrity checks, not native execution.

## Actual end-to-end P0 contract

A real guest test must:
1. Activate the canonical logical ActorId under trusted tenant identity and
   a provider-enforced monotonic epoch, with one sealed state schema.
2. Perform pure `decide` with checked amounts and no side effects, then
   stage owned immutable events and close all critical state loans.
3. Await an asynchronous and bounded provider-side atomic append+operation
   record, without parking the actor's scheduler carrier.
4. Verify the provider receipt and immutable command envelope in a trusted
   runtime. Only then apply committed events, publish state and reply.
5. Inject a real crash after commit and before ACK; on restart, supervisor
   fences the previous epoch, recovers snapshot+contiguous journal, and
   resolves the original operation ID without applying it twice.
6. Prove idempotent cross-epoch command response. Current provider mocks
   reject repeated op IDs on the new epoch with `OP_ID_CONFLICT`—safe
   against duplicate append, but NOT yet successful client retry.
7. Repeat exactly the same fixture and typed outcome trace on Java/Graal,
   LLVM, .NET Native AOT, Wasm and Forge, using source SHA, binary SHA,
   nonzero-step runner logs and host/guest evidence types.

The current host reference deliberately does **not** prove cross-epoch success
receipt reconciliation, atomic multi-event domain commands, outbox delivery,
guest actor parent inheritance, sealed state lowering or crash isolation.
Those remain release-blocking. Production provider trust/tenant fencing must
not come from guest-created objects or guest-supplied ACKs.

Run host checks only:
```sh
node --disable-warning=ExperimentalWarning --test reference/persistence-sidecar/*.test.mjs
```

No private cross-org mirror is authorized by this document. Observe the
mandatory pre-copy allowlist/private publisher gate if source runners cannot
admit jobs. Keep PR draft until exact-head executed tests and security review.
