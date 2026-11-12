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

## Java selective physical carrier drain integration (2026-11-11)

Java [draft #2884](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2884)
now has a **host-only, point-in-time** `ActorRuntime.httpCarrierQuiescent`
observation under the current actor lifecycle lock. It requires the accepted
mail watermark and physical guest carrier exit, no source receive suspension,
no scheduler work, and no outstanding pending actor operations. This is not a
perpetual actor-idle lease.

For each listener, `NativeHttp.Server` now tracks **every pooled worker
generation associated with its accepted requests**, even when a pool slot
is replaced. A physical observer begins only when the HTTP transport has
stopped, all accepted requests are retired and all per-request completion
Future callbacks have returned. It polls asynchronously using the HTTP
deadline scheduler, with an explicit bounded deadline across the entire
shutdown, including any stuck socket cleanup. A forced close fails unresolved
drain futures exactly once. Listener accept and failure callbacks are
published outside listener and global HTTP runtime monitors; pooled actor
DONE cleanup is handed off to a host cleanup dispatcher.

The existing Java transport still uses the JDK HTTP server. This work does
not establish nonblocking-NIO guest HTTP actor lowering, a full
`requestConcurrency`/`messageConcurrency` runtime quota implementation,
or cross-backend HTTP runtime parity.

**Evidence boundary:** The Java JDK 25/GraalVM tests are authored but
unexecuted until an authorized runner actually starts steps and records
test output. The older diverged #997/#1166 branches were *not* bulk-merged.
Source transfer to alternate private organizations remains denied unless
protected-source governance and independent exact-head approvals satisfy
`docs/security/CI_PRIVATE_SOURCE_MIRRORING.md`.

## Linearizable pooled-worker admission fence and terminal carrier receipt (2026-11-11)

Java [draft #2884](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2884)
now adds `HttpPooledWorkerAdmissionFence` for each reusable HTTP actor generation.
`Handler.worker()` reserves a handoff through the worker's synchronized
admission gate, and every exit path releases that reservation. Once a listener
reaches its physical shutdown barrier, it atomically seals every worker
incarnation historically associated with the listener. A different live
listener sharing the same handler must use a replacement actor, rather than
reusing that sealed incarnation (including while it is stopping).

After all pre-seal HTTP handoffs settle, shutdown requests
`ActorRuntime.gracefulStop` on each sealed generation. This second, actor-level
admission seal blocks new actor messages, processes previously accepted mail,
and requires DONE/physical finalization. Runtime quiescence also checks the
new ActorRef-owned `physicalCarrierExitPending` receipt, which survives
ActorCell map removal and DONE publication until the TurnExecutor's
thread-local carrier authority has actually been cleared. Thus a terminal
callback still executing on the actor's finalization stack cannot be
mistaken for a physically departed carrier.

New test coverage includes an independent JDK test for 64 concurrent worker
reservation races, underflow and sealed-generation replacement; a two-listener
Atto HTTP guest loopback regression requiring a replacement worker; and a
held-DONE-subscriber regression preventing early physical quiescence.

The exact production helper file's Git blob was compiled with **OpenJDK 21** and
an independent local concurrency harness passed **1,100/1,100 checks**,
including 100 rounds of 64 racing virtual threads. This is meaningful
Java helper execution but **not** the full JDK 25/GraalVM JUnit test suite.
The full PR is still DRAFT; no backend runtime parity is certified until
executed exact-head CI is available and reviewed.

## Unpooled physical carrier retirement and cross-listener contention

A further audit of Java draft #2884 found that fresh unpooled actors previously
released their HTTP admission permits when `done().isDone()` published,
before the last `TurnExecutor` return/ThreadLocal exit. The corrected
`State` uses a host-only asynchronous physical-exit observer, records a
distinct `unpooledPhysicalExitObserved` receipt, and only then publishes
request completion. Unpooled DONE callbacks and transfer failure cleanup
are dispatched outside the actor lifecycle lock. The queued observer fails
closed if a reliable exit receipt cannot be established.

The guest HTTP regression now includes an unpooled post-response actor stop
and listener drain test. The shared-pool guest regression repeats four
two-listener runs; after listener A seals its worker generation, listener B
sends 32 concurrent requests, which must all return HTTP 200 through the
replacement generation. A separate JUnit regression races 128 post-seal
reservations across listeners B/C while 48 pre-seal handoff leases remain
held by A. All of these new integration tests remain **NOT_EXECUTED**
while full Java/GraalVM CI is unavailable.

Local OpenJDK 21 compiled a byte-for-byte verified
`HttpPooledWorkerAdmissionFence` Git blob
`89eebb2d2e2ccebb0d6651fe9b1f55477948ba58`.
A standalone, **helper-only** concurrent Java harness passed 2,320
assertions over 40 rounds with 128 post-seal contenders each (5,120
post-seal attempts). This does not validate the HTTP guest/runtime tests.
The Java transport continues to use JDK HttpServer with blocking socket
operations offloaded to virtual threads; the separate
`docs/HTTP_ACTOR_ASYNC_NIO_MIGRATION.md` in Java draft #2884 describes
a future selector-based implementation, not shipped functionality.

## Pooled handler-wide historical generation retirement (November 11, 2026)

Java [draft #2884](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2884)
now includes `HttpPooledWorkerGenerationRegistry`: the handler records **every**
actor it spawned, even if replaced in a pool slot after another listener
sealed that generation. `NativeHttp.close()` previously called `stopPool()`
only on the current `workers[]` slots, potentially missing a live
historical incarnation. The new stop path atomically seals registry admission
under the handler lock and attempts to cancel every live generation,
continuing after individual cancellation failures. Physical retirement removes
generations from the registry only after their handoff lease and carrier exit
have both been observed.

A new exact-source JUnit class covers three-generation retention,
double-registration failure and 32 repeated races with 96 candidate
replacements. **Unexecuted at the source organization's runner.**

Local host-only executable evidence: the Git-blob-verified Java 21 production
registry helper (`2b4661000cc0f1bfcbedb9c9dcb6434cf96a7712`) and the
existing admission gate helper
(`89eebb2d2e2ccebb0d6651fe9b1f55477948ba58`) both compiled
successfully; a separate Java virtual-thread harness executed **7,312
assertions, 100 rounds × 96 contenders**. These checks do not certify full
JDK 25/GraalVM, JUnit, Atto guest HTTP, or five-backend runtime parity.

**Private runner evidence and security gate:** Current Java source
`main` reports `protected:false`, so
`docs/security/CI_PRIVATE_SOURCE_MIRRORING.md` forbids ANY cross-org private
source export. An exact-run alternate private test organization does have
recent source-free job execution (beamscale/bmscl-compiler run 43092108031,
8 steps), but that is neither reviewed authorization for Java #2884 nor
permission to copy its private source. Source transfer remains DENIED;
contract status remains `NOT_CERTIFIED`.
