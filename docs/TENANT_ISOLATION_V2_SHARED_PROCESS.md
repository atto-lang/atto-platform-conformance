# Tenant isolation v2: VM-isolates in one shared process

**Status:** executable **source-free reference model** only. No test here
claims an `.atto`/`.ores` actor compiled or ran on any backend.

Contract: [tenant-isolation-v2.json](../contracts/tenant-isolation-v2.json).
Model: [tenant-isolation-v2.mjs](../src/tenant-isolation-v2.mjs).
Tests: `node --test tests/tenant-isolation-v2.test.mjs`.
Supersedes [v1](TENANT_ISOLATION_BACKEND_PARITY_V1.md).

## Decision (2026-11-03)

Many tenants share one OS process, including external tenants and untrusted
guest code. Each tenant incarnation gets its own **VM-isolate** inside that
process, the way GraalVM isolates work. A per-tenant OS process or OS sandbox
is **not required**. A backend may add one as defense in depth, but it is
never a precondition for admitting a tenant, and it is never claimed unless
it is implemented and tested.

```
OS process
  OresVM root (one authority, fair carrier pool)
    tenant isolate "acme"    private heap, actors, generation, limits
    tenant isolate "globex"  private heap, actors, generation, limits
    ... up to the root's tenant limit
```

## What makes something an isolate

All of these, per tenant:

- **Private heap with an enforced cap.** Accounting alone is not enough.
- **Independent termination.** The host can stop the tenant's running code
  without the guest's cooperation, or through checks the trusted code
  producer inserted. Other tenants and the process keep running. Killing the
  process is not a tenant kill.
- **Its own failure domain.** A trap, out-of-bounds access, stack overflow,
  heap-limit or deadline breach ends that isolate only.
- **Its own identity.** Tenant ID, generation, and a handle that only its
  root VM accepts.
- **Fair scheduling per tenant.** A tenant with many ready actors cannot
  starve a quiet one.

A shared language context, a logical arena, a CLR `AssemblyLoadContext`, or a
Wasm Store without per-tenant kill and memory limits is **not** an isolate.

## The security boundary

The isolate is only as strong as whatever produced the guest code, the same
way Graal's compiler is the boundary for Graal isolates. So:

| Untrusted guest code | Admitted? | Why |
|---|---|---|
| Validated Wasm (lowered, or engine-compiled) | yes | the validator rules out addresses outside the tenant's memory |
| Truffle inside a Graal isolate | yes | Graal isolate heap plus safepoint cancellation |
| Tenant-supplied native code | **no** | it can address anything in the process |
| CIL | **no** | CoreCLR has one process-wide GC heap, no runtime IL verification and no AppDomains |

Trusted tenants may still run CIL or native code, inside an isolate or not.

## Costs we accept

Sharing a process means:

- a bug in the runtime, the Wasm validator, the lowerer or the Graal compiler
  can reach every tenant;
- a crash outside guest code ends every tenant;
- speculative and timing side channels between tenants are not addressed here.

## Per-backend mechanism

| Backend | Isolate | Untrusted guest | Kill | Status |
|---|---|---|---|---|
| Java | Graal polyglot isolate per tenant (Oracle GraalVM) | Truffle | safepoint cancel | draft java#2346 (trusted contexts only) |
| LLVM | TenantVm cage, `cage + u32` addressing | validated Wasm via wasm2c | carrier interrupt | draft llvm#1343 |
| Wasm | Wasmtime Store per tenant | validated Wasm | per-Store flag from epoch callback | draft wasm#173 |
| .NET | TenantVm cage on the shared native core via `TenantVmCApi` | validated Wasm | native carrier interrupt | drafts net#243, llvm#1343 spike |
| Forge, Cranelift | none yet | refused | — | no untrusted path |
| JS | candidate: one Worker (V8 isolate) per tenant, no Node built-ins | validated Wasm | `Worker.terminate()` | not executed |

## What the reference model checks

Admission refuses untrusted tenants without a VM-isolate, untrusted native
code and CIL, isolates without heap and deadline limits, and any request for
a process sandbox the model does not have. Runtime cases: 1000 tenants in one
root with private state; a host kill ends a spinning tenant while its neighbor
keeps working; a turn deadline and a heap limit each end only the offending
tenant, whose heap is discarded; a kill still waits for host-owned resource
loans before stop. The v1 lifecycle, stale-handle, foreign-root, lease and
non-reentrancy cases are kept.

## Promotion gates for a real backend

Against one pinned source SHA/tree, with CI that ran a nonzero number of
steps: separate mutable state; cross-tenant denial; stale handle after
reincarnation; tenant and heap limits enforced; kill of a spinning tenant with
a neighbor making progress; trap, stack overflow and deadline retirement;
quiescence and drain; denial of implicit host imports and FFI; refusal of
untrusted native and CIL code. **Evidence labels** `SOURCE_FREE_REFERENCE`,
`STATIC_SOURCE_CHECK`, `BACKEND_NATIVE_EXECUTED`, `REAL_ORESLANG_GUEST_EXECUTED`
and `NOT_EXECUTED` must not be interchanged. A workflow run with zero executed
steps is `NOT_EXECUTED`, whatever its conclusion.

## Hardening added after the first audits (2026-11-13)

Lessons from the LLVM tenant-VM audit (llvm#1343) and the .NET host audit
(net#243) that apply to every backend:

- **CPU, not wall-clock.** Turn deadlines and fairness count each tenant's own
  CPU time. A wall-clock deadline lets a neighbor crowding the CPU get an
  innocent tenant killed; counting turns let long-turn tenants take about 190
  times the CPU of short-turn ones.
- **Mail byte quotas per tenant and per host**, not only per mailbox. Delivery
  and retirement refund them; a dead isolate returns all of its mail.
- **Host calls validate every guest-controlled argument**, so no guest input can
  fault the host process, and no guest-reachable path takes a process-wide lock.
- **Queued callers are rejected promptly** once a tenant stops admitting work,
  rather than waiting behind a running, possibly spinning, turn.
- **Runtime instrumentation** follows
  [governed instrumentation v1](GOVERNED_INSTRUMENTATION_JIT_V1.md).

The reference model now enforces tenant and host mail byte quotas; the other
items are contract requirements for real backends.
