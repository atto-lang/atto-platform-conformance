# AttoLang HPC CPU reduction v1: reproducible reference

**Status: HOST_REFERENCE_ONLY.** This is a bounded Node.js oracle and golden-vector suite for future AttoLang CPU compiler backends. It does **not** prove that any `.atto` file compiles, actors execute concurrently, SIMD code is emitted, GPU/NUMA hardware runs, or that this is faster than a scalar baseline. See `contracts/heterogeneous-compute-v1.json` (the `math.deterministic_reduction` feature).

## Semantics

- Inputs are finite IEEE-754 binary64 arrays with matching extents for dot products. Reject nonfinite input, nonfinite multiplication, tile sum, or merge sum rather than silently accepting NaN/Infinity. This is the reproducible/finite workload profile, **not** all AttoLang floating-point semantics.
- A caller supplies a fixed, power-of-two tile size (2..4096) as part of the workload contract. At most 1,048,576 elements are accepted by the host oracle. Empty input sums to positive zero.
- Each tile computes left-to-right scalar sums, multiplying `lhs[i] * rhs[i]` first for dot products. Tile results may complete out of order but are placed at canonical tile indices.
- Merge uses a fixed adjacent pairwise binary tree, forwarding an odd last tile unchanged. Worker count, actor scheduling, and completion order **must not change** this tree. Changing the tile size *can* change the numeric answer and requires a new workload contract.
- The reproducible target cannot reassociate terms, enable `fast-math`, fuse a multiply and add, or change precision without an explicitly separate capability. Target-specific NaN and subnormal handling requires additional cross-backend fixtures.
- Inputs must remain immutable for the duration of loans. The reference refuses `SharedArrayBuffer` and resizable buffers but cannot prove that an ordinary JS buffer isn't concurrently mutated elsewhere. Actual guest/host borrow enforcement remains required.
- Actors may coordinate tile work, but compute output belongs to exactly one owning actor/region until an explicit move or safe immutable share. No mutable cross-actor pointer aliasing or unvalidated DMA handles.

## Run

From the conformance repository root, run `node --test test/hpc-reduction-v1.test.mjs`. `npm test` also discovers the suite. The tests cover fixed bit patterns, shape/bounds failure, NaN/Infinity, arithmetic overflow, malicious tile completion streams, noncanonical schedules, empty workloads, and backing-buffer safety.

## Backend execution gates

1. Create real `.atto` guest fixture(s) with explicit returns for non-void functions and the same ordered tile/merge rules. Compile on each backend at an exact source/head/toolchain revision. A source-file parser accepting text is not enough.
2. Compare actual compiled guest output bits with these vectors on Java, LLVM, .NET, Wasm and Forge; record independent real nonzero-step CI evidence. A host oracle pass is neither guest execution nor backend parity.
3. Add a **separate** performance gate: CPU model/ISA, compiler/flags, frequency policy, core topology, affinity/NUMA, dataset size, warmups, pinning and run variance. Compare against matched scalar baseline and report bytes moved, throughput and p50/p95/p99. No `SIMD` or speedup label until disassembly/optimization reports and real measurements establish it.
4. Extend to cancellation, pressure quotas and work stealing with no changed reduction order; eventually implement true multi-node collectives with explicit transport and failure contracts, not actor messages masquerading as bulk-data MPI.

Review alongside `docs/HETEROGENEOUS_COMPUTE_V1.md`, LLVM issue #1138, and Java issue #749. Keep `NOT_EXECUTED` for all compiler/hardware stages until independent evidence exists.
