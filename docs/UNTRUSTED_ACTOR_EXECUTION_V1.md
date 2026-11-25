# AttoLang untrusted actors: JIT/AOT/interpreter policy v1 (candidate)

**Status: design contract and source-free admission model only.** No backend
is certified by this document or its tests. The existing repository names,
ABI names, and `.ores` fixtures remain supported for compatibility; new
AttoLang source uses `.atto` once each backend passes its acceptance gate.

Contract: [`untrusted-actor-execution-v1.json`](../contracts/untrusted-actor-execution-v1.json).
Source-free model: [`untrusted-actor-execution-v1.mjs`](../src/untrusted-actor-execution-v1.mjs).
Test with `node --test tests/untrusted-actor-execution-v1.test.mjs`.

## Semantics

An actor's trust domain, compilation mode, guest format, and runtime security
boundary are **independent** dimensions. An untrusted actor MAY be JIT-compiled,
interpreted, or AOT-compiled. AOT is never proof of isolation; JIT is never
permission to weaken it. The code image must be approved and pinned to one
immutable digest and generation. Actor mutable state and borrowed references
remain isolated and cannot escape across tenant boundaries. Non-reentrant turns,
bounded mailbox/CPU/memory/host overhead, supervisor-owned cancellation and
generation-fenced upgrades are mandatory regardless of machine-code origin.

Tenants share one OS process ([tenant isolation v2](TENANT_ISOLATION_V2_SHARED_PROCESS.md)).
Untrusted execution requires a **per-tenant VM-isolate**: a private heap with an
enforced cap, termination of that one tenant without ending the process, and
its own failure domain. A CLR AssemblyLoadContext, a shared Graal Context, a
Wasm Store without per-tenant kill and memory limits, or an actor-owned arena
is not an isolate. A process or OS sandbox is optional defense in depth; it is
never required and never a substitute for the isolate. Killing the whole
process would end every tenant, so it is not a preemption mechanism.

Only code from a trusted producer is admitted for untrusted tenants: validated
Wasm (lowered or engine-compiled) or Truffle inside a Graal isolate.
Tenant-supplied native code and CIL are refused. JIT compilation itself
consumes bounded host resources; its compiler pages obey executable-memory
protection (W^X or equivalent), and guest code cannot request writable
executable pages. All capabilities are explicitly brokered. Fuel, epoch,
carrier-interrupt or bounded-safepoint mechanisms stop a running guest; no
design may depend on aborting CLR/Java threads.

### .NET cases

- **AttoLang → Wasm → shared native TenantVm core or embedded Wasm JIT** is
  the untrusted path, hosted by a NativeAOT or CoreCLR application in the
  shared process.
- **AttoLang → CIL → CLR JIT or NativeAOT** remains a first-class backend for
  trusted tenants only. Untrusted CIL is refused: CoreCLR has one process-wide
  GC heap, no runtime IL verification, and cannot kill a spinning thread.
- Optional interpreted Wasm and precompiled images remain valid on hosts with
  no JIT entitlement (for example, restricted mobile deployment profiles).

### Backend integration targets

Java/GraalVM: Truffle with Graal JIT inside one Graal isolate per tenant.
LLVM: validated Wasm lowered by wasm2c into a per-tenant cage; tenants never
supply native or ORC-JIT code. Wasm: Wasmtime JIT, one Store per tenant with a
per-Store kill flag and resource limiter. .NET: the shared native core or an
embedded Wasm engine. Forge: no untrusted path until its output routes through
validated Wasm. None are marked implemented by this draft.

### Evidence, not assumptions

The reference `assessUntrustedExecution(request, host)` assumes `host` came
from a trusted, authenticated supervisor. It **does not authenticate** any
boolean in that object, restrict OS resources, compile `.atto`, or execute
real actor code. Its only success label is `SOURCE_FREE_MODEL_ADMISSIBLE`,
with `productionCertified: false`. Treat guest-provided host descriptors as
untrusted data. A production implementation must establish controls outside
this model, then run negative tests against real artifacts and processes:
spinning loops with a neighbor tenant still making progress, stack overflows, memory exhaustion, JIT budget exhaustion,
forged capabilities, cross-tenant alias attempts, suspend/cancel/retire races,
mailbox backpressure, generation fencing and exact-image mismatches.

Never promote CI with zero executed steps, host-only tests, or fabricated
receipts to real-guest parity. Before private source is copied into any
alternate Actions organization, require explicit destination/snapshot
approval and independent security review; CI budget alone is insufficient.
