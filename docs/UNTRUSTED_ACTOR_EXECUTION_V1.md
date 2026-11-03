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

Hostile execution requires a proven guest engine **and** OS/process controls,
not merely a CLR AssemblyLoadContext, Graal Context, Wasm Store, Node worker,
or actor-owned arena. JIT compilation itself consumes bounded host resources;
its compiler pages obey executable-memory protection (W^X or equivalent),
and guest code cannot request writable executable pages. All capabilities are
explicitly brokered. The supervisor must be able to terminate the entire
worker, not depend on forcibly aborting CLR/Java threads. Interruptible fuel,
epoch or bounded safepoint mechanisms reduce latency; they are not a substitute
for a robust worker-kill/retirement path.

### .NET cases

- **AttoLang → CIL → CLR JIT** may run in an independently sandboxed,
  disposable managed worker process (future target); no arbitrary in-process
  CLR thread termination is claimed.
- **AttoLang → Wasm → Wasmtime JIT** may execute under a separately governed
  Wasm engine in a worker process hosted by a NativeAOT application.
- **AttoLang → CIL → NativeAOT** remains a trusted build-time/static path.
  NativeAOT cannot dynamically load and JIT arbitrary CIL assemblies.
- Optional interpreted Wasm and precompiled images remain valid on hosts with
  no JIT entitlement (for example, restricted mobile deployment profiles).

### Backend integration targets

Java/GraalVM: pooled/untrusted guest Engine with supervisor lifecycle and OS
worker security. LLVM: ORC JIT with process boundary rather than arbitrary
native JIT in a shared hostile host process. Wasm: Wasmtime/V8 JIT with
interruptible execution, OS sandboxing, process-wide quotas and genuine actor
lowering. .NET: native-host plus Wasm JIT, or CLR JIT in an OS worker. Forge:
Cranelift JIT in a governed worker. None are marked implemented by this draft.

### Evidence, not assumptions

The reference `assessUntrustedExecution(request, host)` assumes `host` came
from a trusted, authenticated supervisor. It **does not authenticate** any
boolean in that object, restrict OS resources, compile `.atto`, or execute
real actor code. Its only success label is `SOURCE_FREE_MODEL_ADMISSIBLE`,
with `productionCertified: false`. Treat guest-provided host descriptors as
untrusted data. A production implementation must establish controls outside
this model, then run negative tests against real artifacts and processes:
spinning loops, stack overflows, memory exhaustion, JIT budget exhaustion,
forged capabilities, cross-tenant alias attempts, suspend/cancel/retire races,
mailbox backpressure, generation fencing and exact-image mismatches.

Never promote CI with zero executed steps, host-only tests, or fabricated
receipts to real-guest parity. Before private source is copied into any
alternate Actions organization, require explicit destination/snapshot
approval and independent security review; CI budget alone is insufficient.
