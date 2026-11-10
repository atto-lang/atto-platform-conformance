# Long-running AttoLang actor graphs — conformance v1

Status: **host-oracle tests and normative requirements only, NOT guest execution**.
This branch adds a deterministic 10,000-item bounded DAG model and exercises
ActorGroup pub/sub policies. No backend is certified by these tests.

## Separation of responsibilities

- `io.in` and `io.out` are actor-scoped bounded *logical stream ports*;
  they are not process stdin/stdout and do not implicitly deliver actor mail.
  Input EOF means closed **and drained**. Half-close is not actor STOP.
- `ActorRef.send` admits a typed addressed DATA message to one actor mailbox;
  admission is not processing or durability. No implicit stdout routing.
- `ActorGroup` joins grant cooperation and topic access, not lifecycle
  ownership. A member may belong to multiple groups. A group's close
  cannot stop a member owned by a different supervisor.
- `ActorEventBus` is bounded pub/sub, not an ordinary actor mailbox.
  `RELIABLE` must use bounded backpressure rather than unbounded staging;
  `LATEST` replaces unread data under an explicit coalescing policy.
- Only a lifecycle supervisor can restart/terminate its owned actor.
  Supervisor CONTROL never carries pipeline DATA and is independently
  reserved even under mailbox saturation.
- A typed actor `pipe` forwards through an authenticated directed port.
  Cycles require explicit, typed, bounded feedback, epoch fencing and
  termination detection. Ordinary linear `pipe` must not silently form loops.

## Included runnable host checks

`node --test tests/actor-graph-v1.test.mjs`

The host oracle simulates a single source, two partition workers, a sink,
bounded queues of capacity 4, a deliberately slow sink, and one worker
restart at work ID 7. The expected result for 1..10000 with `x*x+1`
is `333383345000`. It asserts exact work identity, a single restart,
old-generation denial, bounded queues, throughput completion and LATEST
coalescing. Additional cases vary queue capacity and failure position.

The ActorGroup model separately checks RELIABLE publication rollback on
capacity exhaustion, LATEST coalescing, multi-group independence, stale
incarnation rejection, and group close. These are **host-only models**
and cannot establish real scheduling, actor heap isolation, end-to-end
supersession, actual supervisor CONTROL transport or future liveness.

## Required real compiled-guest gates

1. **G0 — source admission:** actual compiler parses and type-checks
   `define ... pipe actor`, typed `self.forward`, group membership,
   streams and supervisor authority; unsupported syntax rejects before IR.
2. **G1 — three-actor pipeline:** source, transform and sink compile as
   real guest actors, connect atomically, and emit one independently captured
   checksum plus final `get_done` barriers. No host-authored outputs.
3. **G2 — fork/join:** two parallel workers, deterministic partitioning,
   stable fan-in, per-edge bounded queue occupancy, serialization/ownership
   validation and no duplicate work commitment.
4. **G3 — pub/sub:** same actor joins two groups and receives subscribed
   progress while ordinary mailbox traffic stays independent; leaving
   one group preserves the other.
5. **G4 — failure/restart:** kill the middle stage mid-flight, prove
   CONTROL notice and physical teardown, fence stale stream/mailbox ports,
   reissue bounded pending work under a declared idempotent retry policy.
6. **G5 — long-running stress:** 10k/100k tasks followed by longer soak,
   constrained heap/CPU budgets, scheduler fairness, idle carrier release,
   bounded subscriber bytes, cancellation, EOF and shutdown races.
7. **G6 — process adapter and isolation:** a trusted descriptor owner
   bridges OS stdin/stdout only by explicit typed ports, and negative
   fixtures reject unauthorized stdout, cross-tenant actor references,
   private-to-SHARED event bus aliases and forged group membership.

Every execution result must bind exact Git source tree, fixture Git blob,
compiler build, executable digest, run/job/step IDs and physical runner.
Source-only tests, zero-step Actions, synthetic traces, host models,
and unverified shadow carriers always remain `NOT_EXECUTED` or
`NOT_CERTIFIED`.

## Backend priorities

- **Java/GraalVM:** compile the already designed typed pipeline and
  source ActorGroup/supervisor APIs, run JUnit plus executed guest fixtures.
- **LLVM:** extend existing host pipeline transport/route CTests to actual
  source `pipe` guest execution and a bounded restart/reply trace; run
  GCC/Clang + ASan/UBSan separately from guest claims.
- **.NET NativeAOT:** integrate bounded `ActorIoEnvelope` half-close and
  retirement into lifecycle-owned source lowering; separate external
  bridge read/write ports from runtime ActorRef fencing.
- **Wasm / Forge:** maintain fail-closed compiler admission and add the same
  guest fixtures when compiler/runtime support exists, without promoting
  host-only or parser-only outcomes.

## Related contracts

- `contracts/pipeline/v1/`: typed three-actor chain and trace vocabulary
- `contracts/actor-io-v1.json`: process stdio / implicit actor I/O separation
- `contracts/actor-reliability-v1.json`: supervisor delivery and boundedness
- `fixtures/mailbox-linearizability-v1/`: mailbox stop/race baseline
- `contracts/actor-graph-v1/manifest.json`: new workload inventory and
  deliberately non-certifying backend status
