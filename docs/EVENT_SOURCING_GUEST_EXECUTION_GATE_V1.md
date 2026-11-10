# Event-sourced actors: P0 guest execution gate (draft)

**Status: HOST REFERENCE HARDENING; native AttoLang guest execution NOT_VERIFIED.**
Companion PRs: conformance #227 / #231, Java #2282 and LLVM #1180.
This document does not define a new actor keyword or claim that the compiler
accepts the illustrative API below.

## Contract

- Continue using `define actor`, optionally extending a typed
  `EventSourcedActor<State, Command, Event>` library base once implemented.
- Select `#event_sourced` for the named event slot. `#batched_sidecar`
  only modifies transport and requires `underlying: #event_sourced`.
- `decide(state, command)` validates business invariants and yields owned,
  serializable immutable events without publishing state.
- `apply_event(state, event)` is deterministic, side-effect-free and free of
  I/O, actor sends, timers, clocks, randomness or external reads. The compiler
  must reject or effect-check prohibited calls, not simply trust this comment.
- Stage owned event bytes after every `critical-read` / `critical-write`
  scope has closed. No loan may cross an `await`, `select`, cancellation
  or sidecar continuation.
- Provider-side epoch fencing, compare-and-swap versioning, operation ID and
  payload fingerprint must be checked and durably committed together.
- A receipt with `admitted` is never a durable command success.
  `OUTCOME_UNKNOWN` requires trusted operation-record reconciliation.
- On startup, install the trusted epoch fence; read one consistent durable
  head/snapshot/event view; validate schema and contiguous versions; replay
  into a fresh actor-owned arena; only then publish READY and accept messages.
- A failed restore leaves the actor QUARANTINED, without partially published
  state. Only its supervisor may authorize a new activation.
- Outbox/inbox and projections are separate APIs; durable actor state does not
  imply exactly-once external effects.

## Executable host-reference milestone

`reference/persistence-sidecar/bank-account-crash.test.mjs` tests:

| Case | Fault | Expected |
| --- | --- | --- |
| ES01 | SIGKILL after committed `deposit-50`, before ACK | version 2 and balance 15000 recovered; retry with old op ID does not double-apply |
| ES02 | SIGKILL after sidecar admits but before flush | event absent after reopen, version 0; safe retry in newly fenced epoch commits once |
| ES03 | Delete committed journal version 1 | restore fails; state remains initial/unpublished |
| ES04 | Overdraft command | reducer rejects before enqueue; no version or state change |
| ES05 | Bounded journal replay and atomic fenced read | malformed, oversized or missing events fail before publication |
| ES06 | Durable operation ledger integrity | missing or mismatched journal operation record refuses replay |

Run with Node 22.16+ (standalone host reference; synchronous SQLite **must
not** execute on an AttoLang actor scheduler carrier):

```sh
node --disable-warning=ExperimentalWarning --test reference/persistence-sidecar/*.test.mjs
```

The reference now reads fenced journal state in one SQLite read transaction
and streams validated rows with limits of 10,000 events, 16 MiB aggregate replay,
and 1 MiB per event/snapshot. These are conservative reference defaults.
The host reference cannot prove actual power-loss durability or distributed
epoch authority.

## P0 release gate: actual .ores source compiler + actor runtime

1. Compile a **real** event-sourced bank actor guest with the native language
   parser, typechecker, lowering and runtime. Do not substitute a Java actor
   host fixture or a Node model for an executed source guest.
2. Prove compile-fail fixtures: direct sealed state mutation, loan escaping a
   critical scope, awaiting storage inside critical-write, nonserializable
   event, and impure event reducer.
3. Run actual provider-backed actor turns: stage event, await durable commit
   without carrier parking, publish state, stop the actor, restart in a new
   arena and deterministically replay events.
4. Kill the **process** after durable commit before ACK and before flush, reopen
   real storage, reconcile exact op identity and ensure no double-apply.
5. Prove that stale epochs, forged ACKs, corrupt/reordered journals,
   duplicate commands and out-of-order versions fail closed.
6. Execute on Java/GraalVM first, then LLVM, .NET Native AOT, Wasm and Forge
   independently; optional Cranelift is separate from Forge.
7. Record exact PR head, source/tree SHA, compiler binaries, workflow/run/job
   IDs, full raw steps and PASS/FAIL/NOT_EXECUTED per backend. Runner-zero-step,
   host-only and parser-only checks are never source-guest certification.

**Current certification:** ES01–ES06 are authored host reference assertions,
not yet runner-executed on this exact new branch. Every native .ores guest gate
above remains **NOT_EXECUTED / NOT_CERTIFIED**.

## Security of CI promotion

No copy of private source to an alternate organization is authorized merely by
lack of Actions minutes. Before any such mirror: destination-specific pre-copy
authorization, validated private visibility, minimal permissions, exact tree
and per-blob SHA verification, and stepful job logs are required. Never merge
the P0 guest gate on the strength of source-free or host-only evidence.

## November 10, 2026: alternate-runner admission, no private-source export

Private carrier `atto-lang/atto-compilers-parity-testing` draft PR #12 executed
[run 42903999229](https://github.com/atto-lang/atto-compilers-parity-testing/actions/runs/42903999229).
All **five** job steps succeeded; the self-contained synthetic Node 22.16
SQLite WAL/FULL crash/reopen canary printed `PASS synthetic SQLite before/after
SIGKILL: 3 checks`. The workflow has no checkout and `permissions: {}`;
**no private repository source was copied**.

This validates *only* alternate-runner admission and the independently written
test mechanism, not this repository's exact test or any backend compiler.
Exact-head conformance source workflow run #42903555083 completed with zero
executed job steps, so its SQLite suite remains **NOT_EXECUTED**. This symptom
does not by itself establish Actions budget exhaustion.

The Java source private-CI destination policy does not approve this carrier;
source security draft #2694 documents independent approval and deny-all
requirements. Cross-organization mirroring remains **DENIED** until approved
destination identity, private visibility, exact-tree SHA and per-blob proof
are satisfied. No alternative test success may override this gate.
