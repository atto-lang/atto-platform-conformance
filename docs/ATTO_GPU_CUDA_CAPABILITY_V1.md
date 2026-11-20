# AttoLang GPU blocks and CUDA-class capabilities: G0 launch admission

**Status (2026-11-06): PROPOSED language/compiler contract + executable host-side schema reference. This PR does not compile or execute GPU guest source. No physical GPU evidence is claimed.**

This document extends the existing CPU_GPU_TASK_V2, CPU_GPU_NB_V1 and HETEROGENEOUS_COMPUTE_V1 contracts without changing their meanings or historical evidence.

## The model: cleaner syntax, equivalent GPU concepts

AttoLang must distinguish these three operations:

1. A GPU execution REGION is a host-planned typed expression: gpu { ... } returns a value synchronously from the source perspective, suspending the logical caller rather than blocking an actor carrier. gpu task { ... } submits and returns exactly one Future<T>. Nested GPU -> CPU -> GPU is a fence, host continuation, and new GPU admission graph. It is never a CPU callback run per device lane.
2. A device KERNEL is code compiled for each GPU work item. It has a device-only effect row and can call GPU-specific intrinsics (global/local/group index, barriers, atomics, subgroup operations). It cannot call actor methods, use arbitrary host heap pointers, perform host I/O, block on host futures, or access another tenant.
3. A KERNEL LAUNCH is a host graph command with typed grid/block dimensions, explicit arguments and ownership. It does not create an actor per lane and does not require CUDA's triple-angle-bracket launch punctuation.

Illustrative future AttoLang spelling only — **not accepted compiler source**:

~~~ores
define pub kernel saxpy(a: f32, x: GpuView<f32, read>,
                        y: GpuView<f32, read_write>, n: usize) as
    const i = gpu.global_id(0);
    if i < n then
        y[i] = a * x[i] + y[i];
    fi
end

const device_x = await gpu.upload(host_x);
const device_y = await gpu.upload(host_y);

const result = gpu {
    saxpy.launch(
        grid: (ceil_div(n, 256), 1, 1),
        block: (256, 1, 1),
        args: (a, device_x, device_y, n));
    device_y
};

const host_result = await gpu.download(result);
~~~

Use normal snake_case callable naming; the kernel declaration should be typed, not a separate CUDA-flavored language. GPU/host values never silently convert, and explicit GPU must fail closed when no physical GPU provider is admitted. Retain the AttoLang ownership/borrow model across kernel submission and completion.

## CUDA capability parity roadmap

| Tier | Language/runtime obligations | Acceptance evidence | Current claim |
| --- | --- | --- | --- |
| G0 | Signed/checked launch geometry, capability-aware quotas, tenant/device/generation checks, layout/access tags, no fallback | Host-side schema reference and negative controls, then compiler integration | **Reference oracle only** |
| G1 | Kernel declarations and effect typing, 1D/2D/3D indexing, global buffers, explicit upload/launch/download, device fences, actual GPU dispatch | Exact-head compiled AttoLang source running F32 SAXPY on physical hardware, compared against CPU oracle | NOT ESTABLISHED |
| G2 | Shared/block-local memory, uniform barriers, subgroup/warp shuffles, ballot, reductions, scoped atomics, AoS/SoA/AoSoA and tail masks | GPU race/memory checks, numerical and aliasing conformance | NOT ESTABLISHED |
| G3 | Bounded streams/queues, asynchronous copy, event synchronization, command graph capture/replay, peer-device operations, robust actor teardown | Device reset, cancellation, ABA, memory leak, carrier nonparking and backpressure tests on real GPUs | NOT ESTABLISHED |
| G4 | Cooperative groups, clusters, distributed shared memory, tensor cores/matrix acceleration, texture/image access, BF16/FP16/FP8/FP4 | Real capability negotiation, no silent precision downgrade, hardware-specific conformance | NOT ESTABLISHED |
| G5 | Optional vendor-level interop: dynamic device parallelism, PTX/driver/library APIs | Explicit vendor plug-in and sandbox boundary, target-specific ABI and tests | NOT ESTABLISHED |

The goal is **CUDA-class expressive capability**, not pretending NVIDIA's C++ APIs are universally portable. A vendor-specific feature can be supported through an explicitly negotiated extension without changing the portable AttoLang core.

NVIDIA's CUDA model includes block/grid hierarchy, shared memory, barriers, scoped atomics, cooperative groups, asynchronous pipelines, memory allocation/transfers, command streams and advanced accelerator instructions. Each has distinct correctness and performance obligations; syntax sugar alone does not provide them.

## G0 reference implementation in this PR

The standalone reference model in src/gpu-launch-admission-v1.mjs exports validate_gpu_launch_v1. It validates an exact, own-data descriptor with backend, tenant_id, device, capability, kernel, grid, block, shared_bytes and buffers.

It rejects zero/non-integer/unbounded dimensions, per-axis and block-thread limit violations, total-thread quota violations, illegal shared-memory usage, missing tenant GPU capability, incompatible device features and atomic scopes, forbidden host effects, divergent-barrier declarations, wrong tenant/device, invalid buffer ranges/alignment, non-idle fences, stale allocation generations, write aliases and over-quota device allocations.

G0 is deliberately conservative: two bindings to the same writable allocation are rejected even if a more advanced disjoint-field prover could show safe independence; duplicate reads are permitted. Layout tags (aos, soa, aosoa) are admitted as labels only: this model does NOT prove physical strides, field widths, AoSoA block/tail packing, alignment of an actual provider allocation or device-native memory layout.

A successful result has the exact status STATIC_SCHEMA_ONLY and physical_gpu_verified=false. Device limits, kernel/barrier declarations, tenant labels and buffer IDs in this model are untrusted JSON-like claims: **they are not a cryptographically authenticated capability, a hardware probe, a compiler-generated effect proof or a provider-owned handle**. Real runtime admission must use broker-issued opaque identities and trusted hardware capability enumeration.

Run only the local reference suite:

~~~sh
node --test tests/gpu-launch-admission-v1.test.mjs
~~~

The 63 tests demonstrate deterministic reference validation, not the compilation or execution of any AttoLang guest source, and not a GPU driver. A successful test run must not promote existing cross-backend evidence.

## Compiler and runtime security gates before turning on GPU blocks

- Device effect checker: prove a restricted kernel call graph; reject host I/O, arbitrary CPU callbacks, heap references, actor state/messaging, host awaits, unsafe pointer captures, reflection and uncontrolled dynamic dispatch. Preserve defined numeric/overflow semantics; fast math is opt-in.
- Borrow and layout checker: check each buffer field and subrange, layout/stride/shape, AoSoA tails, alignment, no conflicting writers, move/borrow lifetime, device residency, generation and in-flight loan state. Runtime authority comes only from authenticated device brokers, not from this reference model.
- Launch validator: perform checked wide integer arithmetic for grid/block products, byte sums, shared allocation sizes and bounds; enforce real per-device queried limits.
- Barrier/atomic checker: prove convergent workgroup barriers from device CFG, forbid unsupported memory order or scope, and prove cross-block synchronization is legal. User-supplied uniform_barrier=true is NEVER proof.
- Async lifecycle: GPU event completes a logical continuation once; canceled work may continue physically. Hold actor and buffer resources through real device quiescence after panic, cancellation, shutdown and device loss. Reject old completion generations.
- Tenant sandbox: check capabilities and VRAM/in-flight quotas at BOTH compiler admission and trusted provider enqueue. GPU buffer separation alone is not full hardware security isolation. Untrusted tenants may require process/device isolation and IOMMU/vendor guarantees.
- Backend separation: Java/Graal, LLVM, Forge and .NET may share device IR and provider interfaces; Wasm requires explicit WebGPU or other host capability. Compiler-language support, compiled kernel production and physical GPU execution remain separate per-backend evidence states.

## Next small implementation PRs

1. Typed kernel AST, device-only effect rows, index intrinsics and compiler negative fixtures across Java and LLVM, then the other backends. Resolve any legacy use of gpu as a zero-argument callable without overloading device execution semantics.
2. Immutable LaunchIR that binds real typed region views, dimensions, layout, provider capability, fence lineage and disposal. Integrate the G0 negative vectors into each compiler without claiming GPU execution.
3. First physical f32 SAXPY on a real GPU: upload, checked launch, async event/fence, download; compare arbitrary sizes including non-multiples of block width and reject CPU fallback.
4. Exact source SHA, compiler/executable hash, executed job steps, provider/device identifiers, sanitizer/race checks, cancellation and multi-tenant negatives in verifiable CI receipts. A CPU OpenCL ICD alone must not be accepted as GPU evidence.
5. Extend G2–G5 incrementally, with per-feature/per-backend states NOT_IMPLEMENTED, COMPILED_ONLY, GUEST_EXECUTED or PHYSICAL_GPU_EXECUTED, never a misleading blanket GPU_SUPPORTED flag.

Related implementation blockers: Java issues #1063; LLVM #1137; cross-backend conformance #51; Java PR #2575; LLVM PR #1166.
