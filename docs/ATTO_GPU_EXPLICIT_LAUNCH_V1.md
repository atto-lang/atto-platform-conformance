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

## G1c restricted typed GPU kernel source-HIR (Java proposal)

The canonical `pub gpu fnc` declaration is represented by `Ast.GpuKernelDecl`, distinct from an ordinary host `FunctionDecl`. Java PR [#2582](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2582) adds the standalone `GpuKernelSourceHirV1` source type checker for the f32 SAXPY subset. It accepts typed f32 loads/stores, scalar arithmetic, fixed-axis `gpu.global_id`, immutable locals and a single-branch `if`. It rejects host calls, unsupported effects, write-only loads, read-only stores and implicit scalar conversions. This does **not** prove physical device memory bounds, alias exclusion, per-tenant authority, padded-tail safety, or real compiler-to-device lowering. The production TypeChecker unconditionally denies GPU execution with `GPU-KERNEL-008`.

The [separate G1c source-only manifest](../contracts/atto-gpu-kernel-source-hir-v1.json), [fixtures](../fixtures/gpu-kernel-v1) and `test/gpu-kernel-source-hir-v1.test.mjs` document seven prospective cases, all `NOT_EXECUTED`. Fixture Git hashes and Node structural tests are not AttoLang guest evidence. Actual CUDA-class support requires a compiled GPU binary, owned buffers, verified completion fence and native device output oracle.

## G1d kernel/launch linkage (source only)

Java/Graal PR [#2582](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2582) now contains `GpuKernelSourceLinkV1`, which links a same-unit `gpu fnc` source signature to a statically named `launch` and requires exact arity. Unbound lexical argument names remain **untyped** and are not proof of device allocations. Host-effect argument expressions, missing kernels and incompatible literal types fail closed before the existing execution denial. See [source-link manifest](../contracts/atto-gpu-kernel-source-link-v1.json) and [five fixtures](../fixtures/gpu-kernel-link-v1). All cases remain `NOT_EXECUTED`.

Java footprint PR [#2583](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2583) independently checks f32 view capacities against `over: [n]` and the supplied scalar n, but caller-supplied snapshots are NOT provider-issued authenticated allocations. Source linker and footprint capacity checks exist on separate PR trees; their coexistence is **not** compiled or proven, and no device-buffer loans, fences or physical backend have executed.

## Source kernel visibility audit

G1d Java kernel linkage now resolves unqualified names **only within the
caller's lexical module**. Qualified cross-module launches, including to a
publicly declared kernel, remain fail-closed with `GPU-LAUNCH-001` because
the stage has no verified module import, linker alias or capability proof.
Private cross-module kernels are rejected independently. A private kernel
may be analyzed within its own module, but the source report cannot grant
runtime dispatch. The source-link manifest records these explicit disabled
capabilities; no fixture is promoted as executed compiler evidence.

## G1d private Java integrated source tree (NOT_EXECUTED)

Java/Graal draft [#2610](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2610)
now combines source-kernel PR #2582 and host-footprint PR #2583 via a
two-parent merge commit without changing either original agent-owned
branch. The integration branch contains `GpuKernelSourceCapacityJoinV1`,
which derives read/write access from source kernel types rather than
caller-supplied expectedAccess flags. It checks the canonical `n`,
positional view bindings, the checked source tail and the separate host
capacity/overlap quotas. The result is strictly
`SOURCE_JOINED_CAPACITY_SHAPE_ONLY_NOT_EXECUTABLE`.

The [G1d integrated-source manifest](../contracts/atto-gpu-g1d-integrated-source-v1.json)
pins Git head/tree/parent identities and the still-unexecuted Java compiler
and host test evidence. The companion Node test checks manifest assertions
only; it does not inspect the private Java source, run a compiler or
authenticate device buffers. Source-org GitHub Actions still reports
`steps=null`, and the Java repository is private: cross-org source
mirroring is held pending independent authorization. A successful
source/host join cannot authorize physical GPU enqueue or CPU fallback.

## G1e host formal declaration source ABI (not compiled proof)

Draft Java integration [#2610](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2610)
now adds `GpuKernelTypedSourceArgsV1` and a declaration-only
`GpuKernelSourceCapacityJoinV1.auditTypedSource` path. The source
checker matches kernel parameter types against **explicitly declared
host function parameter** types, rejects mismatches, unresolved
lexical argument names, unsupported element types and reuse of
writable source buffers. The implementation has 13 new authored JUnit
cases, but source-organization GitHub runner jobs still report
`steps=null`. The [eight-case G1e source corpus](../contracts/atto-gpu-typed-host-args-v1.json)
records only proposed diagnostic fixtures and exact Git blob hashes.

Host declarations are not compiler-issued typed symbol resolutions,
even though the source checks compare their spellings. This stage
does not validate local aliases, capturing closures, true ownership
loans, tenant/device allocation identity, runtime values of n or
queue generation. A successful source-only report cannot authorize
a kernel, CPU fallback or physical GPU work. Require executed
exact-head compiler/JUnit tests and independently verified provider
receipts before promotion.
