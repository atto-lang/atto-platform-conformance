# Actor persistence symbol modes v1 (draft contract)

**Status: PROPOSED / HOST REFERENCE ONLY.** This adds explicit Oreslang `#symbol` selectors to the [persistence sidecar RFC](PERSISTENCE_SIDECARS_RFC.md) and [actor identity v1](ACTOR_IDENTITY_V1.md). It does **not** establish parser/typechecker/codegen or compiled guest support on Java, LLVM, .NET, Wasm or Forge. `spawn` remains an explicitly managed **real actor**; no implicit virtual activation.

## Mode selection

Persisted modes are selected **per named state slot** in trusted actor activation configuration. Defaults are `#none`; selectors are symbols, not strings or new language keywords:

| Selector | State model | ACK contract |
| --- | --- | --- |
| `#none` | Actor arena only. Not serialized; lost on restart. | No persistence ACK. |
| `#snapshot` | Complete serializable owned snapshot, optimistic version/CAS, provider commit. | Commit receipt before durable success. |
| `#event_sourced` | Domain-event append plus pure reducer, restore from snapshot + strictly ordered journal. | Commit receipt before durable success. |
| `#batched_sidecar` | **Transport modifier** requiring `underlying: #snapshot` or `#event_sourced`. Coalesces writes for thousands of actors per tenant shard. | `#admitted` is queue-only; `#committed` waits for provider durability. Default external ACK requirement is `#committed`. |

The existing RFC's `ephemeral`, `snapshot`, `journal`, `batched(snapshot)`, `batched(journal)` map to the four selectors above. `write_through`, `replicated` and `external` remain **distinct provider/durability or integration options**, not additional values of the v1 mode enum. A batched sidecar does not magically create replication or exactly-once effects.

**Illustrative future configuration, not yet accepted .ores syntax:**
```ores
// Activation metadata selects one mode per named state slot.
// class/actor declaration and base type remain unchanged.
// state main: #snapshot
// state history: #batched_sidecar(underlying: #event_sourced, ack: #committed)
define actor Counter extends DurableActor<CounterState> as
  // All reads/writes still require the compiler intrinsic:
  get_count() -> int ::
    return self.handle_state(critical-read |s| -> s.count);
  end
end
```

No `#batched_sidecar` with `#none` or an unspecified underlying mode. No `#admitted` ACK for non-batched committed writes. Changing mode/codec/schema on an existing slot requires a **versioned migration**, not a reinterpretation of stored bytes. Actor key, incarnation ID, state slot name, generation/epoch and operation ID are distinct typed fields; tenant and epoch are granted by trusted host control plane, not guest code.

## Sealed-state + durable transition contract

1. Only `handle_state(critical-read |s| -> ...)` and `handle_state(critical-write |s| -> ...)` admit access to the actor's **in-memory** sealed state. Direct fields, aliases, raw pointer access and state loan escape are compiler errors. `critical-read` is readonly; `critical-write` grants an exclusive, lexical, non-suspending mutable view in its admitted scope.
2. A durable command computes its candidate snapshot or domain events inside its authorized scope, then **drops all state loans** before asynchronously enqueuing owned serialized payload to the sidecar. Do not hold a mutable loan while awaiting storage or carrier resumption.
3. A queued `admitted` receipt is *not* durable success. A durable actor must not publish the new committed version or acknowledge a committed command until provider-confirmed `committed` receipt. `OUTCOME_UNKNOWN` keeps the operation unresolved; inspect/retry by identical operation ID before advancing. No unaudited automatic retry after external effects.
4. Keep one pending state transaction per actor slot in the stage-one adapter. Later pipelining requires proven version reservation, explicit ordering and conflict handling. On CAS conflict, stale epoch, migration or snapshot schema mismatch, fence writes and reload/migrate; never overwrite newer durable state.
5. A `#event_sourced` reducer is deterministic and side-effect-free. Replaying events cannot send messages, perform I/O, issue payments or mutate outside owned actor state. Projections, streams, transactional outbox and idempotent consumers are separate concerns.
6. Actors remain independently supervised. Panic is delivered through supervisor-priority CONTROL and never intercepted by the panicking actor. `get_done()`, ownership, `rt borrow/take/share`, exclusive guest turn lease and actor-local arenas are unaffected.
7. Restoring a durable activation validates provider-side epoch fencing, schema fingerprint, event offsets and tenant permissions. An arena allocation, file descriptor, native pointer, borrow, ActorRef capability or scheduler handle must not be serialized.
8. Strict hard-real-time actor turns cannot block on SQLite/disk/network or run unbounded replay. The host SQLite model uses synchronous I/O **only as a standalone test reference**, never on an Oreslang carrier. Production requires bounded admission and async provider suspension.

## Lost acknowledgements and pending-write reconciliation

A durable actor must not infer a failed write from a missing or rejected caller-supplied receipt. It must preserve the exact `operation_id`, original owned payload digest, `expected_version`, named state slot, tenant and granted `activation_epoch`, then query the **trusted provider-side persisted operation record**. The host reference exposes `resolve_pending()`: a record that matches the original operation and current epoch publishes the committed state; an absent record returns `pending` and retains exclusive pending state. A forged `rejected` receipt is treated as `OUTCOME_UNKNOWN`, not permission to erase the pending write. Retry the original operation ID only after authoritative reconciliation, never generate a new ID for the same attempted effect.

This reference does **not** yet implement safe cancellation/abort of an unresolved operation, a durable actor inbox across runtime crashes, external side-effect deduplication, or provider failover. It deliberately fails closed on these paths. Native async adapters must preserve the operation record and handle unknown outcomes without holding `critical-write` state loans across `await`.

## Executable host reference (not native guest)

- `reference/persistence-sidecar/policy-modes.mjs`: symbol-mode validator, JSON-only owned state encoding, lexical scope model, staged snapshots/events, commit-gated state publication and restore/replay.
- `reference/persistence-sidecar/policy-modes.test.mjs`: standalone in-memory fake storage tests for mode validation, alias rejection, rejection paths and commit gating.
- `reference/persistence-sidecar/policy-modes.sqlite.test.mjs`: real Node 22.16+ SQLite sidecar integration for committed/unflushed restart, journal replay, two-actor batched commits and epoch/serialization rejection.
- `.github/workflows/persistence-sidecar-host-reference.yml`: includes all `*.test.mjs` files, **host tests only**.

```sh
node --disable-warning=ExperimentalWarning --test reference/persistence-sidecar/*.test.mjs
```

Test evidence must separate the locally executed fake-provider model from real SQLite runs and native Oreslang guest execution. Never count zero-step GitHub Actions as implementation tests.

## Mandatory next executable gates

- **SM01–SM04** parser/formatter/typecheck acceptance of exact `#` selector identity and metadata; reject unknown modes or invalid batching configurations (no string `"#snapshot"` equivalence).
- **SM05** compile-time negative tests for direct sealed state access, borrow/alias escape and `await` across critical mutable view.
- **SM06–SM08** genuine Java/Graal source guest snapshot + event writes, killing/restarting actor, verifying provider-committed version and deterministic replay. No host mocks or zero-message actors.
- **SM09–SM10** one sidecar batch serves 1,000+ source actors with bounded bytes, fairness, per-actor ordering and independently verified commit count; stale generation rejects after restart/migration.
- **SM11** one-carrier/two-actor proof: pending async persistence of A does not block B; fault-inject deadline, cancel, `OUTCOME_UNKNOWN`, commit failure and schema migration.
- **SM12** identical positive/negative guest sources for Java, LLVM, .NET Native AOT, Wasm and **Forge independently of Cranelift**. Record exact compiler SHA, branch/tree SHA, runner steps, raw logs and typed PASS/FAIL/UNSUPPORTED/NOT_EXECUTED; unsupported profiles fail closed.

References: [Cloudstate](https://github.com/cloudstateio/cloudstate), [Akka typed persistence](https://doc.akka.io/libraries/akka-core/current/typed/persistence.html), [Cloudstate+Lightbend issue #230](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/230).
