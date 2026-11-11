# AttoLang HTTP actor concurrency and shutdown — read-only acceptance gate

Status: **NOT_CERTIFIED**. This is an authored source-level contract with a Node structural test. Its tests cannot prove that a compiler lowered an HTTP actor, that sockets were opened, or that shutdown was physically quiescent.

The five required backends are Java/GraalVM, LLVM, Wasm, Forge and .NET Native AOT. The RESTful demo is an additional unchanged end-to-end guest. The existing native HTTP contract in `contracts/http-native-v1.json` includes Cranelift rather than Forge; the two inventories must not be conflated.

## Contract

- `define serial http actor` normalizes to an HTTP actor with immutable `requestConcurrency=1`, `messageConcurrency=1` metadata, identical to the explicit declaration.
- `requestConcurrency` counts outstanding request lifetimes. `messageConcurrency` counts message lifetimes per request. These are not OS-thread counts and never authorize two simultaneous physical guest turns in one actor incarnation.
- Invalid, duplicate, nonliteral or unsupported >1 configurations fail closed; source HTTP actors without an installed transport adapter cannot silently fall back to ordinary mailboxes.
- Suspend/cancel/retry must maintain exact admission ownership, sealed actor-state exclusivity and generation-fenced exchange claims.
- **Graceful shutdown is two-phase:** stop admitting **new requests** while existing admitted requests retain permission to finish bounded messages. A later forced stop seals **both** request and message admission and cancels logical leftovers; no active physical turn may be retired early.
- Successful shutdown means no new request admissions **and** completion/cancellation of accepted exchanges **and** physical carrier/continuation quiescence. A completed HTTP response or mailbox drain alone is insufficient. Timeout must be explicitly reported; hanging in-flight requests need deadlines or explicit forced termination.

## Minimal first real execution gate

1. On the **exact Java source PR head**, run parser/TypeChecker and annotation/tree-shaker tests for alias equivalence, invalid (0/negative/duplicate) fields, 3×4 fail-closed, and unbound transport spawn rejection.
2. Compile an unchanged guest with `define serial http actor` and exercise real ephemeral-loopback HTTP with two simultaneous requests, one suspended handler, cancellation, and a shutdown barrier held beyond response/mailbox completion. Record raw output and distinguish compiler execution from host test scaffolding.
3. Repeat the same guest source on LLVM, Wasm, Forge, and .NET. Until guest lowering exists, require executed compiler-owned **negative** diagnostics; those do not count as behavioral parity.
4. Exercise the existing REST demo's real request/persistence/restart flow against its exact pinned Java compiler. Its current `http.listen(..., 1, ...)` + fresh per-request actors are not by themselves proof of the new `serial http actor` lowering.

## Required provenance

For any promoted case, independently corroborate exact source SHA and tree/blob identity, compiler binary/artifact digest, actual GitHub run and job links, nonempty successful test steps on an allocated runner, raw compiled guest and socket traces, native AOT or JIT profile, and independent reviewer attribution. A synthetic receipt, host-only unit test, source file, skipped test or zero-step failure **cannot** promote the status.

Context: Java #545/#546 merged parser and fail-closed rules; Java #656 is a separate unbound serial lifetime gate; Java #997/#1166 have draft physical shutdown fixes; LLVM #654 rejects unsupported transport declarations; LLVM #1019 hardens exchange-incarnation ownership; .NET #228 merged a host HTTP provider and validated native host AOT but explicitly did not implement source Spin/HTTP actor compilation. See the links in the JSON registry.

## Audit hardening (2026-11-11)

The executable source-free model now distinguishes graceful request-admission sealing from forceful message cancellation. It authenticates request/message capabilities through exact object identities held in private weak registries; quota, incarnation, admission ledgers and physical turn state are private and caller-shadowing is prevented. A forged getter cannot trigger side effects during token validation. Forced shutdown does not report quiescence before physical carrier exit, and incarnation recycling invalidates all old capability identities.

**Verification boundary:** Eleven committed model test groups passed with a direct V8 adapter, including 10,000 exhaustive four-action sequences covering graceful shutdown, forced stop, cancellation and recycling; the actual `node --test` CI command and compiled `.atto` actor guests still have no executed exact-head evidence. These tests do not establish scheduler fairness, deadline enforcement, fault containment, actual network shutdown or five-backend runtime equivalence.

## Canonical cross-backend source fixture gate (2026-11-11)

Three unchanged .atto files are pinned by exact **Git blob SHA-1** in
`contracts/http-actor-concurrency-lifecycle-v1.json`:

| Source | Git blob SHA-1 | Java expectation | Other four current compiler expectations |
| --- | --- | --- | --- |
| `serial-1x1.atto` | `7564a770934d2374ec5166a353c2c9bb3c383bdf` | Typed/optimized policy = HTTP (1,1) | Explicit unsupported diagnostic; no guest artifact |
| `explicit-1x1.atto` | `d2e5ebaffaaa26bfe6e117aaa8b36a6eb33937e1` | Same policy and class AST as alias | Explicit unsupported diagnostic; no guest artifact |
| `unsupported-3x4.atto` | `6987e72d70ae509522f7e050a494c0aef721a653` | Compiler rejection; never silently narrow to (1,1) | Explicit unsupported diagnostic; no guest artifact |

At the audited branch heads, **18/18 Git blob comparisons matched** across
this repo and Java, LLVM, Wasm, Forge, and .NET. Their locations are recorded
in the JSON registry. These are exact-source inputs and authored acceptance
tests, **not** a report of executed native compiler tests or actor runtime.

The new Java compiler-side regression reads the actual `.atto` test resources
through `OresCompiler.compileForBuild`. LLVM CTest exercises the three
identical files through `oreslang-llvmc` with negative diagnostics. Wasm
checks source preflight and Git blobs, Forge stages identical inputs into its
CTest working directory and drives both independent parsers, and .NET copies
them to its test output and checks both CIL parser entrypoints. Exact-head
CI execution remains mandatory before calling even compiler-negative parity
verified.

A separate draft Java runtime admission seal
[Java #2884](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2884)
publishes close-state visibility and rejects dispatch after observed listener
or runtime closure. It does **not** implement linearizable handoff or physical
carrier exit. Never merge it with Java #997/#1166 without independent
integration review and actual held-carrier shutdown testing.

## Dispatch-handoff cancellation race (2026-11-11)

The admission model now includes `begin_handoff(message_token)` and
`end_handoff(message_token)`, with immutable token identity, private ledger
accessors and explicit `pending_handoffs` snapshot accounting. Once dispatch
starts selecting/attaching a worker, cancellation or transport closure cannot
recycle the original request/message reservation until handoff has reconciled
the actor's physical exit obligation.

The Java draft [#2884](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2884)
applies a focused `dispatchInProgress` lease in production
`NativeHttp.State.release` and binds an unpooled spawned actor to the
exchange before allowing retirement. Its actor-DONE follow-up performs HTTP
release off the actor finalization callback stack. The new JUnit cases exercise
the production release predicate, including an ordered concurrent
timeout-vs-handoff check. **These JUnit tests are not yet executed on a JDK25
runner.**

The source-free model now passes **13/13 test groups** in an isolated
V8 adapter, including 10,000 bounded action sequences. It does not simulate
physical HTTP sockets, VM context leave, entire actor scheduler behavior,
or guarantee that `end_handoff` was called only after the real actor became
quiescent. It is a *non-promoting model contract*, not runtime certification.
