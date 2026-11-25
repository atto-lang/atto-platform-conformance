# Tenant IsolateVM parity v1 — backend-neutral contract

> **Superseded by [tenant isolation v2](TENANT_ISOLATION_V2_SHARED_PROCESS.md)** (2026-11-03).
> Tenants, including hostile ones, now share one OS process with one VM-isolate
> each; a per-tenant process or OS sandbox is no longer required. The text below
> is kept as history and its "process/OS sandbox" requirements no longer apply.

**Status:** executable **source-free reference model** only. No conformance
test here claims an actual `.ores` actor compiled or executed in Java,
LLVM, Wasmtime, .NET, Forge or JavaScript.

Source of truth: [tenant-isolation-v1.json](../contracts/tenant-isolation-v1.json).
Test entry: `node --test tests/tenant-isolation-v1.test.mjs`.
The eleven source-free reference cases currently include separate tenant
state, generation revocation, **independent-root authority rejection even where
tenant ID and numeric generation collide**, bounded admission (including
reserved `.` and `..` tenant-ID rejection), hostile-mode denial, in-flight
quiescence/drain, trap quarantine and **healthy-neighbor progress through a
different tenant's failure and reincarnation**, foreign/replayed lease denial,
and nonreentrant scalar turns even if a tenant's inflight capacity is greater
than one. Passing them alone does **not** prove actor lowering or backend heaps.

## Same semantic requirements across all backends

- One OresVM root authority can admit several **tenant incarnations**.
  Tenant identity binds a bounded tenant ID, monotonic generation and
  unforgeable local handle. Actor handles and resource tokens must also be
  scoped to the tenant incarnation.
- A tenant can host multiple actors; no actor reentrancy across suspension or
  keyed sub-queues. Each actor has its own state, and tenant memory cannot
  alias another tenant's mutable state.
- Created → running → quiescing → stopped → retired. Quiescence revokes new
  admission, but in-flight guest calls, actor turns, loans, mailbox deliveries
  and external resource pins must drain before physical retirement.
- Fatal guest execution failures quarantine the incarnation. After a trap, no
  call can reuse mutable state; a restart generates fresh handles and memory.
- Explicit capacity limits for tenants, actor count, heap, pending/active
  operations and host/runtime overhead. Fuel is not an OS RSS or wall-clock
  limit and cannot prove hard-real-time dispatch guarantees.
- Trust level is a capability contract. A private arena, NativeAOT, a Graal
  Context, Node Worker, or one Wasmtime Store alone must **never** be advertised
  as a fully secure process boundary against hostile native/host code.
- Untrusted tenants must use a validated guest engine **plus** independently
  enforced process/OS security isolation. Unsupported configurations fail
  closed instead of silently switching to shared or trusted mode.
- No cross-tenant raw mutable references, pointers, CLR/Java objects or WASM
  memory exports. Cross-boundary state moves require an explicitly typed
  owned transfer or bounded validated copy.

## Mechanism mapping

| Backend | Native implementation target | Honest current boundary |
|---|---|---|
| Java/GraalVM | Per-tenant isolated Engine/VM heap or dedicated exec worker | Shared contexts/arenas alone not a physical heap sandbox |
| LLVM | Native OresVM per-tenant heap; protected process for hostile code | Trusted-in-process mode is not security containment |
| Wasm | One Wasmtime Store+Instance per native tenant | In-process Wasm execution boundary, not OS sandbox |
| .NET | NativeAOT OresVmHost and broker-owned process workers | Current C# tenant state is logical only |
| Forge | Native actor ownership and future tenant-enforced compartments | Mailbox identity alone is not tenant memory isolation |
| JS | Workers for trusted workloads; process sandbox for hostile Node tenants | Worker is an in-process isolate, not a process boundary |

## Required real-backend promotion gates

Each backend adapter must provide, against one pinned source SHA/tree:
separate mutable-state test; cross-tenant denial; stale-handle/reincarnation;
bounded allocation/admission; native trap/timeout retirement; concurrent
quiescence/drain; denial of implicit host imports/FFI; hostile sandbox denial
where not available; and a tested, separately authenticated artifact admission
path when native AOT artifacts are involved.

**Evidence labels:** `SOURCE_FREE_REFERENCE`, `STATIC_SOURCE_CHECK`,
`BACKEND_NATIVE_EXECUTED`, `REAL_ORESLANG_GUEST_EXECUTED`, and
`NOT_EXECUTED` must not be interchanged. A GitHub Actions run containing zero
executed steps is `NOT_EXECUTED`, irrespective of its conclusion.

Private source may not be mirrored cross-organization merely because another
organization has available CI minutes. Require the source repository's exact
destination/snapshot approval, independent review, protected-policy controls,
and output attestation before any export.
