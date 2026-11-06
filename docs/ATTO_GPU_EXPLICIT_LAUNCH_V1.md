# AttoLang explicit GPU launch conformance v1

This contract adds a **proposed** AttoLang-native alternative to CUDA's triple-chevron launch configuration, without replacing existing `gpu fnc`, `gpu.global_id(axis)`, `GpuArray<T>` or `gpu task {}`.

- **Canonical semantics/typed IR:** [common-source proposal](https://github.com/ores-truffle-oreslang/oreslang-common-source/blob/feat/atto-gpu-launch-hir-contract-20261106/docs/GPU_EXPLICIT_LAUNCH_V1.md).
- **Manifest:** [atto-gpu-explicit-launch-v1.json](../contracts/atto-gpu-explicit-launch-v1.json).
- **Source fixtures:** [gpu-launch-v1](../fixtures/gpu-launch-v1).
- **Manifest integrity tests:** `node --test test/gpu-explicit-launch-v1.test.mjs`.

The corpus consists of three proposed positive `.atto` launches (expert SAXPY, logical 1D SAXPY and logical 2D) and eleven expected rejections (host buffer, zero-sized block, zero physical grid, device `await`, mutable alias, CUDA chevrons, mixed geometry, zero group and divergent padded-tail barrier). Exact physical `grid/block` axes must be strictly positive; a zero-valued logical `over` extent may only produce a quiescent, non-dispatching completion after ordinary admission. Logical work counts and padded dispatched lanes remain separate. All seven backend lanes remain `NOT_EXECUTED`; the Node tests only check source shape, declared expected diagnostics, and exact Git blob identities. They cannot demonstrate compiler parsing, GPU device execution, numerical correctness or parity.

The next implementation steps are: Java parser/AST/borrow/effect admission, LLVM companion source-to-IR, explicit grid/block/device/queue validation, typed device-buffer/fence lowering, CPU SIMT reference against a scalar oracle, then at least one real GPU provider with authenticated completion evidence. Use [CPU_GPU_TASK_V2](./CPU_GPU_TASK_V2.md) for source-level Future and cancellation semantics, with no host fallback, implicit transfer or carrier blocking. Preserve existing compatibility and fail closed for unsupported target backends.

A positive guest receipt must identify exact compiler/source/tree, fixture blob, kernel binary, device/driver and a nonzero executed-step job on real GPU hardware; negative tests must show no emitted artifact. A schema test or `steps=[]` is **not** such evidence.

## v1.1 logical geometry and cross-language syntax audit

The comparison with CUDA C++, Rust cudarc/rustacuda/CubeCL, Java TornadoVM and Go cu is documented in [common-source GPU benchmark](https://github.com/ores-truffle-oreslang/oreslang-common-source/blob/feat/atto-gpu-launch-hir-contract-20261106/docs/GPU_COMPARATIVE_SYNTAX_V1.md). This adds a candidate `over: [logical extents]`, `group: [work-items per group]` spelling alongside expert `grid/block`; the modes are mutually exclusive and the compiler must retain logical and physical extents for padded-tail proofs. The capability map now tracks 46 independently named goals (none device-verified). The short form is parser/host-geometry groundwork only; neither the Java nor LLVM draft proves device dispatch.

## G1b source-HIR negative admission (proposal, not guest evidence)

Java/Graal draft [#2582](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2582) now has an immutable source-HIR staging pass invoked by its production typechecker. The additional `host-geometry-call` and `bool-geometry` fixtures ask future compilers to reject arbitrary host computation in grid dimensions and non-integer bound geometry names with `GPU-LAUNCH-003`. This does **not** establish kernel signature resolution, ownership/loan authority, device effect proof, a typed GPU backend IR, or physical launch. This manifest remains `SOURCE_PROPOSAL_ONLY`, all backend evidence `NOT_EXECUTED`, and the added Node checks are source/blob-integrity tests only.
