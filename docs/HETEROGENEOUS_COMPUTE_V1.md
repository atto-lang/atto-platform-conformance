# Oreslang heterogeneous scientific, accelerator, HPC and real-time contract v1

**Status: proposed, non-promoting specification and evidence checker.** This
contract registers features and how they may eventually be demonstrated. It
implements **none** of the language constructs or accelerator drivers. A passing
validator is *not* a compiler test, a hardware test, a performance result or a
hard-real-time certificate. The downstream reviewer must independently fetch
and inspect the actual fixture, binary, logs, hardware and analysis reports.

## Compatibility and architecture

1. The existing Oreslang source syntax, actor semantics, sealed actor state,
   `rt borrow`, `rt take`, `rt share`, `|>` functional pipelines, `gpu {}` and
   nested `cpu {}` remain authoritative. Do not introduce a parallel dialect.
   New public function and method names use `snake_case`.
2. The common semantic boundary should hold value shape, element type,
   memory ownership, space/placement, effects, numerical policy and (where
   applicable) deadline policy; it must not encode backend-specific C++, JVM,
   CUDA or CIL objects into Oreslang-visible type identity.
3. Java/Graal, LLVM, .NET Native AOT, Wasm, Forge, Cranelift and JS appear in
   the inventory. Inclusion does not imply that a backend currently compiles a
   feature, or that every backend can target physical GPUs or hard-real-time
   hardware. Unsupported operations fail at compile time with a stable
   diagnostic rather than degrading semantics silently.
4. A hard-real-time profile is a target/platform guarantee. Interpreter/JIT,
   GC timing, scheduling interference, hidden blocking and unbounded memory
   must be ruled out by proof or enforcement on that target. AOT alone is not
   proof. A GPU workload must not become a hard-real-time control dependency
   without a separately established bounded-completion contract.
5. An actor may own a GPU resource, but GPU threads are not actors. Actor
   physical retirement must await all device/kernel/DMA completion fences,
   including cancellation and panic teardown. Revocable/stale handles must
   fail closed. A live device loan must prevent incompatible host mutation.

## Proposed native core primitives (not implemented in this change)

- `Tensor<T, Shape, Layout, Device>`, `TensorView`, `SparseTensor`, `Table`,
  `OwnedBuffer`, `DeviceBuffer`, `DeviceFence`, `ExecutionGraph`.
- `map`, `reduce`, `scan`, `parallel_for`, `shard`, `all_reduce` and
  `checkpoint` as generic typed library operations where possible; kernel
  lowering in existing `gpu {}` syntax.
- Forward and reverse AD through explicitly differentiable pure functions;
  opaque actor/send/IO effects require boundaries or custom derivatives.
- Numeric modes distinguish default checked arithmetic, reproducible
  reduction, approximate fast math and format-specific FP4/FP8 capabilities.
  No implicit precision lowering within a deterministic profile.
- Zero-copy Arrow/DLPack handoff must pin the producer allocation through
  consumer completion, and reject alignment, layout, access-mode or ownership
  mismatches. Borrowing across GPU fences/`await` must remain sound.
- Hard-RT constraints should start as `.ores.pkg.toml` execution profiles,
  validated by a compile-time effect/resource checker. Exact syntax is subject
  to an independent parser/type-system proposal; this contract does not
  claim the parser already accepts profiles.

## Evidence stages and their meanings

| Stage | Minimum evidence | What it cannot establish |
|---|---|---|
| `compiler-checked` | Real compiler and source/fixture provenance | Executable or numerical correctness |
| `guest-executed` | Compiled `.ores` fixture executed and compared | Physical accelerator performance |
| `physical-hardware` | Guest execution plus physical target and run evidence | A worst-case execution-time bound |
| `deadline-verified` | Physical execution plus WCET, schedulability and interference evidence | Certification without independent review |

Each feature has a minimum admissible stage and allowed target classes in
`contracts/heterogeneous-compute-v1.json`. A capability receipt lists its
**exact** source revision, compiler revision and digest, fixture, built artifact,
executed job steps, and dependency-receipt digests. Dependency hashes are
references, not proof that these receipts were fetched and validated. The
aggregate promotion gate must resolve and verify them recursively, check that
all were generated for compatible target/backend revisions, and validate
binding to actual CI artifacts and hardware logs.

A physical GPU cannot be substituted by a CPU host simulation or a mocked
GPU backend; an emulator is not physical hardware; a host-only unit test is
not `.ores` guest execution. Measured low jitter, or simply setting a
`deadline_us`, is not a WCET proof. This validator verifies the *declared
shape* of the evidence and basic numeric contradictions only, not its truth.

## Minimal acceptance suites to create in backend repositories

1. **Memory/ownership**: actor A/B isolated buffers; stale GPU handles;
   use-after-free rejected; DMA/kernel completes before teardown; cancellation
   retains loans; bounds and alignment checked; no unauthorized foreign actor
   access. Verify real compiled guest behavior and physical device fences.
2. **Tensors and numerics**: dense/ragged/sparse constructors, shape and stride
   failures; exact aliasing semantics; gradient/JVP/VJP results compared to
   numerical references; NaN, overflow, signed zero and precision policy;
   deterministic reduction under reproducibility mode.
3. **GPU**: actual compiled `gpu {}` kernel, lane memory scopes, shared-memory
   synchronization, typed DMA transfers, graph replay, low-precision capability
   negotiation and no accidental fallback to host execution.
4. **HPC**: AoS/SoA SIMD numerical equivalence; NUMA locality on physical CPU;
   true multi-node sharding and collectives; collective cancellation/timeout;
   zero-copy interoperability held until consumers release references.
5. **Real time**: forbid unbounded allocation, I/O, locks and suspension in a
   hard-RT profile; prove priority interference bounds; record platform-specific
   WCET/schedulability analysis and safe behavior on missed accelerators.
6. **Verification negatives**: mutate compiled-guest provenance, skip guest
   execution, substitute hardware/target, omit dependency evidence, falsify
   WCET bound or reuse another backend's artifact. All must fail promotion.

## Backend sequencing

- **Shared first**: register the semantic contract, error codes, positive and
  negative guest fixtures, target profiles and evidence promotion rules.
- **CPU foundation**: complete owned buffers, AoS/SoA layouts, vector
  operations and tensor slices on Java and LLVM, then bring .NET, Wasm,
  Cranelift and Forge forward with the same source fixtures.
- **Accelerator foundation**: implement a minimal `gpu {}` kernel, borrowed
  device memory, fences and asynchronous transfer; test only on an available
  real GPU, without advertising unsupported backend parity.
- **HPC and AD**: distributed placements, collectives, forward/reverse AD,
  Arrow/DLPack and precision control, each with independent native guests.
- **Hard real time**: begin with a conservative LLVM/embedded AOT target
  profile; expand only with target-specific resource and timing evidence.

## Local validation

From the `oreslang-platform-conformance` repository root:

```sh
node --test test/heterogeneous-receipt.test.mjs
node bin/verify-heterogeneous-receipt.mjs path/to/receipt.json
```

The same Node v22+ harness is used by this repository's other conformance
checkers. This verifier intentionally creates **no passing receipts** for the
backends. The feature registry does **not** assert current implementation.


## First shared guest-contract vector inventory

`fixtures/heterogeneous-v1/tensor-span-v1.json` defines 26 signed-i64
strided-view metadata cases. `test/heterogeneous-tensor-span-v1.test.mjs`
checks their semantics using an independent arbitrary-precision oracle.
Java PR #2228 and LLVM PR #1139 compile native Oreslang source covering
the common 15-case core. Those PRs must eventually consume/generate the
full shared fixture rather than maintain independent literal copies.

The vector file is **not** a compiler test or an allocation/ownership proof.
A nonempty span is admissible only when `start + (count - 1) * stride` is
within the backing element count. The runtime must additionally validate
allocation provenance, generations, live loans, byte lengths and permissions
before data access. Signed i64 subtraction/division must be guarded to
avoid overflow, including i64::MAX dimension inputs.
