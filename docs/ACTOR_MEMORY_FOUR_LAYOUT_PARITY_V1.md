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


## JVM/Graal self-managed actor heap and message-lifetime region — refinement (2026-10-21)

**Decision proposal:** implement an actor-owned allocator hierarchy *inside* the already actor-owned native memory domain. Keep an actor's persistent object heap distinct from a cheap message-scratch region, plus a pinned/scope-owned continuation region. Avoid a tracing collector by default. This is an allocation-policy and codegen design, **not** an assertion that the current native arena draft already frees all message temporaries.

**Existing actual implementation:** Graal/Java draft [#1822](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1822) currently supports JNI-backed `ActorNativeArena`, compact native object slots, a per-actor logical `ActorLinearMemory`, selected native lists/value cells and a native TaskFrame lifecycle header. It still has Java managed facades/evaluator frames and long-lived native allocations; most variable-size payloads cannot be reclaimed mid-actor. Its code has a **JDK 21 baseline and JNI allocator**, *not* a mandatory stable-JDK22+ FFM dependency. A separate FFM provider can be enabled after an explicitly reviewed toolchain baseline/Native Image compatibility change. Do not casually rewrite the runtime around `Arena.ofShared()` without reconciling that constraint.

### Per-actor allocation strata

| Allocation category | Primary home | Release condition |
| --- | --- | --- |
| Actor state, retained class instances, long-lived collections, ECS chunks, actor-owned indexes | `ActorHeap` backed by the actor's native arena, with size-class slabs/free lists where worth the overhead | Compiler-emitted drops on overwrites or scoped release; any remaining storage reclaimed only after physical actor termination and external lease quiescence |
| Message-handler locals, parsing/serialization scratch, bounded transient arrays and ephemeral query buffers | `MessageRegion` bump allocator with a monotonically increasing reset epoch, possibly pooling native pages | After **logical handler completion**, cleanup and proof of no outstanding scratch references; reuse capacity rather than allocate a new OS region per message |
| Async continuation frame, retained locals, select registrations, scoped descendants and external-operation state | `ContinuationRegion` with explicit lifetimes and pin/lease counting; may use actor-persistent allocator underneath | After the **last** live owner/continuation/scope actually retires, not on carrier yield, Future terminal notification or ordinary mailbox receipt |
| Frozen shared data | Dedicated grant/lifetime-accounted shared region (not actor scratch) | After all authorized read leases/grants retire |
| Native FD/socket/file/FFI authority | Opaque, generation-safe runtime resource registry, not raw guest handles | Deterministic close/transfer/rollback before releasing the owning memory |

A native arena is the allocator's backing/lifetime authority; a *heap within an arena* can add reusable free slots, size classes, growth/reallocation and layout-specific stores. Full local tracing GC is **not needed** for the fast path. Do not require one OS mapping or precommit a 64-KiB guest page for every tiny actor or every message. Pool and account native pages, but enforce strict logical actor ownership; keep currently specified 4-KiB object slabs / 64-KiB logical guest pages and common actor-relative offset authority when evolving #1822.

### Unary / single-flight actor fast path

1. On dequeue, start a fresh message epoch and mark `MessageRegion` active. Its backing capacity can be reused across messages.
2. Place allocations proven to die with the handler in scratch; put state/retained objects in persistent heap. The borrow checker proves lifetime and alias constraints, and typed lowering chooses the region.
3. The actor has at most one *active logical guest handler* even if its carrier thread is released by await. **Do not reset scratch on `await`, scheduler `rt cooperate`, or thread migration.** An awaiting handler may still own scratch and pinned continuation state.
4. On normal return **or** catch/raise/panic/cancel, run compiler-emitted destructor/drop glue in reverse scope order. Complete message ownership transfer/copy/serialization and release external resources first.
5. Verify no escaped scratch owner, borrowed projection, live subtask or pending callback retains the region. If the proof is static and no dynamic capability/FFI is involved, codegen can omit redundant runtime reference scans; if a dynamic lease remains, defer reset or fail the unsafe operation.
6. Advance the scratch epoch, revoke stale views/handles and reset allocator offsets in constant time. **An epoch invalidates guest handles even if the same native page is reused.** Quota accounting reflects live/reserved bytes according to its published contract.
7. Admit the next message only under the one-handler-at-a-time actor execution contract. `get_done()` / actor stop are separate: physical arena teardown requires stronger whole-actor quiescence.

The borrow checker **does not free memory**: it proves aliasing, liveness and escape. The compiler emits drops and region placement; the native allocator performs actual reclaim/reuse. Safe source semantics stay `rt copy`, `rt share`, `rt take`, `rt borrow`, `rt mut borrow`.

**Escape rules:** reject a scratch reference stored in actor state, sent to another actor, published to a detached Task, returned from the handler as a live scratch reference, used after a message boundary, or held by an unproven asynchronous/FFI callback. Explicit owned result transfer, freeze/copy or compiler-proven promotion must provide a new lifetime-owning domain before reset; do not silently keep an alias into reclaimed memory. Zero-copy promotion is permitted only if the underlying page ownership is actually transferred and no other scratch objects/borrows remain on it; otherwise copy/move to persistent storage.

**Persistent-heap reclamation:** slot reuse requires ABA-resistant identity; generation fencing of physical slots must be compatible with #1822's nonrecycled actor-relative logical offsets and #1849's compressed32 encoding. Physical slab space may be reused only under new valid allocation authority. Bounded, weak/nonowning generational internal links can represent cycles under one arena owner, but resource destruction and mid-actor reclamation still need explicit ownership/drop semantics. If a long-lived actor continually allocates unreachable persistent cyclic graphs with no drop path, actor-exit bulk reset alone is insufficient; reject unsupported ownership cycles or enforce quotas, do not pretend there is no leak.

**Data layout:** persistent `LayoutStore<T>` / inverted-class stores may choose AoS, SoA, AoSoA or SoAoS within the actor heap; a message's ECS query iterators, sorted hit buffers and temporary conversion workspace belong in scratch only if they do not escape. Do not allocate a managed JVM wrapper per ECS row or per scalar operation. Layout conversion, erase, compaction and actor stop must respect field loans and continuation pins.

### Implementation milestones on the existing Java branch

- **J1 — classify allocation sites:** emit a typed `allocationDomain = MESSAGE | ACTOR | CONTINUATION | SHARED` witness in lowering. Start with native scalars and fixed-size aggregates; unsupported types fail closed. Never infer guest scope from the Java thread alone.
- **J2 — add message-region allocator:** bounded page/slab backing, alignment/overflow/quota checks, reentrant-close denial, monotonic epochs, deterministic reset and optional high-water retention/release; keep thread migration safe.
- **J3 — introduce persistent reusable heap:** size-class freelists and typed drop glue for variable-length text, native collection payloads, closures/ADTs and owned graph nodes. No general tracing pass and no per-object JVM finalizers.
- **J4 — async pinning:** spill the remaining managed guest continuation locals to checked native frame slots, preserve frames across `await`, and retire after all child Tasks/callbacks/FFI leases finish. Keep single-flight actor turn semantics.
- **J5 — generated accessors and evaluation:** avoid managed object facades, boxing, temporary Java lists/maps and per-element wrappers in steady-state guest loops; preserve explicit runtime bookkeeping outside guest heaps.
- **J6 — measured conformance:** exact-head real-source success/reject cases for temporary message allocation, repeated messages, persistent state across messages, handler await/cancel/error, scratch escape denial, stale epoch/reused slot, high allocation pressure, concurrent shutdown and arena lease deferral. Compare allocated bytes and GC pressure after warmup, document Native Image separately. This is not certified until executed against the actual compiler/runtime.

### FFM/provider portability caveat

JDK 25 `Arena.ofShared()` allows multi-thread access to segments and explicit close; `Arena.ofConfined()` is tied to a creating thread and does not directly fit migrating actor carriers. Closing a shared FFM arena invalidates **all segments allocated from that scope**, not just a custom logical subheap: a bump-pointer reset within a still-open scope **does not** automatically invalidate Java `MemorySegment` wrappers. The custom region layer therefore needs independent epoch/handle validation and/or separate closeable scopes for message scratch. For JDK 21, the existing JNI allocator can supply the same semantic contract. `Arena.ofAuto()` is GC-managed and should not be used to promise deterministic guest deallocation. See the [JDK 25 Arena API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Arena.html) and [GraalVM Native Image FFM support](https://docs.oracle.com/en/graalvm/jdk/25i/docs/reference-manual/native-image/native-code-interoperability/ffm-api/).

### Acceptance tests (required before runtime claims)

- 100K sequential messages with bounded transient bytes; persistent data unchanged and message scratch reset to low-water each time.
- Single handler pauses at await; its scratch values remain readable after resume on a different worker thread; a **new** handler is not admitted concurrently under unary/single-flight policy.
- Handler return, error, cancellation and panic each run required drops once and release scratch only after resource/future/child-task quiescence.
- Storage of a scratch borrow into actor state, Sendable payload, frozen region, external callback or escaped Task is rejected before artifact publication.
- Generation/epoch mismatch prevents stale scratch view reuse even if the same physical address is allocated next message; fuzz offset arithmetic and stale compressed32 handles.
- Repeated persistent variable-length allocation/overwrite reclaims usable slots and preserves full actor budget/accounting; bounded actors fail deterministically at quota.
- ECS per-row access is native, field-loan-safe and layout-equivalent across AoS/SoA/AoSoA/SoAoS; compare no-wrapper-allocation workload benchmarks with managed/reference baseline.
- Actor stop during a suspended message, external I/O or field lease delays physical release until true quiescence; verify no post-close native access, no double-drop and explicit failure receipts.
- Tests cover JNI JDK21 baseline; if FFM is adopted, separately execute JDK25 JVM+Native Image and confirm no semantic or lifetime regressions.

Existing relevant gates: [Java actor allocation issue #289](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/289), [native arena draft #1822](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1822), [compressed refs #1849](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1849), [whole-actor Task quiescence #1566](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1566), and [five-target queue #144](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/144).


## Executable source-free reference checks (Oct 21, 2026)

Two bounded **reference models**, not production compilers or actor runtimes, now accompany this draft:

- [Four-layout numerical oracle](../verification/dop-four-layout-reference.mjs) and its [unit regression](../test/dop-four-layout.test.mjs): physical addresses for AoS, SoA, tiled AoSoA and grouped SoAoS; explicit single authoritative layout; f64 signed-zero/NaN preservation; swap-delete; generation-fenced, issuance-checked stable row handles; disjoint-field loans; blocked compaction/conversion under loans; capacity and masked-tail rejection. Its 4-million-element ceiling is a test-harness guard, **not** a normative ABI maximum. Do not mistake f64 reference geometry for finalized heterogeneous fields, alignment, padding or native vectorization.
- [Actor message-memory model](../verification/actor-message-memory-reference.mjs) and its [unit regression](../test/actor-message-memory.test.mjs): independent scratch lifetimes for multiple outstanding messages; strictly one executing guest turn at a time; await/suspension and carrier migration; issuer-checked scratch handles; quota while continuations are suspended; external lifetime-only leases; retiring/reclaiming only after true quiescence.

**Concurrency nuance:** a serial actor can admit only one outstanding message lifetime, whereas an actor configured for multiple concurrent requests/messages may have more than one **suspended** message handler concurrently. It must still execute guest code single-flight. A production MessageRegion therefore belongs to the *handler/message lifetime*, not merely a single reusable actor-wide scratch bump pointer that resets whenever another handler runs. The unary fast path in the section above is deliberately restricted to serial admission.

The reference assertions were executed in a JavaScript V8 tool environment while authoring this draft. Source-org GitHub Actions may fail before job steps run; require observed Node 22 node --test job steps and separate real compiler/guest execution before promoting any parity checkbox. None of these models proves cache speedups, GC elimination or isolation in Java, LLVM, Wasm, JS Workers or .NET.


## ABI integrity and exact-SHA evidence slice (2026-10-21)

This is **shared reference-contract progress**, not source-level guest conformance.

- Corrected the shared heterogeneous layout oracle's identifier character class; ordinary multi-letter names previously failed validation.
- Froze nested scalar width descriptors, field-locator entries, field lists, and SoAoS group lists to prevent post-validation offset mutation.
- Added property-style tests for every logical cell across capacities 0, 1, 2, 3, 5, 8, 17, all four layouts, natural alignment, disjoint byte ranges and committed segment bounds.
- Added optional explicit `maxSegmentBytes` and `maxTotalBytes` **BigInt** physical admission quotas, including tile padding and group record strides. Backends must always pass their actual actor/instance limits rather than assume the reference's unconstrained default is a safe physical allocation.
- Pinned current backend draft/main commit SHAs without claiming compiler guest execution in `contracts/v1/five-target-actor-layout-evidence-20261021.json`. Added a fail-closed source-free verifier that rejects fabricated certified parity.
- Independently reconstructed the exact reference module in an ephemeral local Node 22 workspace. Its `git hash-object` matched the private GitHub blob `b76c3bf2bf7860eb06c9f0545a049bcc41f37986`; seven focused local smoke tests passed for geometry, hardening, quota and compressed32. These are **not** the full repository test suite.
- The source GitHub Actions workflow still failed before steps. No exact-head generated Oreslang guest tests have executed, and no private-source mirror has been authorized.

**Next acceptance gate:** independently stepful runner admission, audited source/tree provenance, shared mixed-width ECS source fixture compiled/executed through GraalVM and LLVM first, then the Wasm/JS/.NET targets with the same observable semantics and actor lifetime checks. Keep tracker #144 completion boxes open until merged/released and verified.
