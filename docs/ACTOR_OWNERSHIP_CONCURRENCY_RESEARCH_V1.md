# Actor, ownership, concurrency and distributed-state research → Oreslang conformance v1

**Status: research-to-test proposal, NOT an implemented language feature or backend certification.**  
**Research snapshot:** 2026-10-31; a curated 200-project GitHub survey, selected for technical relevance rather than stars. It contains research, legacy, reference, and production projects with different licenses and maintenance states.

## Purpose and non-goals

Extract *testable invariants*, not foreign syntax or dependencies, from eight families of open-source systems. Every candidate goes through **research → Oreslang decision → normative contract → positive/negative source fixture → independently executed compiler/guest behavior → trace refinement → backend-specific physical evidence**. No source-free checker, host model, or zero-step workflow may be reported as guest runtime parity.

Do not inherit Rust's `&`/`*` syntax, Pony's type syntax, Erlang's unrestricted message semantics, Orleans' activation behavior, or Akka/Pekko's reentrancy defaults by accident. Preserve Oreslang's no-implicit-conversion, no-operator-overload, eager-evaluation, explicit Future/Option nesting, structured concurrency and AOT goals. No new Python scripts/tools: any new tooling should be Rust-native, consistent with the Java reference repository policy. Before copying third-party code, independently review the repository's license and provenance; studying an algorithm is not authorization to copy its source.

## Survey coverage and implementation destination

| Survey family | Entries | Primary study candidates | Oreslang contract owner / deliverable |
| --- | ---: | --- | --- |
| Rust actor runtimes | 20 | [Ractor](https://github.com/slawlor/ractor), [Kameo](https://github.com/tqwewe/kameo), [Actix](https://github.com/actix/actix), [Elfo](https://github.com/elfo-rs/elfo) | compiler actor-kind admission, bounded typed mailboxes, supervision |
| Rust executors and concurrent collections | 30 | [Tokio](https://github.com/tokio-rs/tokio), [Rayon](https://github.com/rayon-rs/rayon), [Crossbeam](https://github.com/crossbeam-rs/crossbeam), [Mio](https://github.com/tokio-rs/mio) | runtime scheduler, wake queue, I/O, reclamation and fairness |
| Ownership/borrow checking and proof | 25 | [rustc](https://github.com/rust-lang/rust), [Polonius](https://github.com/rust-lang/polonius), [Miri](https://github.com/rust-lang/miri), [Verus](https://github.com/verus-lang/verus), [Kani](https://github.com/model-checking/kani) | frontend CFG ownership, lifetime/region checks, proof witnesses |
| Orleans/.NET/virtual actors | 22 | [Orleans](https://github.com/dotnet/orleans), [Akka.NET](https://github.com/akkadotnet/akka.net), [Proto.Actor .NET](https://github.com/asynkron/protoactor-dotnet), [Durable Task](https://github.com/microsoft/durabletask-dotnet) | tenant-scoped ActorRef identity, activation, deactivation and durable state |
| Erlang/OTP and BEAM | 38 | [OTP](https://github.com/erlang/otp), [Ra](https://github.com/rabbitmq/ra), [Horde](https://github.com/elixir-horde/horde), [GenStage](https://github.com/elixir-lang/gen_stage) | supervisor tree, mail delivery, failures, recovery, bounded demand |
| Scala/Pekko, effects, streams | 20 | [Apache Pekko](https://github.com/apache/pekko), [ZIO](https://github.com/zio/zio), [Cats Effect](https://github.com/typelevel/cats-effect), [FS2](https://github.com/typelevel/fs2) | backpressure, scoped effects, stream cancellation, persistence |
| Other actor/process/state-machine systems | 20 | [Pony](https://github.com/ponylang/ponyc), [CAF](https://github.com/actor-framework/actor-framework), [Ray](https://github.com/ray-project/ray), [XState](https://github.com/statelyai/xstate) | capability isolation, lifecycle, explicit state transitions |
| Model checking, consensus and durable state | 25 | [Loom](https://github.com/tokio-rs/loom), [Shuttle](https://github.com/awslabs/shuttle), [Stateright](https://github.com/stateright/stateright), [TLA+](https://github.com/tlaplus/tlaplus), [Jepsen](https://github.com/jepsen-io/jepsen), [Porcupine](https://github.com/anishathalye/porcupine), [OpenRaft](https://github.com/databendlabs/openraft) | systematic schedule exploration, linearizability, model↔runtime trace refinement |
| **Total** | **200** | **Candidates, not accepted dependencies** | **Evidence-first cross-backend safety** |

The 200 entries are a *research backlog*, not 200 separate implementation features. For each additional candidate, record its distinguishable algorithm/invariant, overlap with an existing accepted source, license, applicable runtime boundary and at least one falsifiable Oreslang test. Dedupe candidates with no distinct lesson.

## Canonical Oreslang invariants to preserve

1. **Single actor writer across suspension.** No second mutable handler turn for the same actor incarnation while the prior logical turn is suspended. Scheduler-wide cross-actor physical overlap is welcome; same-actor overlap is not authorized by increasing global carrier capacity. CONTROL priority selects the next idle dispatch and does not interrupt user DATA already executing.
2. **Physical actor ownership.** An `isolated actor` must own distinct physical state/heap or arena and cannot silently degrade to logical separation within a shared tracing heap. A Truffle Context, .NET logical registry or WASM Worker is not by itself an OS/process sandbox. Trust, heap isolation and sandbox permissions require separately verified claims.
3. **Compile-time borrow safety.** `rt take`, `rt share`, `rt copy` and `rt mut borrow` (along with ordinary `rt borrow`) have checked ownership semantics. Diagnose stale ownership, overlapping mutable loans, moved-use, borrow escape through closures/containers, and hidden aliasing. Runtime probes are defense-in-depth, never substitutes for compile-time checking.
4. **Logical execution, not carrier identity.** Loans, Task/callback permissions and state access are bound to actor incarnation, region, and logical execution. Continuations may resume on different OS threads. No ambient ThreadLocal or raw actor ID alone grants mutable authority.
5. **Generation-fenced lifecycle.** Stale ActorRef, dispatch ticket, timer, callback, I/O completion, durable activation and arena pointer must not regain authority after STOP/restart/hot reload. Logical STOP, cancellation requested, physical Task quiescence and memory retirement are distinct.
6. **Bounded messages with explicit settlement.** Test full queues, reserved CONTROL, producer cancellation, close-vs-send/receive, duplicate settle and false receipt. Ratify close semantics *before* binding any reference queue model as normative. Do not assume `try_receive` and blocking channel `readch` are interchangeable.
7. **Structured failure, priority and fairness.** Scope exit/STOP must await physical descendant quiescence before reclaiming memory. Test supervisor retries, escalation, actor failure and poison/stale generations; specify fairness and hard/soft deadline assumptions rather than promise universal liveness.
8. **Tenant-scoped durable actor identity.** Use (tenant, namespace, object ID) and generation-fenced activation with zero-or-one active owner per identity. Activation/recovery must not grant a new generation access to predecessor's incomplete operations.
9. **AOT and backend honesty.** Java/Graal, LLVM, .NET NativeAOT, Forge, Wasm and JS each need an independent support/physical-security statement. Unsupported constructs fail closed; abstract state-model success cannot grant feature parity.

## First executable cross-backend matrix (candidate fixture IDs)

| ID | Positive and negative cases | Required oracle |
| --- | --- | --- |
| AO01 | Two actors overlap physically; same actor stays single-flight across `await` | actor enter/exit high-water and logical-turn trace |
| AO02 | Pending same-actor continuation, queued user DATA, incoming CONTROL | deterministic dispatch order and non-preemption |
| AO03 | Duplicate wake, stale ticket, STOP→restart→old continuation | generation fence, exactly-once settlement |
| AO04 | Actor-owned allocation at equal logical offsets in two actors | independent physical arenas; no cross-actor alias |
| OW01 | `rt take` then use-after-move | compile-negative diagnostic, never runtime-only failure |
| OW02 | Two overlapping `rt mut borrow` loans / shared-vs-mut conflict | compile-negative with precise source place |
| OW03 | Loan captured in nested closure/container or retained over unsafe suspend | compile-negative; scoped/pinned exception only if independently proved |
| OW04 | Non-Send/Sync capture into detached Task; forged/affine FFI handle | structural derived admission/rejection, not string-based tagging |
| OW05 | Region loan forged or replayed after actor generation change | fail-closed compile and incarnation-bound runtime bridge |
| CH01 | Full DATA queue with reserved CONTROL and competing senders | linearizability witness, resource conservation |
| CH02 | Send-vs-close, receive-vs-cancel, timeout-vs-commit | exactly-one-winner history; independently ratified close policy |
| CH03 | `select` across channels with cancellation and no winner | no lost value, duplicate claim or ghost delivery |
| SC01 | Task cancelled while carrier still executing; parent exits | retained arena until physical child quiescence |
| SC02 | Cooperative yield, deadline and wake storm | bounded queues, no unbounded carrier block, fairness assumptions |
| SU01 | Supervisor stop/restart and late child completion | causal event/epoch ordering and no zombie actor |
| VA01 | Durable ActorRef deactivation/reactivation across tenant boundaries | one fenced activation, tenant isolation, stale generation denied |
| DS01 | Durable operation retry, WAL/snapshot crash/replay and idempotency | monotonic recovery state; no double commit |
| VR01 | Mutate/omit/reorder/forge one recorded event | trace refinement must reject the mutant |

For every fixture, record: source Git blob SHA; target backend commit/tree; compiler executable hash and build provenance; exact command, nonzero executed CI steps and raw logs; runtime trace event schema/version; expected status (compile-negative, runtime-positive, runtime-negative, unsupported); and independent checker verdict. A result like `MODEL_PASS` is **not** `GUEST_PASS`, and an unexecuted run remains `NOT_EXECUTED`.

## Delivery sequence (small independently reviewable changes)

**P0 — do not loosen semantics:** close actor incarnation/state-loan and physical Task-retirement safety issues; keep same-actor parallel turns disabled. Implement compile-negative OW01–OW05 before offering permissive new Task/actor APIs. Take actual Java/Graal and LLVM guest traces for AO01–AO04 and CH01–CH03.

**P1 — deterministic verification:** add a Rust-native schedule/trace explorer (or extend the existing checked harness), seed-based replay, differential runtime event normalization, and counterexample minimization. Keep source-free models independent from runtime instrumentation; require 1+ executable mutation that fails for each checked invariant.

**P2 — durable and distributed actors:** pin virtual ActorRef activation and tenant fencing to actual runtime/physical ownership; add DS01/VA01 crash-recovery cases before claiming Orleans-style functionality. Consensus must be explicit when required; a durable local actor does not automatically imply distributed linearizability.

**P3 — optimization only after semantics:** tune bounded queue throughput, carrier capacity, backpressure, work stealing, region reclamation and memory layout under reproducible workloads. Optimize while preserving the trace equivalence, deadline assumptions and actor single-writer invariant.

## Existing work to extend; do not duplicate

- [Cross-backend exact-head runtime trace refinement #122](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/122) — implementation evidence gate.
- [Formal core/stdlib proof program #150](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/150) — proof levels and six-backend statuses.
- [DATA mailbox linearizability draft #247](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/247) — checker candidate, NOT_EXECUTED on guests.
- [Orleans virtual actor RFC draft #227](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/227) and [Java activation #2271](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/2271).
- [Compiler Send/Sync and region permits #1437](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1437).
- [Java actor physical overlap test #2355](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2355), [LLVM actor physical overlap test #1230](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1230).
- [LLVM actor continuation ledger #1126](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1126).
- [Runner admission issue (Java) #963](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/963) and [LLVM #159](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/159): zero-step runs are neither passing nor failed test executions.

## CI and security constraints

Private exact-tree CI mirroring requires an *approved private destination*, an independent pre-copy authorization check, verified source/destination visibility, commit/tree/blob identity, controlled publication, and a nonzero-step executable receipt. Do not choose a public destination or use the test repo `GITHUB_TOKEN` to checkout a private cross-org source. Follow [private mirror policy](../README.md) and the associated security incident gates. Local/static tests may be reported with their true scope, never as remote CI or guest verification.

**Promotion rule:** a feature is `UNVERIFIED` until matching, source-built, exact-head real .ores compilation and runtime execution (where applicable) is confirmed on that backend. No automatic promotion from research, docs, host shims, model-only outputs, schema-valid self-reports, or unavailable CI runners.
