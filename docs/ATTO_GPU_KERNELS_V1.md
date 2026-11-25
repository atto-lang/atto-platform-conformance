# AttoLang GPU kernels — proposed v1 feature/verification contract

**Status: design + source-free negative/reference checks only. No parser, compiler, device driver, hardware execution, or CUDA parity is implemented by this document.** Public spelling is **AttoLang**; canonical examples use `.atto`. Existing internal Oreslang repository names and ABI are unchanged.

This extends, but does **not** override, [CPU/GPU Task v2](CPU_GPU_TASK_V2.md): `gpu { }` is synchronous from source semantics; `gpu task { }` yields `Future<T>` and submits eagerly. Unsupported source must fail closed before an executable artifact can be emitted. `await` is never a launch trigger.

## Proposed AttoLang syntax (NOT ACCEPTED BY CURRENT PARSER)

```atto
// Proposed compute function: a device-safe, statically checked code profile.
compute fnc saxpy(x: DeviceRead<f32>, y: DeviceRead<f32>,
                  out: DeviceWrite<f32>, alpha: f32, n: u64) device {
  const i = gpu.global_id.x;
  if i < n {
    out[i] = alpha * x[i] + y[i];
  }
}

// Proposed named configuration; never adopt CUDA C++ triple-chevron syntax.
const finished = gpu task {
  launch saxpy(x, y, out, 2.0, n) with {
    grid: [ceil_div(n, 256), 1, 1],
    block: [256, 1, 1],
    shared_bytes: 0,
    queue: compute_queue
  };
};
await finished;
```

`compute fnc`, `device`, `launch ... with`, `DeviceRead`/`DeviceWrite`, and `gpu.global_id` above are **proposal-only**. The compiler must not silently treat them as CPU operations. `gpu` source-region admission and the independent `rt borrow`/`rt take` ownership system remain canonical; the proposed device views must be derived from validated, generation-fenced owners. This syntax requires an explicit grammar/type-system decision before enablement.

A `gpu { ... }` region may contain only validated device work and host-planned continuations. A nested `cpu { ... }` is a host continuation after a device fence; it is **not** a CPU callback per GPU lane. No automatic host↔device conversion or transfer.

## CUDA-class capability inventory

The machine-readable inventory is in `contracts/atto-gpu-kernels-v1.json`. It covers launch geometry and indexes, device buffers, typed memory effects, transfers, bounds, sync, cancellation, block shared memory and barriers, atomics and memory scopes, subgroups, streams/events, reductions/scans, graph replay, precision formats, multi-GPU, matrix acceleration, asynchronous copies, dynamic parallelism, interoperability and profiling.

Priority `P0` is the minimum honest first physical-GPU guest path. `P1` is core CUDA-style programming coverage. `P2` includes specialized and architecture-/provider-dependent features. Unsupported hardware/compiler features must give a stable capability diagnostic; portability does not imply identical performance, PTX availability, or support for all CUDA proprietary facilities.

## Hard invariants

1. **Typed geometry:** grid and block are one- to three-dimensional **positive integral** shapes; all products use checked arithmetic; validate block-axis, grid-axis, total threads, dynamic shared-byte quotas and tenant/device capabilities **before** enqueue. Never clamp dimensions silently or execute a zero-axis kernel.
2. **Device/host separation:** no raw host pointers in device kernels; no host I/O, actor messaging, arbitrary virtual dispatch, exceptions crossing kernels, unbounded allocation, suspension or thread creation inside SIMD/SIMT device functions.
3. **Memory/ownership:** buffers are typed by element, length, alignment, layout (AoS/SoA/AoSoA), residency and access mode. A write must have an exclusive legal loan or a statically proven disjoint partition. Shared-memory budgets are device-specific. Verify every computed byte-offset for overflow and buffer bounds.
4. **Memory order/scope:** barriers require convergent participating threads; divergent block barriers must be rejected unless compiler proves safe participation. Atomic order and scope are explicit; no implicit global fence from a block-local barrier. Subgroup width is a queried target property, never assumed to be 32.
5. **No fake cancellation:** cancellation requests alone do not prove device quiescence; resource reclamation, actor termination and hot reload wait for provider-authenticated completion fences. Stale allocation generations and tenant/device mismatch fail closed.
6. **No CPU fallback:** missing GPU, an unsupported device effect, invalid launch dimensions, unsupported math mode, or exhausted GPU quotas is a rejection, not a CPU substitute. Carrier threads must not park while GPU work completes.
7. **Numeric policy:** specify f32/f64/f16/bf16 behavior, FMA contraction, NaN/Inf, signed zero, out-of-range conversion, reduction order and deterministic vs fast-math mode. An approximate GPU result must not be reported as bitwise parity.
8. **Provider trust:** a host-generated IR/OpenCL/PTX text artifact is not a device submission. Explicit provider admission must bind a physical device, queue, immutable compiler/source build identity, allocation leases, command ticket and completion event.

## Promotion matrix

| Stage | Required evidence | Permitted claim |
|---|---|---|
| Contract/source-free tests | Schema and reference oracles pass | Contract validation only |
| Compiler guest | Exact-head `.atto` input compiled, rejected negatives, IR/device artifact hashes and executed steps | Specific compiler/lowering behavior |
| Physical GPU | Above + real GPU model/capability, native dispatch and output oracle, device-fence receipt | Specific feature on specific GPU/backend |
| Multi-backend parity | Independently compiled same fixture, compatible numerical policy, device execution per claimed target | Bounded cross-backend feature parity |

For an executable claim, require immutable PR head SHA **and tree SHA**, compiler digest, fixture digest, provider ID, hardware identification, nonzero executed job steps, native GPU completion event, exact artifact hash, numeric/reference comparison and negative mutation tests. `steps=[]` or `null` means runner admission failure; source-free validation or OpenCL text generation cannot promote GPU execution. Verify runner/workflow artifact identity and job attempt; independent approval is still required to merge.

## Initial acceptance fixture sequence

1. Produce a **real** `.atto` vector-add or SAXPY source: correct compilation and CPU-only hard rejection, and an independent CPU oracle with tolerance policy.
2. Verify 1D/2D/3D geometry, boundary masks, buffer bounds and P0 capability errors (including zero, overflow, stale generations and quota exhaustion).
3. Run the actual compiled guest on a physical OpenCL device (initial LLVM route); record a device fence and output digest.
4. Extend to shared-memory tile, uniform barrier, scoped atomic and subgroup tests; add cancellation/retirement races.
5. Add NVVM/PTX, SPIR-V, AMDGPU, Metal where technically supported, without presenting an OpenCL C string as a dispatch. Bring Java, .NET, Wasm and Forge along with independent source/lowering and hardware receipts.

Reference tests: `node --test tests/atto-gpu-kernels-v1.test.mjs`. These are **not** the real compiler or physical-GPU gate.
