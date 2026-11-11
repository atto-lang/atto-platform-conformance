# AttoLang ↔ Erlang/OTP capability parity — mandatory full AOT (draft v1)

**Status:** proposal and source-free acceptance contract, **NOT guest execution evidence**.
Machine-readable inventory: [`contracts/erlang-otp-full-aot-parity-v1.json`](../contracts/erlang-otp-full-aot-parity-v1.json).

## Non-negotiable runtime constraints

All five backends must compile AttoLang guest code ahead of execution. Java/GraalVM needs a program-specific native-image guest proof, LLVM a linked guest executable, .NET actual NativeAOT output, Wasm a precompiled guest module, and Forge a native AOT artifact. A Java interpreter packaged in a native image, a .NET CLR test, a JS simulation of AttoLang, or a Forge JIT execution alone **cannot count** as full guest AOT parity.

Compiler-generated finite match decision DAGs, closure capture structs, message dispatch tables, actor registration metadata and wire schemas are AOT-compatible. Native dynamic-link loading of **already-compiled, signed, versioned** modules may be supported as a privileged hot-upgrade capability; runtime *guest code generation* and arbitrary dynamic module interpretation are not.

Freeze operator spelling to `eq`, `neq`, and the accepted alias `!eq`. Formatter canonicalizes inequality to `neq`. `eq` is an equality test, **never an Erlang binding/match operator**. No implicit integer/float equality promotions. The parser must not silently reinterpret Erlang's `=:=`, `=/=`, `==` or `!=` as new AttoLang operators. Preserve the currently ratified AttoLang logical operators rather than changing conjunction syntax in this roadmap.

**Legacy migration conflict:** The pinned [guard-v1 canonical scalar fixture](../fixtures/guard-v1/canonical-scalar.atto) currently uses `x != 5`. This is a discovered contradiction in a prior fixture, **not confirmation that this is canonical AttoLang**. A migration PR must fix the source and atomically update the fixture blob pin in `contracts/guard-v1.json`, its test pin in `tests/guard-v1-proof.test.mjs`, and any mirrored exact-blob references. Until then, this parity inventory cannot promote the operator lane.

## What proceeds now

- **P0 language:** static structural patterns in `match ... over` / `on` / `default`, pure `when` guards, typed binary/bit patterns, compile-time capture types for closures, `Option`/`Result` and Error discipline.
- **P0 actors:** typed `spawn` and message sending, selective mailbox matching (not channel `select`), bounded and ordered delivery, timeout/cancel, monitor/link/DOWN, process registration, actor generations, reduction budgeting and nonreentrant execution.
- **P0 OTP supervision:** `one_for_one`, `one_for_all`, `rest_for_one`; child specifications, termination/restart windows, ordered restart policies, parent/supervisor crash escalation and quarantine.
- **P1 guest standard library:** typed actor base abstractions equivalent to gen_server/gen_statem, application lifecycle, timer, ETS-like tables, DETS-like storage, structured logging and observer tooling, authenticated RPC/distribution, precompiled hot upgrades, checked host/FFI.
- **P2:** opt-in explicit `Term` tagged union, BigInt, distributed transactions, generic ordering.
- **Deferred:** repeated function-head clause matching. It is feasible via static decision DAGs, but requires collision/overlap handling, exhaustiveness, closed dispatch, ownership-aware clause exits and independent native AOT proof. Ordinary static `match` remains P0 and is not deferred.

Avoid new syntax where existing language or a typed standard-library abstraction suffices. Guest implementations belong in `.atto` with snake_case callable names; only parsing/type checking/codegen, scheduler, memory-domain or capability primitives belong in host languages.

## Selective receive — normative reference behavior

Use a mailbox-local operation, distinct from channel `select` and distinct from ordinary receive-first:

1. The recipient scans accepted data messages in **admission order**. It chooses the first message matching a statically compiled pattern predicate and guard. Unmatched messages stay in the queue in original relative order, with their ownership and quota preserved.
2. Admission is linearizable. The sender gets `Result` admission status (e.g., Full, Closed, StaleGeneration), **not a processing/durability acknowledgment**. Bound the mailbox including unmatched messages; do not bypass priority CONTROL capacity.
3. Selective scanning must be scheduler-accounted; long scans yield on bounded reductions. Yield, cancellation, timeout or a failed guard cannot consume an unmatched message, leak a borrow or reorder admission. Do not invoke effectful guard code.
4. The actor's generation is pinned at admission. Restart invalidates old incarnation references and pending delivery. **Close cancels and clears queued data** (it does not permit a subsequent selective receive of queued items), while already-consumed in-flight tickets settle physically. Crash recovery and supervisor cleanup settle or revoke outstanding tickets exactly once.
5. For each sender→recipient incarnation pair, preserve admitted message order; distinct senders may interleave. A later matching message may be processed before earlier *unmatched* messages by design. Do not claim global execution FIFO after selective receive.
6. Unknown or stale remote messages are denied or directed through an explicitly versioned dead-letter policy. Timeouts are based on monotonic deadlines; cancellation and timeout choose exactly one terminal outcome.
7. Once a monotonic deadline has won, a pending selective receive must return timed out without a later dequeue. The existing `mailbox-linearizability-v1` checker models dequeue-first, **not selective receive**. Its reference oracle must be extended rather than assumed to prove this behavior.

The accompanying model in `lib/erlang-otp-full-aot-model-v1.mjs` provides a **source-free executable specification** only; it does not implement or prove any compiler backend.

## Supervisor restart semantics

Given declared child order A, B, C, a failure of B produces:

| Strategy | Restart set | Must remain running |
| --- | --- | --- |
| `one_for_one` | B | A, C |
| `one_for_all` | A, B, C | none |
| `rest_for_one` | B, C | A |

For multi-child restart, stop impacted surviving children in **reverse declaration/start order**, wait for cleanup and resource quiescence, then restart in forward declaration order. Restarting changes generation; stale monitor/link/call references cannot attach to the replacement. Supervisor trees require unique child identity, restart intensity windows, process death propagation, bounded control slots, idempotent shutdown and explicit parent-of-supervisor policy. A supervisor must not mutate child actor state directly.

## Binary patterns and AOT lowering

Compile binary pattern segments into checked cursor operations with explicit unsigned/signed width, endian rules, byte/bit offset and bounds checks before any read. Support unaligned bit fields and borrow-only zero-copy views when backing memory remains pinned. Any dynamic segment size must have a statically known integer type and a runtime checked upper bound. Reject ambiguous unbounded widths, overlapping mutability and buffer escape across `await` / `select`; unsuccessful pattern tests must not advance a committed caller cursor.

## Distribution, OTP equivalents and security

Provide typed `ActorRef<T>`, link/monitor contracts, typed service/state-machine actors, application specs, ETS-style tables with ACL/CAS and heir policy, durable local storage, timers, logger, observer and FFI. Require immutable wire schemas and schema-version negotiation for cross-node messages. Remote delivery is best-effort unless a specific durable protocol is used; explicitly model duplicate, delayed, reordered, partitioned, and reincarnated deliveries. Do **not** advertise exactly-once delivery for ordinary messaging. No supervisor/state actor can directly mutate another actor's sealed state.

## Evidence gates

Required per backend and relevant OS/arch: actual AttoLang compiler parse/typecheck; positive `.atto` program; negative program with **no emitted executable output**; compiled guest AOT artifact; guest runtime behavior; race/cancel/failure injection; exact compiler head/tree and unchanged fixture blobs; stepful CI logs; independent review. Source-free Node tests may validate the contract/model but must retain `NOT_EXECUTED` backend state.

Cross-org runners: only use explicitly approved **private** destination carriers and pre-copy authorization. A Git blob SHA verifies identity, **not authorization**. Never move private sources to public repos or treat cross-org GITHUB_TOKEN as implicit source access.
