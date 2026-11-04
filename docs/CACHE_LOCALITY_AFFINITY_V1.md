# AttoLang/Oreslang CPU/GPU cache-locality contract v1

**Status: portable host policy oracle, not compiler/runtime backend parity.**
`src/cache-locality-oracle.mjs` is a bounded, source-free reference for
placement decisions. It does **not** pin pthreads, place NUMA pages, execute
AttoLang guest programs, launch GPU kernels, or prove lower L1/L2 miss rates.

## Audit findings

- Actor state belongs to the actor, **not a carrier thread**. Only one actor
  turn may execute at a time; state loans retain `critical-read` /
  `critical-write` guards even when a Task resumes on another thread.
  GPU kernels receive checked owned/borrowed buffers, never actor state pointers.
- SoA is appropriate for hot single-column sweeps; AoS for small whole-record
  hot loops, AoSoA for vectorized tiles with measured benefit. Keep cold
  supervisor/metadata fields separate from hot mutable counters. Avoid keeping
  three copies of every layout; every conversion or scratch buffer is budgeted.
- Distinct mutable fields may reside in the same cache line. The oracle's
  `mayShareCacheLine` checks contiguous byte intervals within one allocation.
  For strided views, the caller must provide a **conservative bounding interval**.
  The physical allocation base modulo the line size (`baseRemainder`) must
  be known for a negative sharing result. Unaligned physical bases can make
  logically adjacent 64-byte buckets share the same real line; unknown bases
  conservatively return possible sharing. Distinct allocation labels ALWAYS
  return possible sharing: even matching zero base remainders do not certify
  physical disjointness or prevent aliases. A future allocator-authorized
  provenance and non-overlap proof would be needed to safely refine this.
- LLC labels require nonempty, whitespace-free topology-domain and cache
  components (for example `pkg1/L3:5`). Bare numbers, `/`, empty components
  and malformed separators fail closed. Syntactic qualification does **not**
  verify hardware cache sharing; the trusted host must provide that evidence.
- CPU choice starts with the effective allowed process CPU mask and uses,
  in order, exact preferred CPU, **qualified** shared LLC identity, known NUMA,
  then any allowed CPU. Among equal ranks it prefers low queue depth and a
  previously used lane. Severe (>4 queued turns) skew permits *soft* spill.
  Hard pinning cannot spill and requires separately verified OS binding.
- The reference scans at most 64 eligible carriers per choice, rotates the
  window by a stable actor/task/thread key, and fails closed on invalid
  snapshots. The up-front eligibility filter is O(n); production implementations
  must cache a validated epoch-fenced topology snapshot, not scan thousands
  of carriers on each hot-path task.
- GPU queue preference must match tenant, device identity, generation, active
  status and remaining byte quota. **No CPU fallback.** The provider must
  re-authenticate queue/device/tenant/generation/capacity immediately before
  submission, and hold resource leases until an authenticated physical
  completion fence even through cancellation or device reset.

## Migration targets and required verification

| Backend | Implementation gap | Promotion gate |
| --- | --- | --- |
| Java/GraalVM | Wire placement to actor/Task scheduler, snapshot cpuset and topology epochs | JUnit, actual guest execution, Graal Native Image, CPU binding checks |
| LLVM | Indexed actor-ready queue, bounded NUMA steal, cache-isolated carrier metadata | GCC/Clang sanitizer runs, pthread affinity, real L1D/L2/LLC counters |
| .NET Native AOT | OS-aware CPU binding rather than fictitious ThreadPool pinning | Linux/Windows native AOT, actor serial-entry and cancellation |
| Wasm | Worker-level placement; reject unsupported hard CPU affinity | Real browser/Node Worker and negative admission evidence |
| Forge/Cranelift | Preserve checked admission until native execution proves locality | Exact-head JIT/AOT and scheduler/lease lifecycle tests |

Per-backend *source language* conformance is **not** established by this
reference test. Compile and execute equivalent guest fixtures with real
source SHA, toolchain version, target architecture and stepful CI evidence;
report UNSUPPORTED for platforms that genuinely lack hard CPU pinning or
device providers, rather than simulating a success.

## Measurement gate

Compare equal workloads and warmed-up layouts with real p50/p95/p99,
throughput, cache footprint, migration count, cache-to-cache transfers,
L1D MPKI, **architecture-specific** L2 MPKI, LLC MPKI and NUMA local/remote
page events. A logical lane label and process-wide counters are insufficient
to prove actor-local cache residency. Use LLVM's existing
`scripts/profile_cache_locality.py` for isolated layout/process counters,
but never substitute LLC for L2. GPU evidence requires actual hardware
queue/fence, transfer, device reset and cross-tenant isolation execution.

Run the pure oracle tests with:

```sh
node --test tests/cache-locality-oracle.test.mjs
```

A pass certifies only these JS oracle assertions, not runtime affinity,
performance, Java/LLVM/.NET/Wasm/Forge parity or guest compilation.

## Verified mainline hotspots (November 1, 2026 source inspection)

- Java `ActorAffinityDispatcher.selectLane` scans **all lanes** on a soft
  spill attempt and reads per-lane atomic queue counters. For large carrier
  pools this adds O(lanes) metadata traffic per spill. The correct optimization
  requires measured queue/latency tradeoffs and a cap or topology-local
  candidate selection; the portable 64-slot oracle is not yet wired to Java.
- LLVM `NativeActorScheduler.c` currently scans up to **actor_count**
  under its scheduler mutex in `find_ready` to choose CONTROL/DATA work.
  The scan may be an L1D/L2 working-set and contention bottleneck at high
  actor counts, but no physical miss rate was measured in this audit.
  LLVM ready-bitmap PR #677 was merged; that does **not** prove this
  specific source path stopped scanning, so integrate/index the active
  implementation rather than relying on PR title alone.
- Java topology primitives PR #1773 and local-stealing PR #1486 are still
  **draft**; neither establishes production scheduler wiring or cache wins.
  Native GPU queue-preflight PR #761 was merged, but its checked host
  metadata admission is not a physical GPU launch/affinity guarantee.

No mainline runtime behavior is altered by this conformance PR.
