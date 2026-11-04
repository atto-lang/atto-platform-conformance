# Actor scheduler locality and physical data-layout conformance (host reference v1)

Status: **proposed, source-free oracle**. This document and its Node.js tests DO NOT
implement a native actor scheduler, bind a thread to a CPU, run compiled Oreslang,
provide hard real-time execution, or prove cross-backend parity. This slice
complements the unmerged actor-memory contract (#147) and unified execution
contract (#194). Do not duplicate their ownership or actor-execution authority.

## Non-negotiable invariants

1. One actor turn has **one execution lease** at a time, even if the actor
   migrates. Worker selection never creates authority or changes tenant identity.
   Actor state remains sealed behind `handle_state(critical-read ...)` /
   `handle_state(critical-write ...)` and explicit `rt` ownership boundaries.
2. The four runtime domains are **CONTROL, SHARED_ACTOR, ISOACTOR,
   UNTRUSTED_ACTOR**. The reference model names them
   `control/shared/isolated/untrusted`. No actor may use a carrier from another
   domain; supervisor panic notice and CONTROL admission always outrank DATA.
3. Carrier **reuse is soft**: last eligible carrier, then preferred CPU, then
   qualified last-level-cache group, then known actor-region NUMA node, then
   stable hash across remaining eligible workers. Affinity must never block
   shutdown, failover, quiescence or stealing. Do not bind one physical OS thread
   per logical actor. Cold ready actors get a global decision after at most eight
   familiar DATA picks under the reference policy.
4. CPU eligibility comes from the **effective allowed set**, not a guessed host
   CPU count. On Linux re-read process/thread affinity and cpuset constraints
   before applying optional hard pinning. After affinity or cpuset changes,
   invalidate stale locality hints. A denied/unsupported pin falls back to
   normal eligible OS scheduling; this is *not* hard real-time proof.
5. LLC identity requires qualified topology (package/cache instance or
   verified shared-CPU mask): raw cache index 0 on two packages does not show
   shared cache. Unknown LLC/NUMA never implies sharing. A NUMA hint does not
   grant memory authority or imply allocation-node placement.
6. Runtime-managed worker metadata uses a bounded SoA layout with *per-writer*
   padding where measurements justify it. Keep **single-writer** actor-owned
   hot payloads contiguous in SoA/AoSoA tiles. Padding every element of a
   single-writer SoA wastes cache and can harm performance; pad contended
   counters, queues, and producer/consumer control words instead.
7. AoS, SoA, AoSoA and SoAoS have distinct, checked geometry definitions
   for fields of byte width 1/4/8. Native implementations must enforce
   bounds, alignment, padding, total-byte quota, incarnation/epoch fences and
   zero-copy lease revocation. The reference oracle checks **address geometry**,
   not native allocation, SIMD speed or actual cache-line separation.
8. Scheduler work queues must be bounded. CONTROL must not be run by the
   shared reactor poll callback. A poll callback only enqueues records;
   guest callbacks require an independently admitted actor/Task turn.
9. Do not promote a backend from source-only, host-only or pre-runner
   `steps=[]` evidence. Record exact source/fixture SHA, executed steps,
   toolchain, runtime guest result, ASan/UBSan where applicable and
   measured CPU/cache/NUMA topology.

## Backends: smallest native promotion gates

| Backend | Minimum executable gate |
| --- | --- |
| Java/GraalVM | Exact-head JDK25 JUnit; actor lease + CONTROL-before-DATA; carrier thread reuse; cpuset refresh; Graal native-image actor guest; native region layout and stale-borrow negatives |
| LLVM | C11 real actor scheduler + CTest, GCC/Clang O1/O2 ASan/UBSan, zero-allocation hot turn; allowed-cpuset rejection; no unbounded preemption or actor overlap; measured hard-RT budget separately |
| Wasm | Core-Wasm default remains unpinned, unsupported shared-worker flags fail before guest decode; only claim actor affinity once Worker/Wasmtime isolation, scheduler admission and actual guest tests exist |
| Forge/Cranelift | Native bounded pool/queue and verified actor codegen; same layout geometry, CONTROL and domain isolation; sanitizers; no reliance on LLVM code-path evidence |
| .NET Native AOT | SDK10 managed host tests + actual Native AOT executable; actor scheduling provenance; allowed-CPU eligibility where supported; no managed-array padding or GC guarantee without measurement |

## Runnable reference

`node --test tests/locality-layout-oracle.test.mjs` validates cpuset filtering,
domain restrictions, CPU/LLC/NUMA preference, sticky reuse, cold DATA progress,
4,096-key stable distribution, mixed-width four-layout non-aliasing, tile tails,
quotas and malformed geometry.

It deliberately does **not** call `sched_setaffinity`, run native actor turns,
measure cache misses, or map source `inverted`/ECS syntax to actual backend IR.
Those must be assessed independently; no throughput or cache-thrash reduction
claim follows from a reference oracle.

Related drafts: Java #1773/#2294, LLVM #672/#1186/#1189, Wasm #186,
Forge #147, .NET #257; conformance #147/#194.
References: Linux `sched_setaffinity(2)`, Linux cpuset documentation, and
`/sys/devices/system/cpu/*/cache/index*/shared_cpu_list`.
