# Batch 04 — hot actor upgrade, lifecycle and IPC reliability

**Tracking:** 100-task backlog items **31–40**, frozen manifest
`audits/batch-04-actor-lifecycle.json`.

**Status:** one focused Java-source fix in [PR #1471](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1471),
plus source-free executable models and negative tests in this conformance PR.
**No claim of production actor hot reload, authenticated IPC, durable
backpressure, or completed compiler parity is made.**

## Actual source patch: ActorStream get_done safety

Java draft [#1145](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1145)
contains an ActorStream failure observer. If its sibling-termination
`privateDispatcher` rejected submission, it previously directly called
`done.failFromRuntime` while `pendingDone > 0`. That could release a
caller-controlled guest context with other actor stages still running.

Stacked [PR #1471](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1471)
removes that early terminal call, retains a suppressed dispatch rejection on the
original stage failure, and leaves terminal publication behind the
`pendingDone == 0` path. It deliberately does not run a sibling-stop callback
inline on a lifecycle monitor.

**Critical remaining P0:** a rejected dispatch may leave sibling stages running
indefinitely. A bounded runtime-owned, nonparking lifecycle termination lane
with guaranteed shutdown reconciliation is needed before claiming **liveness**.
A never-completed `get_done` is safer than a forged physical-DONE receipt but
is not final acceptance for issue [#1339](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1339).

## Source-free reference contracts

`src/actor-upgrade-ipc-reference.mjs` exposes the following deliberately
non-production models:

- **HotUpgradeGate:** logical actor ID and incarnation stay stable across
  code-only publication; route epoch and code generation advance separately.
  Each DATA turn, await continuation, timer, callback, unwind or FFI borrowed
  frame retains its old-code lease. Freeze bars new DATA admission. Promotion
  is a single-consumer CAS and rejects any live pin, ABI/state/shared-layout/
  capability drift, isolation-placement change, stale generation, or failed
  code digest. Restart increments incarnation; clean close requires no pins.
- **IpcReceiptLedger:** bounded proxy mailbox and distinct transport credits.
  PROXY_ADMITTED is not WORKER_RECEIVED and neither is DONE. Session loss
  after a dispatched or accepted frame makes the result **indeterminate**;
  no automatic replay into a new incarnation. Route-only replacement keeps
  the stable logical message sequence; duplicate, stale or wrong-session
  receipts cannot retire newer work. No real network signature/MAC is modeled.
- **EdgeCreditGate:** bounded FIFO DATA capacity and pending send registrations.
  Caller cancellation before commit revokes the waiter; after commit cannot
  reclaim ownership. STOP cancels waiters, while already-committed frames keep
  their credit until explicit dequeue/retirement. The oracle is not an actual
  awaitable guest Future or a nonblocking OS scheduler implementation.
- **StageDoneGate:** source-free mirror of the physical finalization barrier.
  Rejected termination dispatch never synthesizes a finished sibling; all
  stages **and** all route frames must be retired for DONE or terminal FAILED.
- **WireMemoryLedger:** scratch bytes are reserved **before** encode/decode,
  then atomically changed into retained transport ownership. Rejection
  retains scratch for explicit rollback; abort, dequeue and retirement are
  exact-once. This does not implement runtime-wide or per-actor memory policy.

The reference machines are bounded: pin count 4096, pending IPC messages
4096, actor stage count 1024, route frame count 4096, edge capacity/waiters
4096 each, terminal edge receipts at most 256, and safe-integer overflow
rejection. The abstraction intentionally leaves compiler-generated leases,
source-level actor semantics, OS-level progress and native code unloading to
the actual runtimes.

## Task-by-task release gates

| # | Upstream task | Current finding | Required executable acceptance |
|---|---|---|---|
| 31 | [LLVM #606](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/606) | Native host hot-upgrade model exists in draft #602 | Actual LLVM guest actor turns, await/FFI code pins, native retire and sanitizers |
| 32 | [Common #73](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/73) | Shared hot-reload protocol documented | Signed/digested AOT/JIT load, actor placement, code-only and migration E2E |
| 33 | [LLVM #628](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/628) | Current draft #602 slot already checks exact registry/supervisor authority; direct bound methods reject | Executed exact-head native owner-domain, reuse and cleanup tests |
| 34 | [Java #1343](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1343) | Draft #1270 already keeps route epoch separate from incarnation | Compiled route-vs-restart and stale frame/reply cases |
| 35 | [Java #1342](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1342) | Draft #1270 registers output Future within `routeLock` | Deterministic source-level subscription and upgrade race regression |
| 36 | [Java #1341](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1341) | Draft #1270 already has OPEN/CLAIMED/PUBLISHED/ROLLBACK_PENDING/CLOSED transfer state | Race two actual restore targets; rollback/quiescence/IPC replay tests |
| 37 | [Java #1340](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1340) | Reference edge credits and cancellation test cases implemented here | Actual awaitable source `send_async`, full queue/credit and cancellation integration |
| 38 | [Java #1339](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1339) | **Direct code fix #1471** prevents false DONE on rejected dispatch | Runtime-owned terminal dispatch fallback and physically finalized siblings/frames |
| 39 | [Java #1344](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1344) | Reference two-phase scratch ledger implemented here | Real MessagePack preflight, memory quotas and no OOM overshoot |
| 40 | [Common #79](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/79) | Reference at-most-once proxy/worker DONE receipt ledger implemented here | Network-authenticated receipts, crash/replay source parity on Java/LLVM |

**None of the ten issue release gates has been independently demonstrated as
complete.** Do not close issues based on source-free oracle observations.

## Checked latest draft GitHub artifacts

- Java source [#1471](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1471),
  head `1d62e8378cd8035ad84a6f993478cad8dbb1560b`,
  sampled run [39201771492](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/39201771492)
  concluded failure, sampled jobs `steps:null`.
- Java source [#1270](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1270),
  head `bddf3a6a412d14f40e33431c9c46a7071d66e6eb`,
  sampled run [39200487678](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/39200487678)
  concluded failure, sampled job `steps:null`.
- LLVM [#602](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/602),
  head `c1a5fbf1addcb2a13f269554a15e9a9e94574b05`,
  sampled run [39145446416](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/39145446416)
  concluded failure, sampled jobs `steps:null`.

These job fields mean **actual step execution is unobserved**. They prove
neither compiler failure nor a specific billing/minutes cause.

## Tests and evidence limitations

```sh
node --test tests/actor-upgrade-ipc-reference.test.mjs
node --test tests/batch-04-actor-lifecycle.test.mjs
npm test
```

The Node 22 repository workflow automatically collects both new test modules
when a real worker executes them.

**48/48 source-free test cases passed** under isolated V8 with assertion shims
on the exact fetched files, including 6000 seeded edge-credit transitions, 2000 retired edge tickets, and\na saturated 4096-frame retirement test.
This is **not** a Node `--test` receipt, Java JUnit, Graal Native Image,
LLVM CTest, real cryptographic IPC, or generated guest actor compilation.

## Security and merge order

- Source-org jobs returning `steps:null` are never green gates.
- No private compiler source is sent to any unapproved funded test org. The
  historical incidents [conformance #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22)
  and [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77)
  and protected-main approvals must be resolved before transport.
- Review and run Java [#1145](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1145)
  before stacking/merging [#1471](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1471).
- Implement bounded guaranteed sibling termination outside guest monitors
  (Java #1339), then cross-check lifecycle counts, router frames and source
  native runs before any production ActorStream claim.
- Prove source code leases and transport receipts independently in Java and
  LLVM. Native host-only upgrades and source-free simulations are **not**
  cross-backend release certification.
