# Opto Sync scoped replication — Oreslang parity candidate

This is a **semantic oracle only**, not a compiled Oreslang library, deployed Opto Sync SDK, or backend parity certificate. The 12-case contract in `contracts/opto-sync-scoped-v1.json` models a fixed record-ID scope, commit-ordered checkpoints, deletes, stale revisions, skipped unrelated commits, and a pending local mutation overlay. The pure Node test in `tests/opto-sync-scoped-contract.test.mjs` evaluates these rules.

## Pure Oreslang guest candidate

`fixtures/opto-sync-scoped-v1/scoped_sync_admission.ores` is the
initial deterministic language-native admission core. The companion
`scoped_sync_guest_contract.ores` checks positive/negative cases for
checkpoint boundaries, event ordering, tombstone revisions and session
generation. Four snake_case functions have no I/O, heap allocation,
network capability or access to the existing JavaScript oracle.
**These guest files are authored but have not been compiled and executed
on any backend in this PR**.

The guest fixture is intentionally stronger than stage-0 Cranelift
and .NET frontends: typed booleans, multiple functions, conditional
branches and imports must be implemented on those toolchains instead
of silently replacing it with scalar arithmetic. A backend that does
not compile the *same source* must report UNSUPPORTED, not PASS.

## Required real backend gates

The same Oreslang source, with frozen source SHA and inputs/expected outputs, must be compiled and **executed**, not merely parsed, using independent source-commit-pinned toolchains. The target set is **Java/GraalVM, LLVM native, Wasm, Cranelift, .NET Native AOT**. Cranelift is distinct from Forge and may not be substituted. For each backend, require a recorded source commit/tree, compiler binary fingerprint, guest artifact fingerprint, executed CI job/steps, clean subprocess outcome, and per-vector guest result. Reject any skipped, pending, fake, zero-step, host-only, or stale fixture report. Validate a negative case on every toolchain.

### Known gaps at this baseline

- **Java:** richer runtime, but production Opto Sync dependency/integration, durable queues and HTTP client behavior are not certified by these vectors.
- **LLVM:** native scalar / sums and selected runtime features; a complete Oreslang Opto Sync app with networking/persistence is not certified.
- **Wasm:** current zero-import module host intentionally cannot import HTTP, IndexedDB, SQLite or network; require a reviewed host capability/ABI before attempting full sync.
- **Cranelift:** stage-0 scalar JIT rejects imported modules, records, classes, actors, ownership and I/O. Cannot run this feature yet.
- **.NET:** stage-0 scalar Native AOT rejects general functions, variables, records, actors, persistence and async I/O. Cannot run this feature yet.

Do **not** mark five-backend parity achieved from this test, copying fixture JSON into five repos, or running a JavaScript model. Use the contract to guide native implementation and to prevent divergent semantics once backend adapters exist.

## Follow-up test ordering

1. Align the portable Oreslang APIs for `ScopedSubscription`, `ScopeKey`, `Checkpoint`, `SyncChange`, and `PendingMutation`. Prefer explicit `Result`/error types and snake_case callable names; specify cancellation and capability requirements.
2. Implement a **pure, no-I/O** state transition subset in real Oreslang source; compile and run against the supported backend intersection, recording unsupported backend statuses as blockers.
3. Add per-backend indexed/SQLite persistence adapters with atomic row + checkpoint installation and pending write preservation. No fake in-memory durability claims.
4. Add permission-gated HTTP sync adapters only on backends whose runtime capabilities safely support it. WASM must not turn on raw network imports by accident.
5. Execute real PostgreSQL tests for tenant/record authorization, pagination, restart, token expiry, checkpoint reset, deduplication, crash-after-commit and concurrent mutations; compare identical outputs across all actual guest implementations.
6. Admit parity only when exact-head compiler + guest evidence is independently inspected under approved private runner isolation.

This is additive to, not a replacement for, Opto Sync client PR #161 and server PR #67. Neither PR is merged at the time of authoring.

Run the semantic oracle independently with:

    node --test tests/opto-sync-scoped-contract.test.mjs

**Status: candidate-unattested**. Oracle passes alone do not establish backend execution.
