# Zero-GC convergence: executable cross-toolchain acceptance v2

**Status (2026-11-11): release-policy / test inventory only. No general-purpose
AttoLang guest zero-GC certification.** This extends, and does **not** weaken,
the immutable `actor_gc_profiles_v1.json` and its 13 proof obligations /
18 admission cases. `contracts/actor_zero_gc_execution_v2.json` is a
source-only target/evidence contract, with all certification arrays empty.

## One language contract, different host collectors

| Toolchain | Required memory goal | Host collector remains? |
| --- | --- | --- |
| `oreslang-source.llvm` | Owned native object/actor regions; drop glue on every exit; no guest tracing collector | No tracing collector in native C/C++ path |
| `oreslang-source.forge` | Owned native actor heap, bounded slots, no tracing collector in emitted native guest | No tracing collector in C++ substrate |
| `oreslang-source.wasm` | Owned, bounded private linear memory and explicit non-GC drops; forbid Wasm GC types in strict profile | **Yes** on Node/JS host; no whole-process zero-GC claim |
| `oreslang-source.java` | Native/off-heap guest payload, deterministic close and *measured* zero/near-zero JVM allocations in admitted actor hot loops | **Yes**, including Graal Native Image unless using a no-collection mode (e.g. Epsilon, which does not reclaim) |
| `oreslang-source.net` | Unmanaged guest payload and numeric-handle native arena; measured zero/near-zero CLR allocations in admitted actor hot loops | **Yes**, including Native AOT |
| Experimental Cranelift | Fail closed until source-actor allocation and drop lowering exists | Not certified; scalar-only |

**Zero-GC must be defined per guest memory domain.** No tracing collector is
not equivalent to no allocations, no leaks, no latency spikes, or guaranteed
reclamation of a `malloc`/C++/Rust allocation. Avoid a universal no-collector
claim for managed hosts.

## Acceptance workload and adversarial tests

1. Allocate one persistent actor-owned root, then **20,000** transient owned
   request values. Each transient performs allocate/write/read/drop, while the
   root survives. Require bounded high-water, correct values, no counter
   double refunds, and zero retained transient bytes.
2. Explicitly remove one object, reuse its physical slot, and retire the
   actor: each still-owned object drops **exactly once in reverse successful
   construction order**, not numeric slot order. Reject stale generations.
3. Reject private arena/control-memory host copy aliases and wrapped spans
   *before* writing/reading private bytes. Failed admissions must preserve
   native data, slots and quotas.
4. Suspend/resume actor work with outstanding loans and FFI/async pins;
   retirement seals new entry before waiting for all leases and callbacks.
   Cancellation, `throw`, `raise`, `panic`, supervisor restart, and hot
   reload must prove exactly-once cleanup of partially initialized/moved
   values on **compiled guest** paths.
5. Build the actual source compiler for the target and link an AOT guest
   application. Verify final artifact SHA, ABI, transitive allocation symbols
   and collector/GC strategy closure. Compile-negative tests must show no
   unsafe IR published on rejection.

For Java/.NET additionally sample **same-thread managed allocations** for a
warmed, *successful* numeric-handle hot loop, plus collector events, live
native bytes and process RSS; keep independent long-lived soak tests to show
whether memory remains bounded. Epsilon Native Image with zero observed
collections can exhaust its managed heap and is **not** proof of a reclaiming,
no-GC application.

For Wasm use a caller-provided read destination in the hot path (no per-read
copy result), bounded non-growing memory, no shared memory/host-import alias,
and independent guest Wasm-GC/reference-type admission negatives. Even with
`initial === maximum`, `WebAssembly.Memory.grow(0)` can detach the cached
ArrayBuffer in Node. A fixed-memory hot-path view must detect this replacement,
refresh once on change, and scrub the current backing at the last lifetime pin
release. Case `ZG-013` makes this a mandatory regression. The JS
host can still allocate and trace.

## Existing active implementation series

| Backend | Implementation PR | Host-only verification status |
| --- | --- | --- |
| LLVM | [#1674](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1674) buffer fencing + [#1688](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1688) deterministic graph drops | Separate exact-blob private carrier native tests passed; not a compiler guest proof |
| Forge | [#265](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/265) arena-copy alias fencing | Source-org CI submitted; current observed job had zero executed steps |
| Wasm | [#474](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/474) cached private view and `readInto` | Source-org CI submitted; current observed job had zero executed steps |
| Java | [#2875](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2875) graph construction-order deterministic drops | Source-org CI submitted; current observed job had zero executed steps |
| .NET | [#484](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/484) 20k native-root managed-allocation budget test | Source-org CI submitted; current observed job had zero executed steps |

Do not promote a draft source PR, a host-runtime test, a zero-step Actions failure,
or a source-free model to **compiled guest executable parity**.
Record `NOT_EXECUTED` until nonzero runner steps and exact source SHA match.
Do not copy private source to another organization just to obtain minutes
without the separately approved destination/security-gate prerequisites in
`docs/ACTOR_MEMORY_FIXTURE_CATALOG_V1.md`. Previously observed private
carrier success for a *different* source subset does not automatically grant a
new export authorization.

## Backend-local verification to integrate

- Java: `ActorOwnedGraphArenaLifecycleTest`, `ActorLinearArenaTest`,
  `ActorLinearArenaLifecycleTest`; independent Graal Native Image Epsilon
  workload is experimental and cannot certify production zero GC.
- LLVM: `native_actor_arena_host_buffer_boundary`,
  `native_actor_graph_reverse_destructor_order`,
  `native_actor_owned_cyclic_graph_heap`, CFG drop planner, then actual
  source-compiled guest AOT drop/exception/cancellation cases.
- Wasm: Node `tests/actor-arena*.test.mjs`, `gc-type-admission.test.mjs`,
  then actual compiler-emitted Wasm guest actor memory cases.
- Forge: native CMake `oresforge_actor_arena`, actor incarnation memory
  and mailbox tests, followed by source-compiled actor guest cases.
- .NET: `ActorNativeArenaSelfTest`, `ActorArenaSelfTest`, then Windows/Linux
  Native AOT compiled guest and strict allocation-counter/collector receipts.

**Merge order:** review independent native buffer safety; integrate reverse
drop order, owner flags and real source object lowering; then add exceptional
cleanup and AOT allocation-closure proof. The stricter LLVM hard-RT profile is
an additional separate acceptance gate with prefault/locking and WCET.
