# Actor-owned memory and four-layout ECS parity — proposal v1

Status: **PROPOSED CONTRACT ONLY** (2026-10-21). This document does not claim any backend has executable guest conformance, per-actor physical memory on main, a no-GC release, or performance superiority. Execution work is tracked in [100-task tracker #144](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/144). Cross-backend semantics must match; hosts may use different implementations.

## One logical contract, five physical backends

An Oreslang actor owns its ordinary mutable state. Actor heaps are distinct **ownership, allocation, quota and lifetime domains**, including for SHARED actors. A memory domain does not itself confer OS process isolation. ISOLATED and UNTRUSTED actor policies additionally need enforceable address-space/capability/sandbox rules. Do not treat a Web Worker, Wasm instance, Graal context or .NET Native AOT build as an OS sandbox on its own.

Each actor has: actor ID + incarnation, persistent storage arena, per-turn scratch arena, optional retained continuation/Task region, byte/resource quotas, issued checked handles, immutable-sharing grants and quiescence bookkeeping. Persistent bytes remain live across turns; scratch resets only after no permitted reference survives. A suspended frame keeps its region pinned. Teardown runs guest drops, cancels/detaches outstanding activities, drains leases, revokes capabilities, and only then frees native memory. Errors in retirement must be recorded/retryable; never mark physical cleanup complete prematurely.

| Target | Actor state carrier | Status/constraint |
| --- | --- | --- |
| GraalVM/Java | Per-actor FFM/native region with generated primitive field/collection accessors; compressed checked offsets; near-zero steady-state guest allocation goal | Native payload/continuation lowering is staged; JVM host metadata remains GC-managed. Shared actors still own private arenas. Keep two isolate domains (trusted and pooled untrusted JIT) and the distinct shared/isolated/untrusted scheduler pools; not one isolate or OS pool per actor. |
| LLVM | Independently owned native region/heap, slab/superpage allocation for small actors, explicit drop and generation handles; zero tracing GC in strict native guest image | Existing C++/native host prototypes are not proof of source actor allocation or AOT image closure. |
| WebAssembly | Prefer distinct unshared linear memories per actor Wasm instance where feasible; for high actor counts, use compiler-proven disjoint actor regions and allocator provenance within a Wasm memory | Module memory is a resource, not a general process security sandbox. Separate guest vs host allocations and bound maximum pages. Wasm actors remain future work. |
| JavaScript | Dedicated browser Web Worker per actor (Node worker_thread equivalent) with Worker-private mutable JS heap and optional typed-array backing | Browser/Node worker references must never be silently shared. Transfer ArrayBuffer ownership (source detached) or serialize immutable copies; reject SharedArrayBuffer by default except explicit reviewed shared-memory capabilities. Worker per actor has substantial overhead: benchmark admission quotas, start cost and memory before scale claims. |
| .NET Native AOT | Custom per-actor unmanaged native allocator (NativeMemory.AlignedAlloc/AlignedFree or dedicated OS page regions), generated typed offset/handle accessors and explicit reclamation | Do not advertise separate per-actor CLR GC heaps: Native AOT still uses managed GC for host objects. Do not store GC references in unmanaged Ores guest objects. Compiler-generated guest state, collection payloads and async frames should be arena-backed. Separate protected worker processes where OS isolation is required. Do not introduce dynamic assemblies/JIT to provide hot reload; stage native process generations instead. |

Large allocations may use dedicated OS pages; small actors should use pooled superpages with logically disjoint owned arena spans to avoid one OS mapping per tiny actor. Pooling never grants another actor mutable access to a neighbor's span. Page zeroing/reuse and quota accounting are mandatory. Never embed raw native pointers into guest values or wire messages.

## Reference and ownership ABI

Guest source ownership operations are **rt copy, rt share, rt take, rt borrow, rt mut borrow**. No source-level pointer-like syntax or legacy mutable borrow ordering. Runtime/compiler internals may use raw pointers only behind validated capabilities.

Owned handle = (allocation domain, actor incarnation, region generation, slot/offset, type/layout identity, access privilege). Validate width, overflow, alignment, object extent, generation, actor ownership and access mode **before** dereference. If using 32-bit encoded offsets, explicitly define quantization, null representation and maximum addressable extent; 32-bit offsets do not imply a 4 GiB physical address space when scaled. Reject invalid or nonrepresentable spans rather than silently truncate.

Immutable sharing is explicit and authorized within a trust/allocation domain; never treat mutable shared memory as immutable solely through a type cast. Actors may send ownership-transferred buffers, copied/serialized values, or immutable grant-backed messages. A sender cannot keep a writable view after transfer. All actor state loans and field projections obey borrow/effect checks, including suspension, cancellation, exception paths, hot reload and FFI.

## Layout-parameterized storage, independent of actor semantics

An actor is **not** an ECS entity. Ordinary, actor-independent Oreslang code and structured Tasks must be able to own large ECS stores and run efficient loops. The same layout rules hold when an actor owns the store. A typed store has exactly **one authoritative physical layout at a time**; conversions are explicit or statically selected by a documented auto policy, not synchronized copies of all representations.

For logical fields x, y, vx, vy, the four distinct geometries are:

1. **AoS** (array of structures): an array of row records; each record stores x,y,vx,vy. Strong whole-row locality; no per-row host object allocation.
2. **SoA** (structure of arrays): four contiguous columns x[N], y[N], vx[N], vy[N]. Strong selected-column locality, natural SIMD and field-disjoint borrows.
3. **AoSoA** (array of structures of arrays): tiled array of blocks; tile has x[W],y[W],vx[W],vy[W]. W is an explicit, target-verified width. All tail lanes use safe masks; no padded element is a live ECS entity.
4. **SoAoS** (structure of arrays of structures): logical field groups holding arrays of compact subrecords, e.g. position[N] of {x,y} and velocity[N] of {vx,vy}. This groups fields without making every member scalar-column contiguous. It is **not** an alias for AoSoA: the latter has an outer *array of tiles* containing inner *arrays of scalars*.

The top-level groups in SoAoS must share row identity/lifetime, even when each array's element has different size/alignment. Canonical names, layout ABI version, strides, padding and endian rules must be shared across compilers. A struct field's guest value and nominal identity are layout-independent; pointer aliasing, binary layout and physical indices must not leak across a layout conversion.

### Source surface and ownership

Use existing source design: inverted class denotes a nominal field-addressable row API with a SoA default for InvertedArray<T>. Add explicit LayoutStore<T> layout requests (aos, soa, aosoa<W>, soaos<groups>, auto) only behind tested grammar/typechecker gates. Inverted-class default is not an automatic rewrite of all Array<T>, and incompatible auto selection cannot silently violate declared layout intent.

A store owns its columns, rows/chunks, row-count, capacity, handle generation and allocation region. Operations: reserve, push transactional across all component columns, erase_swap, get/set row, get/set field, typed zero-copy projection, slice/chunk iteration, safe snapshot/convert. Avoid invalidating a live read/write view on growth or erase; use explicit lease checks or reject. Stable references are handles (owner, slot, generation), not raw row pointers; compaction and deletion must never revive stale handles. Field-sensitive loans enable disjoint writable columns with static/runtime proofs.

### ECS + scheduling

Provide sparse/dense generational EntityId, archetype chunk storage, component schemas, deterministic add/remove/move, query plan and typed access effects (reads / writes / reduces / discards). Independent column writes can run in parallel when access regions are provably disjoint; unknown aliasing serializes or is rejected. Structured nb Tasks and ordinary compute loops must work without spawning thousands of actors. Task cancellation, actor stop and layout conversion cannot release a buffer with an outstanding column view. SIMD/vector/GPU lowering must preserve exact numeric/error contracts or require explicit fast-math profiles.

## Executable parity gate

A **contract file, parsed fixture, host C++ collection, C# test, or JS typed-metadata oracle is not successful Oreslang guest execution**. For each of the five targets, capture exact source/tree/compiler/toolchain/artifact hashes and separately assert: lex/parse, typecheck/effects, generated IR, actual guest execution, no-artifact negative rejection, memory ownership, limits/cleanup and performance.

Minimum guest fixture families:
- Same source: create actor, allocate persistent collection, run multiple turns, retain await frame, send/stop; verify no arena freed before all issued leases finish and no stale handles afterward.
- Same source: copy/share/take, mutable loan rejection, actor-message deep-freeze, bad offset/generation/owner, stale-hot-reload and forged metadata.
- Same source: inverted-class rows with push, update, project, swap-delete, owner/slot generation check and conversion across all supported layouts.
- Same source: fixed-step ECS integration over 1K/10K/100K entities; compare exact output/checksum under each layout (where admitted).
- Strict negative fixtures: unproven borrow across suspension, cross-actor mutable alias, layout overflow, missing page/row bounds, tail-mask violations, unknown layout/profile.
- Executed memory pressure: bounded quotas, out-of-memory behavior, no leaked external lease, cancellation/exception/retryable cleanup.

Unsupported features must report an explicit rejection, never a simulated pass. JS must execute ESM in browser and Node; Wasm must execute a built wasm32 guest; LLVM an emitted executable; Graal JVM/Native Image as declared; .NET a published Native AOT application. Zero-step GitHub Actions jobs count as **not executed**. Private-source tests only run under independently approved protected source/destination policy; availability of Actions minutes does not authorize a mirror.

## Benchmark plan and optimizer policy

Run identical algorithms and correctness conditions for all four layouts, at least 1K/10K/100K entities, and for AoSoA widths 4/8/16 where appropriate. Workloads: column-only scan, full-row update, hot paired-field update, random lookup, append/swap-delete, ECS archetype join, scatter/gather, and actor-owned snapshot/transfer. Include an AoS baseline, stable Rust/C++ baselines, cold startup and warmed throughput, vector enabled/disabled, JIT/AOT mode where available, and cache/memory footprint.

Report throughput, median/p95/p99/p99.9 latency, allocations/bytes, RSS/peak memory, GC count/pause (managed hosts), SIMD instructions, cache misses, false sharing, cleanup time, actor count and Worker/instance startup costs. Benchmarks must be toolchain-pinned, reproducible and independently reviewed. The auto selector may choose a layout from proven workload metadata and target capabilities only; it must not claim one layout always wins. Prefer SoA/AoSoA for field-dominant SIMD and AoS/SoAoS where measured mixed-record locality wins. Re-evaluate when mutation density, tile width or hardware changes.

## Staged delivery

P0: exact-language+IR contract, actor memory ownership/cleanup, .NET unmanaged arena integration, real source-level Java/LLVM inverted-class SoA, and executed five-target scalar report.

P1: guest actor parity in JS/Wasm/.NET and source aggregated actor lowering in LLVM; checked compressed references, AoS/SoA/AoSoA/SoAoS guest kernels, ECS query/borrow safety and cross-target execution.

P2: target-tuned SIMD/AoSoA/SoAoS auto choice, optional GPU device storage, NUMA and process-isolated worker profiles with quantitative results.

This proposal complements existing Java and LLVM DOP contracts. Do not mark it implemented until exact-head guest evidence exists in each affected backend.
